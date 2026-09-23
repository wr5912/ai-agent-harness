#!/bin/sh
# 把基础镜像的 Debian APT 源切换到指定的国内镜像，并在切换后强制签名核验。
# 默认使用阿里云镜像；仅在镜像不可达时，调用方可以显式改回 Debian 官方源。
set -eu

aliyun_main=http://mirrors.aliyun.com/debian
aliyun_security=http://mirrors.aliyun.com/debian-security
official_main=http://deb.debian.org/debian
official_security=http://deb.debian.org/debian-security

task_main_mirror="${1:-$aliyun_main}"

case "$task_main_mirror" in
  "$aliyun_main")
    task_security_mirror="$aliyun_security"
    ;;
  "$official_main")
    task_security_mirror="$official_security"
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
  # 不在双引号 sed 表达式使用行尾 `$#`，避免 shell 展开 `$#` 参数个数。
  # 原始 URI 先被精确 grep 锁定；security 优先替换，避免 main 前缀误匹配。
  sed -i \
    -e "s#^URIs: $official_security#URIs: $task_security_mirror#" \
    -e "s#^URIs: $official_main#URIs: $task_main_mirror#" \
    "$task_sources"
fi

grep -Fqx "URIs: $task_main_mirror" "$task_sources"
grep -Fqx "URIs: $task_security_mirror" "$task_sources"
test "$(grep -c '^Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg$' "$task_sources")" -eq 2

# APT 核验 Release/InRelease 签名、Suite 与 Valid-Until；任一索引失败即中止。
apt-get -o APT::Update::Error-Mode=any \
  -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::ForceIPv4=true update
