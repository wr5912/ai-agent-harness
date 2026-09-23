#!/usr/bin/env python3
"""只读、有界检查旧 Agent/Harness 目录或归档，不提取、执行或回显文件内容。"""

from __future__ import annotations

import argparse
import bz2
import gzip
import hashlib
import json
import lzma
import os
import posixpath
import re
import stat
import struct
import sys
import tarfile
import zipfile
import zlib
from pathlib import Path, PurePosixPath
from typing import Dict, Iterable, List, Optional, Set, Tuple


SCHEMA_VERSION = "1.0"
MAX_CONFIG_BYTES = 1024 * 1024
MAX_CONFIG_NODES = 20_000
MAX_MEMBER_COUNT = 20_000
MAX_UNPACKED_BYTES = 1024 * 1024 * 1024
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024
MAX_TAR_METADATA_ENTRY_BYTES = 1024 * 1024
MAX_TAR_METADATA_BYTES = 4 * 1024 * 1024
MAX_TAR_METADATA_RECORDS = 128
MAX_TAR_PADDING_BYTES = 1024 * 1024
MAX_PATH_CHARS = 1024
MAX_FINDINGS = 1000
ZIP_EOCD_SCAN_BYTES = 65_557


def issue(code: str, message: str, path: Optional[str] = None) -> Dict[str, str]:
    value = {"code": code, "message": message}
    if path:
        value["path"] = path
    return value


class InspectionReadError(Exception):
    def __init__(self, code: str, message: str, path: Optional[str] = None) -> None:
        super().__init__(message)
        self.code = code
        self.path = path


