#!/usr/bin/env python3
"""在启动前检查固定容器 UID/GID 对装载源的基本 POSIX 访问权限。"""

import argparse
import os
import stat
import sys
from pathlib import Path


RUNTIME_UID = 1000
RUNTIME_GID = 1000


def permits(path: Path, mask: int) -> bool:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        raise ValueError(f"symlinked mount path: {path}")
    if info.st_uid == RUNTIME_UID:
        bits = (info.st_mode >> 6) & 7
    elif info.st_gid == RUNTIME_GID:
        bits = (info.st_mode >> 3) & 7
    else:
        bits = info.st_mode & 7
    return (bits & mask) == mask


def check_source(path: Path, *, writable: bool) -> None:
    path = path.absolute()
    for ancestor in reversed(path.parents):
        if not permits(ancestor, 1):
            raise ValueError(f"UID/GID 1000:1000 cannot traverse host directory: {ancestor}")
    if not path.is_dir() or not permits(path, 7 if writable else 5):
        access = "read/write/traverse" if writable else "read/traverse"
        raise ValueError(f"UID/GID 1000:1000 lacks {access} on mount source: {path}")
    for folder, dirs, files in os.walk(path, followlinks=False):
        for name in dirs:
            child = Path(folder) / name
            if not child.is_dir() or not permits(child, 7 if writable else 5):
                raise ValueError(f"UID/GID 1000:1000 cannot access mounted directory: {child}")
        for name in files:
            child = Path(folder) / name
            if not child.is_file() or not permits(child, 4):
                raise ValueError(f"UID/GID 1000:1000 cannot read mounted file: {child}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("authoring", "verification"))
    parser.add_argument("workspace", type=Path)
    parser.add_argument("presets", type=Path)
    parser.add_argument("managed", type=Path)
    parser.add_argument("context", type=Path, nargs="*", help="只读上下文数据资产根（spec、eval-input）")
    args = parser.parse_args()
    try:
        check_source(args.workspace, writable=args.mode == "authoring")
        check_source(args.presets, writable=False)
        check_source(args.managed, writable=False)
        for source in args.context:
            check_source(source, writable=False)
    except (OSError, ValueError) as error:
        print(f"DSH mount access preflight failed: {error}", file=sys.stderr)
        print("Use a source readable by container UID/GID 1000:1000; Authoring workspace also needs write access. "
              "Adjust only the selected source ownership/group permissions deliberately; do not run the container as root.",
              file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
