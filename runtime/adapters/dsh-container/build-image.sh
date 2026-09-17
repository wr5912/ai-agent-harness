#!/usr/bin/env bash
set -euo pipefail

task_adapter_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
task_repo_dir="$(cd "$task_adapter_dir/../../.." && pwd -P)"
task_source_dir=""
task_source_commit="c291e7961a515f6d7af9304e7fd1d257929aef26"
task_source_tree="e482b49bef64726be8f79380bb35bae569dc3c48"
task_lock_sha="66d87ed26fe3205172560351e13fe4aa736b66c15a29f7dd873c629fc80906de"
task_image_tag="ai-agent-harness/dsh:c291e7961"
task_evidence_file=""
task_build_network="default"
task_apt_mirror="http://deb.debian.org/debian"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      printf 'Usage: %s [--evidence-output FILE] [--build-network host] [--apt-mirror http://mirrors.tuna.tsinghua.edu.cn/debian]\n' "$0"
      printf 'Build locked official DSH source; host network is opt-in for local build egress only.\n'
      exit 0
      ;;
    --evidence-output)
      if [[ $# -lt 2 || -n "$task_evidence_file" ]]; then
        printf 'Missing or duplicate --evidence-output value\n' >&2
        exit 2
      fi
      task_evidence_file="$2"
      shift 2
      ;;
    --build-network)
      if [[ $# -lt 2 || "$2" != host || "$task_build_network" != default ]]; then
        printf 'Only one explicit --build-network host is supported\n' >&2
        exit 2
      fi
      task_build_network="host"
      shift 2
      ;;
    --apt-mirror)
      if [[ $# -lt 2 || "$2" != http://mirrors.tuna.tsinghua.edu.cn/debian || "$task_apt_mirror" != http://deb.debian.org/debian ]]; then
        printf 'Only one exact HTTP Tsinghua Debian mirror is supported\n' >&2
        exit 2
      fi
      task_apt_mirror="$2"
      shift 2
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done
if [[ -z "$task_evidence_file" ]]; then
  task_evidence_file="$task_repo_dir/evolution/experiments/EXP-security-operations-expert-001/evaluation/dsh-image-build-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
fi

task_cleanup() {
  if [[ -n "$task_source_dir" && -d "$task_source_dir" && "$task_source_dir" == /tmp/dsh-adapter-source.* ]]; then
    rm -rf -- "$task_source_dir"
  fi
}
trap task_cleanup EXIT

command -v git >/dev/null
command -v docker >/dev/null
command -v python3 >/dev/null

python3 - "$task_adapter_dir/source.lock.json" "$task_source_commit" "$task_source_tree" "$task_lock_sha" "$task_image_tag" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    lock = json.load(source)
expected = {
    "repository": "https://github.com/deepseek-ai/deepseek-harness.git",
    "commit": sys.argv[2],
    "tree": sys.argv[3],
    "pnpm_lock_sha256": sys.argv[4],
    "package_manager": "pnpm@11.7.0",
    "node_base": "node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553",
    "local_image_tag": sys.argv[5],
    "platform": "linux/amd64",
}
for field, value in expected.items():
    if lock.get(field) != value:
        raise SystemExit(f"source.lock.json identity mismatch: {field}")
PY

task_source_dir="$(mktemp -d /tmp/dsh-adapter-source.XXXXXXXX)"
git -C "$task_source_dir" init -q
git -C "$task_source_dir" remote add origin https://github.com/deepseek-ai/deepseek-harness.git
git -C "$task_source_dir" fetch --depth=1 origin "$task_source_commit"
git -C "$task_source_dir" checkout --detach --quiet FETCH_HEAD

[[ "$(git -C "$task_source_dir" rev-parse HEAD)" == "$task_source_commit" ]]
[[ "$(git -C "$task_source_dir" rev-parse HEAD^{tree})" == "$task_source_tree" ]]
[[ "$(sha256sum "$task_source_dir/pnpm-lock.yaml" | cut -d ' ' -f 1)" == "$task_lock_sha" ]]

# 使用同一固定 Node 底座与 mirror 规则先签名核验 main/updates/security 索引。
# 如果镜像缺 security、签名或 Valid-Until 不通过，不进入耗时的 DSH 构建。
docker run --rm --network "$task_build_network" \
  --mount "type=bind,src=$task_adapter_dir/apt-mirror.sh,dst=/opt/dsh-adapter/apt-mirror.sh,readonly" \
  --entrypoint sh \
  node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 \
  /opt/dsh-adapter/apt-mirror.sh "$task_apt_mirror"

docker buildx build \
  --platform linux/amd64 \
  --network "$task_build_network" \
  --build-context "dsh_source=$task_source_dir" \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$task_source_commit" \
  --build-arg "DSH_LOCK_SHA256=$task_lock_sha" \
  --build-arg "DSH_APT_MIRROR=$task_apt_mirror" \
  --load \
  -t "$task_image_tag" \
  -f "$task_adapter_dir/Dockerfile" \
  "$task_adapter_dir"

task_image_id="$(docker image inspect "$task_image_tag" --format '{{.Id}}')"
task_image_platform="$(docker image inspect "$task_image_tag" --format '{{.Os}}/{{.Architecture}}')"
task_runtime_version="$(docker run --rm --entrypoint node "$task_image_tag" /opt/dsh/apps/cli/lib/bin.js --version)"
[[ "$task_image_platform" == linux/amd64 ]]
[[ "$task_runtime_version" == 0.1.5-rc.2 ]]

python3 - "$task_evidence_file" "$task_source_commit" "$task_source_tree" "$task_lock_sha" "$task_image_tag" "$task_image_id" "$task_image_platform" "$task_runtime_version" "$task_build_network" "$task_apt_mirror" <<'PY'
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

target = Path(sys.argv[1]).absolute()
target.parent.mkdir(parents=True, exist_ok=True)
evidence = {
    "schema_version": "1.0",
    "recorded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "build_status": "pass",
    "source_repository": "https://github.com/deepseek-ai/deepseek-harness.git",
    "source_commit": sys.argv[2],
    "source_tree": sys.argv[3],
    "pnpm_lock_sha256": sys.argv[4],
    "package_manager": "pnpm@11.7.0",
    "node_base": "node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553",
    "local_image_tag": sys.argv[5],
    "local_image_id": sys.argv[6],
    "platform": sys.argv[7],
    "dsh_cli_version": sys.argv[8],
    "build_network_mode": sys.argv[9],
    "apt_mirror_main": sys.argv[10],
    "apt_mirror_security": sys.argv[10] + "-security",
    "apt_signed_metadata_preflight": "pass",
    "registry_digest_verified": False,
    "scope": "local image build and CLI identity only; no Harness or business acceptance",
}
with target.open("x", encoding="utf-8") as output:
    json.dump(evidence, output, ensure_ascii=False, indent=2)
    output.write("\n")
PY

printf 'DSH source commit: %s\n' "$task_source_commit"
printf 'DSH image tag: %s\n' "$task_image_tag"
printf 'Local image ID: %s\n' "$task_image_id"
printf 'DSH CLI version: %s\n' "$task_runtime_version"
printf 'Build network mode: %s\n' "$task_build_network"
printf 'APT mirror main: %s\n' "$task_apt_mirror"
printf 'Registry digest: not available until the image is pushed and verified\n'
printf 'Build evidence: %s\n' "$task_evidence_file"
