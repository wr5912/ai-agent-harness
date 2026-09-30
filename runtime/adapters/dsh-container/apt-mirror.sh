#!/bin/sh
# 把基础镜像的 Debian APT 主源切换到指定镜像，并在切换后强制签名核验。
# 默认使用 TUNA 主源和 Debian 官方 security；仅在 TUNA 不可达时显式改回官方主源。
set -eu

tuna_main=http://mirrors.tuna.tsinghua.edu.cn/debian
official_main=http://deb.debian.org/debian
official_security=http://deb.debian.org/debian-security

task_main_mirror="${1:-$tuna_main}"
task_security_mirror="$official_security"

case "$task_main_mirror" in
  "$tuna_main"|"$official_main")
    ;;
  *)
    printf 'Unsupported apt mirror: %s\n' "$task_main_mirror" >&2
    exit 2
    ;;
esac

task_sources=/etc/apt/sources.list.d/debian.sources

test -f "$task_sources"
test "$(grep -c '^Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg$' "$task_sources")" -eq 2
grep -q "^URIs: $official_main\$" "$task_sources"
grep -q "^URIs: $official_security\$" "$task_sources"

if [ "$task_main_mirror" != "$official_main" ]; then
  # 原始 URI 已被精确 grep 锁定；security 始终保留 Debian 官方源。
  sed -i "s#^URIs: $official_main\$#URIs: $task_main_mirror#" "$task_sources"
fi

grep -Fqx "URIs: $task_main_mirror" "$task_sources"
grep -Fqx "URIs: $task_security_mirror" "$task_sources"
test "$(grep -c '^Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg$' "$task_sources")" -eq 2

# APT 核验 Release/InRelease 签名、Suite 与 Valid-Until；任一索引失败即中止。
apt-get -o APT::Update::Error-Mode=any \
  -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::ForceIPv4=true update