class ArchiveLimitExceeded(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def safe_display(raw_name: str) -> str:
    """有界清理控制字符，避免成员名污染终端或制造额外内存压力。"""
    return "".join(ch if ch.isprintable() else "?" for ch in raw_name[:500])


def normalized_name(raw_name: str) -> Tuple[str, bool, bool]:
    portable = raw_name.replace("\\", "/")
    absolute = portable.startswith("/") or bool(re.match(r"^[A-Za-z]:/", portable))
    traversal = ".." in PurePosixPath(portable).parts
    normalized = posixpath.normpath(portable)
    if normalized == ".":
        normalized = ""
    return normalized.lstrip("/"), absolute, traversal


def is_sensitive_name(name: str) -> bool:
    base = PurePosixPath(name.lower()).name
    exact = {
        ".env",
        ".npmrc",
        ".pypirc",
        ".netrc",
        "credentials.json",
        "credentials.yaml",
        "credentials.yml",
        "id_rsa",
        "id_ed25519",
    }
    if base in exact or base.startswith(".env."):
        return True
    if PurePosixPath(base).suffix in {".pem", ".key", ".p12", ".pfx", ".jks"}:
        return True
    return bool(re.search(r"(^|[-_.])(secret|secrets|token|tokens|credential|credentials)([-_.]|$)", base))


def config_kind(name: str) -> Optional[str]:
    lowered = name.lower().replace("\\", "/")
    if lowered.endswith("/.claude/settings.json") or lowered.endswith("/.claude/settings.local.json"):
        return "claude_settings"
    if lowered in {".claude/settings.json", ".claude/settings.local.json"}:
        return "claude_settings"
    return None


def inspect_claude_settings(name: str, raw: bytes) -> List[Dict[str, str]]:
    findings: List[Dict[str, str]] = []
    if len(raw) > MAX_CONFIG_BYTES:
        return [issue("CONFIG_TOO_LARGE", "配置超过 1 MiB 安全解析上限，未检查其内容", name)]
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        return [issue("CONFIG_UNREADABLE", "配置无法安全解析：%s" % type(exc).__name__, name)]
    if not isinstance(data, dict):
        return [issue("CONFIG_SHAPE", "配置顶层不是 JSON 对象，需人工确认", name)]

    risky_true_keys = {
        "allowUnsandboxedCommands",
        "bypassPermissions",
        "dangerouslySkipPermissions",
    }
    stack: List[Tuple[object, Tuple[str, ...]]] = [(data, ())]
    visited = 0
    while stack:
        value, trail = stack.pop()
        visited += 1
        if visited > MAX_CONFIG_NODES:
            findings.append(issue("CONFIG_COMPLEXITY_LIMIT", "配置节点超过有界检查上限，需人工复核", name))
            break
        if isinstance(value, dict):
            for key, nested in value.items():
                key_text = str(key)
                next_trail = trail + (key_text,)
                if key_text in risky_true_keys and nested is True:
                    findings.append(
                        issue(
                            "DANGEROUS_SETTING",
                            "发现放宽沙箱或权限的布尔配置：%s" % ".".join(next_trail),
                            name,
                        )
                    )
                if key_text == "hooks" and nested:
                    findings.append(issue("ACTIVE_HOOKS", "发现 Hook 配置；禁止在接收阶段执行", name))
                stack.append((nested, next_trail))
        elif isinstance(value, list):
            for index, nested in enumerate(value):
                stack.append((nested, trail + (str(index),)))

    permissions = data.get("permissions")
    if isinstance(permissions, dict):
        if permissions.get("deny") == []:
            findings.append(issue("EMPTY_DENY_RULES", "权限 deny 列表为空，迁移前必须重建最小权限边界", name))
        allow = permissions.get("allow")
        if isinstance(allow, list) and any(
            isinstance(item, str) and ("Bash(*)" in item or item.strip() == "*") for item in allow
        ):
            findings.append(issue("BROAD_ALLOW_RULE", "权限 allow 中存在宽泛规则，迁移前必须收敛", name))
    return findings


class InspectionState:
    """流式累计有界统计和发现，不缓存归档成员或配置内容。"""

    def __init__(self) -> None:
        self.errors: List[Dict[str, str]] = []
        self.warnings: List[Dict[str, str]] = []
        self._finding_keys: Set[Tuple[str, str, str]] = set()
        self._finding_limit_reported = False
        self._seen: Dict[str, str] = {}
        self._seen_folded: Dict[str, str] = {}
        self.counts: Dict[str, int] = {}
        self.member_count = 0
        self.unpacked_bytes = 0
        self.sensitive_filename_count = 0
        self.scan_truncated = False

    def _add_finding(self, bucket: List[Dict[str, str]], finding: Dict[str, str]) -> None:
        key = (finding.get("code", ""), finding.get("path", ""), finding.get("message", ""))
        if key in self._finding_keys:
            return
        if len(self._finding_keys) >= MAX_FINDINGS:
            if not self._finding_limit_reported:
                self._finding_limit_reported = True
                self.scan_truncated = True
                marker = issue("FINDING_LIMIT", "发现项超过有界输出上限，检查已按失败处理")
                self.errors.append(marker)
            return
        self._finding_keys.add(key)
        bucket.append(finding)

    def add_error(self, code: str, message: str, path: Optional[str] = None) -> None:
        self._add_finding(self.errors, issue(code, message, path))

    def add_warning(self, code: str, message: str, path: Optional[str] = None) -> None:
        self._add_finding(self.warnings, issue(code, message, path))

    def add_entry(self, raw_name: str, kind: str, size: int = 0, encrypted: bool = False) -> bool:
        if self.member_count >= MAX_MEMBER_COUNT:
            self.add_error("SOURCE_MEMBER_LIMIT", "成员数量超过 %d 的有界检查上限" % MAX_MEMBER_COUNT)
            self.scan_truncated = True
            return False
        if size < 0 or self.unpacked_bytes + size > MAX_UNPACKED_BYTES:
            self.add_error("SOURCE_SIZE_LIMIT", "声明的未压缩总大小超过 1 GiB 有界检查上限")
            self.scan_truncated = True
            return False

        self.member_count += 1
        self.unpacked_bytes += size
        self.counts[kind] = self.counts.get(kind, 0) + 1
        shown = safe_display(raw_name)
        analysis_name = raw_name
        if len(raw_name) > MAX_PATH_CHARS:
            self.add_error("PATH_TOO_LONG", "成员路径超过 %d 字符的检查上限" % MAX_PATH_CHARS, shown)
            analysis_name = raw_name[:MAX_PATH_CHARS]
        normalized, absolute, traversal = normalized_name(analysis_name)
        if absolute:
            self.add_error("ABSOLUTE_PATH", "成员使用绝对路径", shown)
        if traversal:
            self.add_error("PATH_TRAVERSAL", "成员路径包含父级跳转", shown)
        if normalized in self._seen:
            self.add_error("DUPLICATE_PATH", "多个成员归一化为同一路径", shown)
        else:
            self._seen[normalized] = shown
        folded = normalized.casefold()
        if folded in self._seen_folded and self._seen_folded[folded] != normalized:
            self.add_warning("CASE_COLLISION", "成员路径仅大小写不同，跨平台迁移可能冲突", shown)
        else:
            self._seen_folded[folded] = normalized
        if kind in {"symlink", "hardlink", "special", "unreadable"}:
            self.add_error("UNSAFE_MEMBER_TYPE", "接收源包含链接、特殊或不可读成员：%s" % kind, shown)
        if encrypted:
            self.add_warning("ENCRYPTED_MEMBER", "成员已加密，未检查其内容", shown)
        if is_sensitive_name(normalized):
            self.sensitive_filename_count += 1
            self.add_warning("SENSITIVE_FILENAME", "发现可能包含凭据或秘密的文件名；未读取或回显其值", shown)
        return True

    def inspect_config(self, name: str, raw: Optional[bytes], declared_size: int) -> None:
        shown = safe_display(name)
        if declared_size > MAX_CONFIG_BYTES:
            self.add_warning("CONFIG_TOO_LARGE", "配置超过 1 MiB 安全解析上限，未检查其内容", shown)
            return
        if raw is None:
            return
        for finding in inspect_claude_settings(shown, raw):
            self.add_warning(finding["code"], finding["message"], finding.get("path"))

    def summary(self) -> Dict[str, object]:
        if self.counts.get("file", 0) == 0 and not self.scan_truncated:
            self.add_warning("EMPTY_SOURCE", "接收源不包含普通文件，无法形成有效资产清单")
        return {
            "member_count": self.member_count,
            "counts_by_type": dict(sorted(self.counts.items())),
            "unpacked_bytes": self.unpacked_bytes,
            "sensitive_filename_count": self.sensitive_filename_count,
            "scan_truncated": self.scan_truncated,
            "limits": {
                "max_members": MAX_MEMBER_COUNT,
                "max_unpacked_bytes": MAX_UNPACKED_BYTES,
                "max_archive_bytes": MAX_ARCHIVE_BYTES,
                "max_config_bytes": MAX_CONFIG_BYTES,
                "max_findings": MAX_FINDINGS,
                "max_tar_metadata_entry_bytes": MAX_TAR_METADATA_ENTRY_BYTES,
                "max_tar_metadata_bytes": MAX_TAR_METADATA_BYTES,
                "max_tar_metadata_records": MAX_TAR_METADATA_RECORDS,
                "max_tar_padding_bytes": MAX_TAR_PADDING_BYTES,
            },
        }


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def open_unchanged_regular(path: Path, expected: os.stat_result):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(str(path), flags)
    except OSError as exc:
        raise InspectionReadError("DIRECTORY_READ_ERROR", "无法安全读取目录成员：%s" % type(exc).__name__, safe_display(path.name))
    try:
        actual = os.fstat(descriptor)
        identity = (actual.st_dev, actual.st_ino, actual.st_size, actual.st_nlink)
        expected_identity = (expected.st_dev, expected.st_ino, expected.st_size, expected.st_nlink)
        if not stat.S_ISREG(actual.st_mode) or identity != expected_identity:
            raise InspectionReadError("SOURCE_CHANGED", "目录成员在检查期间发生变化", safe_display(path.name))
        return os.fdopen(descriptor, "rb")
    except Exception:
        os.close(descriptor)
        raise


def scan_directory(root: Path) -> Tuple[InspectionState, Optional[str]]:
    state = InspectionState()
    digest = hashlib.sha256()

    def onerror(error: OSError) -> None:
        target = safe_display(Path(error.filename).name) if error.filename else None
        raise InspectionReadError("DIRECTORY_READ_ERROR", "目录遍历未完整完成：%s" % type(error).__name__, target)

    stop = False
    for current, dirnames, filenames in os.walk(str(root), topdown=True, followlinks=False, onerror=onerror):
        current_path = Path(current)
        dirnames.sort()
        filenames.sort()
        kept_dirs: List[str] = []
        for dirname in dirnames:
            path = current_path / dirname
            relative = path.relative_to(root).as_posix()
            try:
                metadata = path.lstat()
            except OSError as exc:
                raise InspectionReadError(
                    "DIRECTORY_READ_ERROR",
                    "无法读取目录成员元数据：%s" % type(exc).__name__,
                    safe_display(relative),
                )
            kind = "symlink" if stat.S_ISLNK(metadata.st_mode) else "directory"
            if not state.add_entry(relative, kind):
                stop = True
                break
            if kind == "directory":
                kept_dirs.append(dirname)
        dirnames[:] = kept_dirs
        if stop:
            break
        for filename in filenames:
            path = current_path / filename
            relative = path.relative_to(root).as_posix()
            try:
                metadata = path.lstat()
            except OSError as exc:
                raise InspectionReadError(
                    "DIRECTORY_READ_ERROR",
                    "无法读取目录成员元数据：%s" % type(exc).__name__,
                    safe_display(relative),
                )
            if stat.S_ISLNK(metadata.st_mode):
                kind = "symlink"
            elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink > 1:
                kind = "hardlink"
            elif stat.S_ISREG(metadata.st_mode):
                kind = "file"
            else:
                kind = "special"
            if not state.add_entry(relative, kind, metadata.st_size if kind == "file" else 0):
                stop = True
                break
            if kind != "file":
                continue
            digest.update(relative.encode("utf-8", "surrogateescape"))
            digest.update(b"\0")
            config_buffer = bytearray() if config_kind(relative) else None
            with open_unchanged_regular(path, metadata) as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
                    if config_buffer is not None and len(config_buffer) <= MAX_CONFIG_BYTES:
                        remaining = MAX_CONFIG_BYTES + 1 - len(config_buffer)
                        config_buffer.extend(chunk[:remaining])
                final_metadata = os.fstat(handle.fileno())
            if final_metadata.st_size != metadata.st_size or final_metadata.st_mtime_ns != metadata.st_mtime_ns:
                raise InspectionReadError("SOURCE_CHANGED", "目录成员在检查期间发生变化", safe_display(relative))
            digest.update(b"\0")
            if config_buffer is not None:
                state.inspect_config(relative, bytes(config_buffer), metadata.st_size)
        if stop:
            break
    return state, None if state.scan_truncated else digest.hexdigest()


def classify_tar_member(member: tarfile.TarInfo) -> str:
    if member.isdir():
        return "directory"
    if member.isfile():
        return "file"
    if member.issym():
        return "symlink"
    if member.islnk():
        return "hardlink"
    return "special"


def read_exact(stream: object, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))  # type: ignore[attr-defined]
        if not chunk:
            break
        chunks.extend(chunk)
    return bytes(chunks)


