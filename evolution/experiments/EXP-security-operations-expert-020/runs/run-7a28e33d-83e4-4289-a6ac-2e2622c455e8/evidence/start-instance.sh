#!/bin/bash
set -euo pipefail
task_root=/home/admin/work/ai-agent-harness-copy2-voice-latency
task_tmp=/tmp/voice-latency-exp020
task_image=ai-agent-harness/dsh:21638c563-54f335ef05ac
task_name=${1:?container name}
task_port=${2:?port}
task_plugin=${3:?plugin root}
task_home=$task_tmp/$task_name-home
mkdir -p "$task_home"
mkdir -p "$task_tmp/plugin/lib" "$task_tmp/plugin/assets" "$task_tmp/deps/vendor"
docker run --rm --user 1000:1000 --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m \
  --env DSH_HARNESS_MODE=verification \
  --mount "type=bind,src=$task_home,dst=/var/lib/dsh" \
  --mount "type=bind,src=$task_tmp/controls,dst=/opt/dsh-verification-controls,readonly" \
  --mount "type=bind,src=$task_root/runtime/adapters/dsh-container,dst=/opt/dsh-adapter,readonly" \
  --entrypoint node "$task_image" /opt/dsh-adapter/prepare-verification-home.mjs
sed "s/127.0.0.1:3386/127.0.0.1:$task_port/g" "$task_tmp/installed.patch.yml" > "$task_home/profiles/web/cordis.patch.yml"
docker run -d --name "$task_name" --user 1000:1000 --network host \
  --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m --cap-drop ALL --security-opt no-new-privileges \
  --env DSH_HOME=/var/lib/dsh --env DSH_HARNESS_MODE=verification \
  --mount "type=bind,src=$task_home,dst=/var/lib/dsh" \
  --mount "type=bind,src=$task_home/profiles/node_modules,dst=/var/lib/dsh/profiles/node_modules,readonly" \
  --mount "type=bind,src=$task_tmp/controls/locked-user.patch.yml,dst=/var/lib/dsh/cordis.patch.yml,readonly" \
  --mount "type=bind,src=$task_tmp/controls/locked-global.AGENTS.md,dst=/var/lib/dsh/AGENTS.md,readonly" \
  --mount "type=bind,src=$task_tmp/controls/locked-bootstrap.env,dst=/var/lib/dsh/.env,readonly" \
  --mount "type=bind,src=$task_tmp/controls/web-profile.package.json,dst=/var/lib/dsh/profiles/web/package.json,readonly" \
  --mount "type=bind,src=$task_root/evolution/experiments/EXP-security-operations-expert-020/candidate/dsh/workspace,dst=/work/harness/workspace,readonly" \
  --mount "type=bind,src=$task_tmp/plugin,dst=/opt/voice-plugin,readonly" \
  --mount "type=bind,src=$task_plugin/lib,dst=/opt/voice-plugin/lib,readonly" \
  --mount "type=bind,src=$task_plugin/assets,dst=/opt/voice-plugin/assets,readonly" \
  --mount "type=bind,src=$task_tmp/deps,dst=/opt/voice-deps,readonly" \
  --mount "type=bind,src=$task_root/evolution/experiments/EXP-security-operations-expert-020/candidate/dsh/managed/dsh-voice-hub/node_modules,dst=/opt/voice-deps/vendor,readonly" \
  --mount "type=bind,src=$task_tmp/probe,dst=/opt/voice-probe,readonly" \
  --entrypoint node "$task_image" --expose-internals /opt/dsh/apps/cli/lib/bin.js --profile web --host 127.0.0.1 --port "$task_port" --no-open
