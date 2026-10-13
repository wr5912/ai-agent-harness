#!/usr/bin/env bash
set -euo pipefail

plugin_dir=$(cd "$(dirname "$0")/.." && pwd)
verify_dir=$(mktemp -d "${TMPDIR:-/tmp}/dsh-voice-product.XXXXXX")
web_pid=''
pack_pid=''
cleanup() {
  if [[ -n "$web_pid" ]]; then
    kill "$web_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
  fi
  if [[ -n "$pack_pid" ]]; then
    kill "$pack_pid" 2>/dev/null || true
    wait "$pack_pid" 2>/dev/null || true
  fi
  rm -rf "$verify_dir"
}
trap cleanup EXIT

write_service_config() {
  DSH_HOME="$1" node --input-type=module <<'JS'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = join(process.env.DSH_HOME, 'voice-mode')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'service-config.json'), JSON.stringify({
  asrStreamUrl: process.env.DSHVM_ASR_STREAM_URL || 'ws://127.0.0.1:8012/v1/asr/stream',
  asrBatchUrl: process.env.DSHVM_ASR_BATCH_URL || 'http://127.0.0.1:8002/v1/audio/transcriptions',
  asrModel: process.env.DSHVM_ASR_MODEL || 'Qwen3-ASR',
  ttsStreamUrl: process.env.DSHVM_TTS_STREAM_URL || 'http://127.0.0.1:8003/tts/stream/cancellable',
  ttsCancelUrl: process.env.DSHVM_TTS_CANCEL_URL || 'http://127.0.0.1:8003/tts/cancel/{generationId}',
  wakeWord: '', alwaysListen: false,
  sendCommands: ['发送', '确认发送', '确认'], approvalVoice: true,
}, null, 2) + '\n')
JS
}

cd "$plugin_dir"
npm install --ignore-scripts --package-lock=false
npm run typecheck
npm run build
npm test
node test/remote-services.integration.mjs

if [[ -n "${DSHVM_DSH_BIN:-}" ]]; then
  dsh_bin=$DSHVM_DSH_BIN
else
  mkdir -p "$verify_dir/core"
  npm install --prefix "$verify_dir/core" --no-save --package-lock=false '@deepseek-ai/dsh@next'
  dsh_bin="$verify_dir/core/node_modules/.bin/dsh"
fi
DSH_HOME="$verify_dir/home" "$dsh_bin" plugin --profile web add "$plugin_dir" --ignore-scripts
write_service_config "$verify_dir/home"
DSH_HOME="$verify_dir/home" "$dsh_bin" --profile web --host 127.0.0.1 --port 0 --no-open > "$verify_dir/web.log" 2>&1 &
web_pid=$!
for _ in $(seq 1 80); do
  if rg -q 'dsh web: http://127\.0\.0\.1:' "$verify_dir/web.log"; then break; fi
  if ! kill -0 "$web_pid" 2>/dev/null; then
    echo '隔离 DSH Web 启动失败' >&2
    exit 1
  fi
  sleep 0.5
done
if ! rg -q 'dsh web: http://127\.0\.0\.1:' "$verify_dir/web.log"; then
  echo '隔离 DSH Web 启动超时' >&2
  exit 1
fi
DSH_WEB_BOOT_LOG="$verify_dir/web.log" node test/browser-voice.integration.mjs
DSH_WEB_BOOT_LOG="$verify_dir/web.log" node test/browser-wake-send.integration.mjs
DSH_WEB_BOOT_LOG="$verify_dir/web.log" node test/browser-switch-sync.integration.mjs

# 源码链接可通过但实体 npm 包加载失败；发布前必须验证 tarball 装载。
pack_name=$(npm pack --pack-destination "$verify_dir" --silent | tail -1)
DSH_HOME="$verify_dir/pack-home" "$dsh_bin" plugin --profile web add "$verify_dir/$pack_name" --ignore-scripts
write_service_config "$verify_dir/pack-home"
DSH_HOME="$verify_dir/pack-home" "$dsh_bin" --profile web --host 127.0.0.1 --port 0 --no-open > "$verify_dir/pack-web.log" 2>&1 &
pack_pid=$!
for _ in $(seq 1 80); do
  if rg -q 'dsh web: http://127\.0\.0\.1:' "$verify_dir/pack-web.log"; then break; fi
  if ! kill -0 "$pack_pid" 2>/dev/null; then
    echo 'npm tarball 安装后的 DSH Web 启动失败' >&2
    exit 1
  fi
  sleep 0.5
done
node --input-type=module - "$verify_dir/pack-web.log" <<'JS'
import { readFileSync } from 'node:fs'
const log = readFileSync(process.argv[2], 'utf8')
const match = log.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s]+))/)
if (!match) throw new Error('npm tarball 安装后的 DSH Web 启动超时')
const origin = match[1].split('/?token=')[0]
const response = await fetch(`${origin}/voice-mode?token=${match[2]}`, { headers: { Origin: origin } })
const body = response.ok ? await response.json() : null
if (response.status !== 200 || body?.name !== 'dsh-voice-hub' || body?.ok !== true) {
  throw new Error(`npm tarball 插件装载失败：HTTP ${response.status}`)
}
console.log('npm tarball 安装后的宿主端点：HTTP 200')
JS
echo '语音插件闭环验证通过'
