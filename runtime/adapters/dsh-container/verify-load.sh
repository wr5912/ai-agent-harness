#!/usr/bin/env bash
set -euo pipefail

task_adapter_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
task_repo_dir="$(cd "$task_adapter_dir/../../.." && pwd -P)"
task_mode="${1:-verification}"

if [[ "$task_mode" == --help ]]; then
  printf 'Usage: %s [authoring|verification]\n' "$0"
  printf 'Compare exact host/container mounts and DSH composed config; no business acceptance.\n'
  exit 0
fi
if [[ "$task_mode" != authoring && "$task_mode" != verification ]]; then
  printf 'Usage: %s [authoring|verification]\n' "$0" >&2
  exit 2
fi

task_candidate_root="$task_repo_dir/evolution/experiments/EXP-security-operations-expert-001/candidate/dsh"
task_workspace_sha="$(python3 "$task_adapter_dir/mutation-receipt.py" digest "$task_candidate_root/workspace")"
task_presets_sha="$(python3 "$task_adapter_dir/mutation-receipt.py" digest "$task_candidate_root/presets")"
task_managed_sha="$(python3 "$task_adapter_dir/mutation-receipt.py" digest "$task_candidate_root/managed")"
task_user_patch_sha=""
task_web_manifest_sha=""
task_global_agents_sha=""
task_bootstrap_env_sha=""
task_module_deny_sha=""
task_prepare_script_sha=""
task_verify_script_sha=""
task_tree_script_sha=""

task_user_patch_sha="sha256:$(sha256sum "$task_adapter_dir/verification-home-controls/locked-user.patch.yml" | cut -d ' ' -f 1)"
task_web_manifest_sha="sha256:$(sha256sum "$task_adapter_dir/verification-home-controls/web-profile.package.json" | cut -d ' ' -f 1)"
task_global_agents_sha="sha256:$(sha256sum "$task_adapter_dir/verification-home-controls/locked-global.AGENTS.md" | cut -d ' ' -f 1)"
task_bootstrap_env_sha="sha256:$(sha256sum "$task_adapter_dir/verification-home-controls/locked-bootstrap.env" | cut -d ' ' -f 1)"
task_module_deny_sha="sha256:$(sha256sum "$task_adapter_dir/verification-home-controls/module-deny/POLICY.md" | cut -d ' ' -f 1)"
task_prepare_script_sha="sha256:$(sha256sum "$task_adapter_dir/prepare-verification-home.mjs" | cut -d ' ' -f 1)"
task_verify_script_sha="sha256:$(sha256sum "$task_adapter_dir/verify-load.mjs" | cut -d ' ' -f 1)"
task_tree_script_sha="sha256:$(sha256sum "$task_adapter_dir/tree-digest.mjs" | cut -d ' ' -f 1)"

# Docker 会在 RW parent bind 下为缺失的 nested file target 隐式创建宿主文件。
# 这里要求 Candidate owner 的仅注释 sentinel 精确存在，禁止隐式写入或私密 .env。
task_workspace_env="$task_candidate_root/workspace/.env"
task_workspace_env_sentinel_sha="e574f8d1faf66f9167c33055ae1e2f99c70b031811f64aaac5bae1be54a19489"
if [[ ! -f "$task_workspace_env" || -L "$task_workspace_env" ]] \
  || [[ "$(stat -c '%h' "$task_workspace_env")" != 1 ]] \
  || [[ "$(sha256sum "$task_workspace_env" | cut -d ' ' -f 1)" != "$task_workspace_env_sentinel_sha" ]]; then
  printf 'Candidate workspace .env mount target is absent or differs from controlled comment-only sentinel.\n' >&2
  exit 1
fi

docker compose -f "$task_adapter_dir/$task_mode.compose.yaml" config --quiet
docker image inspect ai-agent-harness/dsh:c291e7961 >/dev/null

# 先在无卷、只读、无网络的容器中核 image 内三脚本身份，避免旧标签
# 在发现不匹配前触碰 HOME/fallback 数据卷；主探针还会二次复核。
task_image_script_hashes="$(docker run --rm --network none --read-only --user 1000:1000 \
  --entrypoint sha256sum ai-agent-harness/dsh:c291e7961 \
  /opt/dsh-adapter/prepare-verification-home.mjs \
  /opt/dsh-adapter/verify-load.mjs \
  /opt/dsh-adapter/tree-digest.mjs)"
for task_script_record in \
  "${task_prepare_script_sha#sha256:} /opt/dsh-adapter/prepare-verification-home.mjs" \
  "${task_verify_script_sha#sha256:} /opt/dsh-adapter/verify-load.mjs" \
  "${task_tree_script_sha#sha256:} /opt/dsh-adapter/tree-digest.mjs"; do
  if ! awk -v wanted="$task_script_record" '{ if (($1 " " $2) == wanted) found=1 } END { exit !found }' \
    <<<"$task_image_script_hashes"; then
    printf 'The local DSH image contains stale adapter scripts; rebuild before touching HOME volumes.\n' >&2
    exit 1
  fi
done

# `run --no-deps` 会跳过 Compose depends_on；两种模式都先显式准备首次
# 空数据卷的精确子文件与模块目录挂载目标，并核对 home-init 的非零退出。
docker compose -f "$task_adapter_dir/$task_mode.compose.yaml" run --rm --no-deps home-init

docker compose -f "$task_adapter_dir/$task_mode.compose.yaml" run --rm --no-deps \
  -e "DSH_EXPECT_WORKSPACE_TREE_SHA=$task_workspace_sha" \
  -e "DSH_EXPECT_PRESETS_TREE_SHA=$task_presets_sha" \
  -e "DSH_EXPECT_MANAGED_TREE_SHA=$task_managed_sha" \
  -e "DSH_EXPECT_USER_PATCH_SHA=$task_user_patch_sha" \
  -e "DSH_EXPECT_WEB_MANIFEST_SHA=$task_web_manifest_sha" \
  -e "DSH_EXPECT_GLOBAL_AGENTS_SHA=$task_global_agents_sha" \
  -e "DSH_EXPECT_BOOTSTRAP_ENV_SHA=$task_bootstrap_env_sha" \
  -e "DSH_EXPECT_MODULE_DENY_SHA=$task_module_deny_sha" \
  -e "DSH_EXPECT_PREPARE_SCRIPT_SHA=$task_prepare_script_sha" \
  -e "DSH_EXPECT_VERIFY_SCRIPT_SHA=$task_verify_script_sha" \
  -e "DSH_EXPECT_TREE_SCRIPT_SHA=$task_tree_script_sha" \
  --entrypoint node dsh /opt/dsh-adapter/verify-load.mjs
