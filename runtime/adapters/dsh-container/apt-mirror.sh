#!/bin/sh
set -eu

task_main_mirror="${1:-http://deb.debian.org/debian}"
task_sources=/etc/apt/sources.list.d/debian.sources

case "$task_main_mirror" in
  http://deb.debian.org/debian)
    task_security_mirror=http://deb.debian.org/debian-security
    ;;
  http://mirrors.tuna.tsinghua.edu.cn/debian)
    task_security_mirror=http://mirrors.tuna.tsinghua.edu.cn/debian-security
    ;;
  *)
    printf 'Unsupported apt mirror: %s\n' "$task_main_mirror" >&2
    exit 2
    ;;
esac

test -f "$task_sources"
test "$(grep -c '^Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg$' "$task_sources")" -eq 2
grep -q '^URIs: http://deb.debian.org/debian$' "$task_sources"
grep -q '^URIs: http://deb.debian.org/debian-security$' "$task_sources"

if [ "$task_main_mirror" != http://deb.debian.org/debian ]; then
  # 不在双引号 sed 表达式使用行尾 `$#`，避免 shell 展开 `$#` 参数个数。
  # 原始 URI 先被精确 grep 锁定；security 优先替换，避免 main 前缀误匹配。
  sed -i \
    -e "s#^URIs: http://deb.debian.org/debian-security#URIs: $task_security_mirror#" \
    -e "s#^URIs: http://deb.debian.org/debian#URIs: $task_main_mirror#" \
    "$task_sources"
fi

grep -Fqx "URIs: $task_main_mirror" "$task_sources"
grep -Fqx "URIs: $task_security_mirror" "$task_sources"
test "$(grep -c '^Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg$' "$task_sources")" -eq 2

# APT 核验 Release/InRelease 签名、Suite 与 Valid-Until；任一索引失败即中止。
apt-get -o APT::Update::Error-Mode=any \
  -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::ForceIPv4=true update