def skip_exact(stream: object, size: int) -> None:
    remaining = size
    while remaining:
        chunk = stream.read(min(64 * 1024, remaining))  # type: ignore[attr-defined]
        if not chunk:
            raise tarfile.ReadError("TAR 成员数据被截断")
        remaining -= len(chunk)


def preflight_tar_stream(path: Path) -> None:
    """固定块预检物理 TAR 结构，拒绝隐藏元数据、稀疏成员和尾随归档。"""

    with path.open("rb") as raw:
        magic = raw.read(6)
        raw.seek(0)
        if magic.startswith(b"\x1f\x8b"):
            stream = gzip.GzipFile(fileobj=raw, mode="rb")
        elif magic.startswith(b"BZh"):
            stream = bz2.BZ2File(raw, mode="rb")
        elif magic.startswith(b"\xfd7zXZ\x00"):
            raise ArchiveLimitExceeded(
                "TAR_COMPRESSION_UNSUPPORTED",
                "XZ/LZMA TAR 无法在当前内存上限内安全解码，接收检查按失败处理",
            )
        else:
            stream = raw

        metadata_types = {
            tarfile.XHDTYPE,
            tarfile.XGLTYPE,
            tarfile.SOLARIS_XHDTYPE,
            tarfile.GNUTYPE_LONGNAME,
            tarfile.GNUTYPE_LONGLINK,
        }
        metadata_bytes = 0
        metadata_records = 0
        member_count = 0
        unpacked_bytes = 0
        try:
            while True:
                header = read_exact(stream, tarfile.BLOCKSIZE)
                if not header:
                    raise tarfile.ReadError("TAR 缺少规范的结束块")
                if len(header) != tarfile.BLOCKSIZE:
                    raise tarfile.ReadError("TAR 头被截断")
                if header == tarfile.NUL * tarfile.BLOCKSIZE:
                    second = read_exact(stream, tarfile.BLOCKSIZE)
                    if len(second) != tarfile.BLOCKSIZE or second != tarfile.NUL * tarfile.BLOCKSIZE:
                        raise ArchiveLimitExceeded("TAR_TRAILING_DATA", "TAR 结束标记后出现非规范或截断数据")
                    padding_bytes = 0
                    while True:
                        trailing = stream.read(64 * 1024)
                        if not trailing:
                            return
                        padding_bytes += len(trailing)
                        if padding_bytes > MAX_TAR_PADDING_BYTES:
                            raise ArchiveLimitExceeded(
                                "TAR_PADDING_LIMIT",
                                "TAR 结束标记后的零填充超过 1 MiB 有界检查上限",
                            )
                        if any(trailing):
                            raise ArchiveLimitExceeded("TAR_TRAILING_DATA", "TAR 结束标记后存在非零尾随数据或拼接归档")

                try:
                    stored_checksum = tarfile.nti(header[148:156])
                    unsigned_checksum, signed_checksum = tarfile.calc_chksums(header)
                    size = tarfile.nti(header[124:136])
                except (ValueError, tarfile.HeaderError) as exc:
                    raise tarfile.ReadError("TAR 头数值字段无效") from exc
                if stored_checksum not in {unsigned_checksum, signed_checksum}:
                    raise tarfile.ReadError("TAR 头校验和无效")
                if size < 0:
                    raise tarfile.ReadError("TAR 成员大小为负数")
                type_flag = header[156:157]
                if type_flag == tarfile.GNUTYPE_SPARSE:
                    raise ArchiveLimitExceeded(
                        "TAR_SPARSE_UNSUPPORTED",
                        "TAR sparse 成员不在只读接收检查的有界支持范围内",
                    )
                if type_flag in metadata_types:
                    metadata_records += 1
                    metadata_bytes += size
                    if size > MAX_TAR_METADATA_ENTRY_BYTES:
                        raise ArchiveLimitExceeded(
                            "TAR_METADATA_ENTRY_LIMIT",
                            "单个 TAR PAX/GNU 扩展元数据超过 1 MiB 有界解析上限",
                        )
                    if metadata_bytes > MAX_TAR_METADATA_BYTES or metadata_records > MAX_TAR_METADATA_RECORDS:
                        raise ArchiveLimitExceeded(
                            "TAR_METADATA_LIMIT",
                            "TAR PAX/GNU 扩展元数据超过总量或记录数有界解析上限",
                        )
                else:
                    member_count += 1
                    unpacked_bytes += size
                    if member_count > MAX_MEMBER_COUNT:
                        raise ArchiveLimitExceeded(
                            "SOURCE_MEMBER_LIMIT",
                            "TAR 成员数量超过 %d 的有界检查上限" % MAX_MEMBER_COUNT,
                        )
                    if unpacked_bytes > MAX_UNPACKED_BYTES:
                        raise ArchiveLimitExceeded(
                            "SOURCE_SIZE_LIMIT",
                            "声明的未压缩总大小超过 1 GiB 有界检查上限",
                        )
                padded_size = ((size + tarfile.BLOCKSIZE - 1) // tarfile.BLOCKSIZE) * tarfile.BLOCKSIZE
                skip_exact(stream, padded_size)
        finally:
            if stream is not raw:
                stream.close()


class BoundedTarInfo(tarfile.TarInfo):
    """在 stdlib 展开隐藏的 PAX/GNU 元数据前应用独立限额。"""

    def _register_metadata(self, archive: tarfile.TarFile) -> None:
        padded_size = self._block(max(self.size, 0))
        record_count = getattr(archive, "_inspection_metadata_records", 0) + 1
        total_size = getattr(archive, "_inspection_metadata_bytes", 0) + padded_size
        if self.size < 0 or self.size > MAX_TAR_METADATA_ENTRY_BYTES:
            raise ArchiveLimitExceeded(
                "TAR_METADATA_ENTRY_LIMIT",
                "单个 TAR PAX/GNU 扩展元数据超过 1 MiB 有界解析上限",
            )
        if total_size > MAX_TAR_METADATA_BYTES or record_count > MAX_TAR_METADATA_RECORDS:
            raise ArchiveLimitExceeded(
                "TAR_METADATA_LIMIT",
                "TAR PAX/GNU 扩展元数据超过总量或记录数有界解析上限",
            )
        setattr(archive, "_inspection_metadata_records", record_count)
        setattr(archive, "_inspection_metadata_bytes", total_size)

    def _proc_pax(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        self._register_metadata(archive)
        return super()._proc_pax(archive)

    def _proc_gnulong(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        self._register_metadata(archive)
        return super()._proc_gnulong(archive)

    def _reject_sparse(self) -> None:
        raise ArchiveLimitExceeded(
            "TAR_SPARSE_UNSUPPORTED",
            "TAR sparse 元数据不在只读接收检查的有界支持范围内",
        )

    def _proc_sparse(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        self._reject_sparse()

    def _proc_gnusparse_00(self, next_member: tarfile.TarInfo, pax_headers: Dict[str, str], raw: bytes) -> None:
        self._reject_sparse()

    def _proc_gnusparse_01(self, next_member: tarfile.TarInfo, pax_headers: Dict[str, str]) -> None:
        self._reject_sparse()

    def _proc_gnusparse_10(
        self,
        next_member: tarfile.TarInfo,
        pax_headers: Dict[str, str],
        archive: tarfile.TarFile,
    ) -> None:
        self._reject_sparse()


def scan_tar(path: Path) -> InspectionState:
    state = InspectionState()
    try:
        preflight_tar_stream(path)
        with tarfile.open(str(path), mode="r|*", tarinfo=BoundedTarInfo) as archive:
            while True:
                member = archive.next()
                if member is None:
                    break
                kind = classify_tar_member(member)
                if member.issparse():
                    raise ArchiveLimitExceeded(
                        "TAR_SPARSE_UNSUPPORTED",
                        "TAR sparse 成员不在只读接收检查的有界支持范围内",
                    )
                if not state.add_entry(member.name, kind, max(member.size, 0)):
                    archive.members.clear()
                    break
                if kind == "file" and config_kind(member.name):
                    if member.size > MAX_CONFIG_BYTES:
                        state.inspect_config(member.name, None, member.size)
                    else:
                        try:
                            extracted = archive.extractfile(member)
                            if extracted is None:
                                raise OSError("member is not readable")
                            with extracted:
                                raw = extracted.read(MAX_CONFIG_BYTES + 1)
                        except (OSError, tarfile.TarError) as exc:
                            raise InspectionReadError(
                                "ARCHIVE_MEMBER_READ_ERROR",
                                "无法读取归档配置成员：%s" % type(exc).__name__,
                                safe_display(member.name),
                            )
                        state.inspect_config(member.name, raw, member.size)
                # Python 3.8 的流式 TarFile 仍会保留 members；逐项清空以维持常量级 TarInfo 内存。
                archive.members.clear()
    except ArchiveLimitExceeded as exc:
        state.add_error(exc.code, str(exc))
        state.scan_truncated = True
    return state


def find_zip_eocd(path: Path) -> Tuple[int, int, int, int, int, int, int]:
    size = path.stat().st_size
    with path.open("rb") as handle:
        tail_start = max(0, size - ZIP_EOCD_SCAN_BYTES)
        handle.seek(tail_start)
        tail = handle.read(ZIP_EOCD_SCAN_BYTES)
    position = len(tail)
    while True:
        position = tail.rfind(b"PK\x05\x06", 0, position)
        if position < 0:
            raise zipfile.BadZipFile("未找到有效的 ZIP 中央目录结束记录")
        if position + 22 <= len(tail):
            values = struct.unpack_from("<4s4H2LH", tail, position)
            comment_length = values[-1]
            if position + 22 + comment_length == len(tail):
                return values[1], values[2], values[3], values[4], values[5], values[6], tail_start + position


def decode_zip_name(raw_name: bytes, flags: int) -> str:
    encoding = "utf-8" if flags & 0x800 else "cp437"
    return raw_name.decode(encoding)


def inspect_zip_name(state: InspectionState, name: str, location: str) -> None:
    shown = safe_display(name)
    analysis_name = name
    if len(name) > MAX_PATH_CHARS:
        state.add_error("PATH_TOO_LONG", "ZIP 路径超过 %d 字符的检查上限" % MAX_PATH_CHARS, location)
        analysis_name = name[:MAX_PATH_CHARS]
    _, absolute, traversal = normalized_name(analysis_name)
    if absolute:
        state.add_error("ABSOLUTE_PATH", "ZIP 路径视图使用绝对路径", shown)
    if traversal:
        state.add_error("PATH_TRAVERSAL", "ZIP 路径视图包含父级跳转", shown)


def inspect_zip_extra(
    state: InspectionState,
    extra: bytes,
    primary_name_raw: bytes,
    primary_name: str,
    location: str,
) -> None:
    offset = 0
    seen: Set[int] = set()
    while offset < len(extra):
        if len(extra) - offset < 4:
            state.add_error("ZIP_EXTRA_INVALID", "ZIP extra field 头被截断", location)
            return
        field_id, field_size = struct.unpack_from("<HH", extra, offset)
        offset += 4
        if field_size > len(extra) - offset:
            state.add_error("ZIP_EXTRA_INVALID", "ZIP extra field 内容被截断", location)
            return
        payload = extra[offset : offset + field_size]
        offset += field_size
        if field_id in seen:
            state.add_error("ZIP_EXTRA_DUPLICATE", "ZIP extra field 标识重复：0x%04x" % field_id, location)
        seen.add(field_id)
        if field_id != 0x7075:
            continue
        if len(payload) < 5 or payload[0] != 1:
            state.add_error("ZIP_UNICODE_PATH_INVALID", "Info-ZIP Unicode Path extra field 无效", location)
            continue
        expected_crc = struct.unpack_from("<L", payload, 1)[0]
        if expected_crc != zlib.crc32(primary_name_raw) & 0xFFFFFFFF:
            state.add_error("ZIP_UNICODE_PATH_INVALID", "Info-ZIP Unicode Path CRC 与主文件名不一致", location)
            continue
        try:
            alternate_name = payload[5:].decode("utf-8")
        except UnicodeDecodeError:
            state.add_error("ZIP_UNICODE_PATH_INVALID", "Info-ZIP Unicode Path 不是有效 UTF-8", location)
            continue
        inspect_zip_name(state, alternate_name, location)
        if alternate_name != primary_name:
            state.add_error("ZIP_ALTERNATE_PATH", "ZIP alternate path 与主文件名不一致", location)


def preflight_zip_central_directory(
    path: Path,
    central_start: int,
    central_size: int,
    entries_total: int,
    state: InspectionState,
) -> None:
    file_size = path.stat().st_size
    if central_start < 0 or central_start + central_size > file_size:
        state.add_error("ZIP_CENTRAL_DIRECTORY_RANGE", "ZIP 中央目录范围越界")
        return
    consumed = 0
    count = 0
    with path.open("rb") as handle:
        handle.seek(central_start)
        while consumed < central_size:
            fixed = handle.read(46)
            if len(fixed) != 46 or fixed[:4] != b"PK\x01\x02":
                state.add_error("ZIP_CENTRAL_DIRECTORY_INVALID", "ZIP 中央目录记录无效或包含不支持的数据")
                return
            values = struct.unpack("<4s6H3L5H2L", fixed)
            flags = values[3]
            name_length, extra_length, comment_length = values[10], values[11], values[12]
            variable_size = name_length + extra_length + comment_length
            if consumed + 46 + variable_size > central_size:
                state.add_error("ZIP_CENTRAL_DIRECTORY_INVALID", "ZIP 中央目录可变字段越界")
                return
            raw_name = handle.read(name_length)
            extra = handle.read(extra_length)
            comment = handle.read(comment_length)
            if len(raw_name) != name_length or len(extra) != extra_length or len(comment) != comment_length:
                state.add_error("ZIP_CENTRAL_DIRECTORY_INVALID", "ZIP 中央目录被截断")
                return
            count += 1
            if count > MAX_MEMBER_COUNT:
                state.add_error("SOURCE_MEMBER_LIMIT", "ZIP 实际成员数量超过 %d 的有界检查上限" % MAX_MEMBER_COUNT)
                state.scan_truncated = True
                return
            try:
                decoded_name = decode_zip_name(raw_name, flags)
            except UnicodeDecodeError:
                state.add_error("ZIP_FILENAME_ENCODING", "ZIP 中央目录文件名编码无效", "central:%d" % count)
                decoded_name = ""
            if decoded_name:
                inspect_zip_name(state, decoded_name, "central:%d" % count)
                inspect_zip_extra(state, extra, raw_name, decoded_name, "central:%d" % count)
            consumed += 46 + variable_size
    if consumed != central_size or count != entries_total:
        state.add_error(
            "ZIP_ENTRY_COUNT_MISMATCH",
            "ZIP EOCD 声明 %d 个成员，但中央目录实际为 %d" % (entries_total, count),
        )


def inspect_zip_local_header(
    path: Path,
    member: zipfile.ZipInfo,
    central_start: int,
    state: InspectionState,
) -> None:
    location = "local:%s" % safe_display(member.filename)
    if member.header_offset < 0 or member.header_offset + 30 > central_start:
        state.add_error("ZIP_LOCAL_HEADER_RANGE", "ZIP local header 范围越界", location)
        return
    with path.open("rb") as handle:
        handle.seek(member.header_offset)
        fixed = handle.read(30)
        if len(fixed) != 30 or fixed[:4] != b"PK\x03\x04":
            state.add_error("ZIP_LOCAL_HEADER_INVALID", "ZIP local header 无效", location)
            return
        values = struct.unpack("<4s5H3L2H", fixed)
        flags, compression = values[2], values[3]
        name_length, extra_length = values[9], values[10]
        raw_name = handle.read(name_length)
        extra = handle.read(extra_length)
    if len(raw_name) != name_length or len(extra) != extra_length:
        state.add_error("ZIP_LOCAL_HEADER_INVALID", "ZIP local header 可变字段被截断", location)
        return
    try:
        local_name = decode_zip_name(raw_name, flags)
    except UnicodeDecodeError:
        state.add_error("ZIP_FILENAME_ENCODING", "ZIP local header 文件名编码无效", location)
        return
    inspect_zip_name(state, local_name, location)
    inspect_zip_extra(state, extra, raw_name, local_name, location)
    if local_name != member.filename:
        state.add_error("ZIP_FILENAME_MISMATCH", "ZIP local 与 central 文件名不一致", location)
    if flags != member.flag_bits:
        state.add_error("ZIP_FLAGS_MISMATCH", "ZIP local 与 central flags 不一致", location)
    if compression != member.compress_type:
        state.add_error("ZIP_METHOD_MISMATCH", "ZIP local 与 central 压缩方法不一致", location)
    data_start = member.header_offset + 30 + name_length + extra_length
    if data_start + member.compress_size > central_start:
        state.add_error("ZIP_MEMBER_RANGE", "ZIP 成员压缩数据与中央目录重叠或越界", location)


def scan_zip(path: Path) -> InspectionState:
    state = InspectionState()
    disk, central_disk, entries_disk, entries_total, central_size, central_offset, eocd_offset = find_zip_eocd(path)
    if disk != 0 or central_disk != 0 or entries_disk != entries_total:
        state.add_error("ZIP_MULTIDISK_UNSUPPORTED", "不接收多卷 ZIP；无法在当前边界内完整核验")
        state.scan_truncated = True
        return state
    if entries_total == 0xFFFF or central_size == 0xFFFFFFFF or central_offset == 0xFFFFFFFF:
        state.add_error("ZIP64_LIMIT", "ZIP64 超出当前有界接收范围")
        state.scan_truncated = True
        return state
    if entries_total > MAX_MEMBER_COUNT:
        state.add_error("SOURCE_MEMBER_LIMIT", "ZIP 成员数量超过 %d 的有界检查上限" % MAX_MEMBER_COUNT)
        state.scan_truncated = True
        return state
    if central_size > MAX_CENTRAL_DIRECTORY_BYTES:
        state.add_error("ZIP_CENTRAL_DIRECTORY_LIMIT", "ZIP 中央目录超过 16 MiB 有界检查上限")
        state.scan_truncated = True
        return state

    central_start = eocd_offset - central_size
    preflight_zip_central_directory(path, central_start, central_size, entries_total, state)
    if state.errors:
        state.scan_truncated = True
        return state

    with zipfile.ZipFile(str(path), mode="r") as archive:
        for member in archive.infolist():
            inspect_zip_local_header(path, member, central_start, state)
            if member.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2}:
                state.add_error(
                    "ZIP_COMPRESSION_UNSUPPORTED",
                    "ZIP 成员使用无法在当前内存边界内安全检查的压缩方法：%d" % member.compress_type,
                    safe_display(member.filename),
                )
            mode = (member.external_attr >> 16) & 0o170000
            if member.is_dir():
                kind = "directory"
            elif mode == stat.S_IFLNK:
                kind = "symlink"
            elif mode not in {0, stat.S_IFREG}:
                kind = "special"
            else:
                kind = "file"
            encrypted = bool(member.flag_bits & 0x1)
            if not state.add_entry(member.filename, kind, max(member.file_size, 0), encrypted=encrypted):
                break
            if kind != "file" or not config_kind(member.filename):
                continue
            if member.file_size > MAX_CONFIG_BYTES:
                state.inspect_config(member.filename, None, member.file_size)
            elif encrypted:
                continue
            else:
                try:
                    raw = archive.read(member)
                except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
                    raise InspectionReadError(
                        "ARCHIVE_MEMBER_READ_ERROR",
                        "无法读取归档配置成员：%s" % type(exc).__name__,
                        safe_display(member.filename),
                    )
                state.inspect_config(member.filename, raw, member.file_size)
    return state


def result_for_state(
    state: InspectionState,
    source_kind: str,
    digest: Optional[str],
    digest_scope: str,
) -> Tuple[Dict[str, object], int]:
    summary = state.summary()
    summary.update(
        {
            "source_kind": source_kind,
            "sha256": digest,
            "digest_scope": digest_scope if digest is not None else "incomplete",
        }
    )
    if state.errors:
        status = "fail"
        exit_code = 1
    elif state.warnings:
        status = "review_required"
        exit_code = 1
    else:
        status = "pass"
        exit_code = 0
    result: Dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "errors": state.errors,
        "warnings": state.warnings,
        "manual_checks": [
            "确认资产来源、许可证和数据处理授权。",
            "逐项重建目标 Runtime 的权限、Hook、工具和网络边界；不得原样激活旧配置。",
            "选择一个明确研究问题，在新的 Experiment 中用目标 Runtime 重新观察。",
        ],
        "summary": summary,
    }
    return result, exit_code


def run(source: Path) -> Tuple[Dict[str, object], int]:
    if not source.exists():
        raise FileNotFoundError(str(source))
    if source.is_symlink():
        raise ValueError("根输入不得是符号链接")
    if source.is_dir():
        state, digest = scan_directory(source)
        return result_for_state(state, "directory", digest, "directory_tree")
    if not source.is_file():
        raise ValueError("输入既不是普通文件也不是目录")

    archive_size = source.stat().st_size
    if archive_size > MAX_ARCHIVE_BYTES:
        state = InspectionState()
        state.add_error("SOURCE_ARCHIVE_SIZE_LIMIT", "归档文件超过 1 GiB 接收检查上限")
        state.scan_truncated = True
        return result_for_state(state, "archive", None, "incomplete")

    digest = file_digest(source)
    if zipfile.is_zipfile(str(source)):
        state = scan_zip(source)
        return result_for_state(state, "zip", digest, "archive_file")
    try:
        state = scan_tar(source)
    except tarfile.ReadError as exc:
        raise ValueError("仅支持目录、tar 系列归档或 zip 归档") from exc
    return result_for_state(state, "tar", digest, "archive_file")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="待只读清点的目录、tar 或 zip")
    args = parser.parse_args(argv)
    try:
        result, code = run(args.source)
    except InspectionReadError as exc:
        result = {
            "schema_version": SCHEMA_VERSION,
            "status": "error",
            "errors": [issue(exc.code, str(exc), exc.path)],
            "warnings": [],
            "manual_checks": [],
            "summary": {},
        }
        code = 2
    except (EOFError, MemoryError, OSError, ValueError, RecursionError, lzma.LZMAError, tarfile.TarError, zipfile.BadZipFile) as exc:
        result = {
            "schema_version": SCHEMA_VERSION,
            "status": "error",
            "errors": [issue("INPUT_ERROR", "%s: %s" % (type(exc).__name__, str(exc)))],
            "warnings": [],
            "manual_checks": [],
            "summary": {},
        }
        code = 2
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
