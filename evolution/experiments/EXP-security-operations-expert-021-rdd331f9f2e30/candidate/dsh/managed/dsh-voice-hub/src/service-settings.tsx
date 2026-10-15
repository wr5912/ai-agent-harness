import * as React from 'react'
import { useEffect, useState } from 'react'
import { splitWakeWords } from './wakeword.ts'
import type { ServiceConfig } from './service-config.ts'

interface SummaryModelChoice { provider: string; model: string; name: string }

interface ConnectionResult { ok: boolean; ms: number; message: string }
type ConnectionResults = Record<'stream' | 'batch' | 'tts', ConnectionResult>

const BASE = '/voice-mode/service-config'
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 8,
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-border-l2)', fontSize: 13,
}

export function VoiceServiceSettingsPage(): React.ReactElement {
  const [value, setValue] = useState<ServiceConfig | null>(null)
  const [message, setMessage] = useState('正在读取语音服务配置…')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<ConnectionResults | null>(null)
  const [sendCommandsText, setSendCommandsText] = useState('')
  const [models, setModels] = useState<SummaryModelChoice[]>([])
  const [modelsError, setModelsError] = useState('')
  const resultsRef = React.useRef<HTMLUListElement>(null)
  useEffect(() => { if (results) resultsRef.current?.scrollIntoView({ block: 'nearest' }) }, [results])
  useEffect(() => {
    let alive = true
    void fetch(new URL('voice-mode/summary-models', document.baseURI)).then(async (res) => {
      if (!res.ok) throw new Error('无法读取模型')
      return res.json() as Promise<{ models: SummaryModelChoice[] }>
    }).then((data) => { if (alive) setModels(data.models) })
      .catch(() => { if (alive) setModelsError('模型列表读取失败，可继续使用跟随主模型。') })
    void fetch(new URL(BASE.slice(1), document.baseURI)).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP（请求状态）${res.status}`)
      return res.json() as Promise<ServiceConfig>
    }).then((data) => {
      if (!alive) return
      if (typeof data.ttsStreamUrl !== 'string' || typeof data.ttsCancelUrl !== 'string') {
        setMessage('语音插件服务端仍在运行旧版本，请重启 DSH Web 并刷新页面。')
        return
      }
      setValue(data)
      setSendCommandsText(data.sendCommands.join('；'))
      setMessage('')
    })
      .catch(() => { if (alive) setMessage('读取语音服务配置失败，请检查插件是否启用。') })
    return () => { alive = false }
  }, [])

  const change = <K extends keyof ServiceConfig>(name: K, next: ServiceConfig[K]): void => {
    if (value) { setValue({ ...value, [name]: next }); setResults(null) }
  }
  const currentValue = (): ServiceConfig => ({
    ...value!,
    wakeWord: splitWakeWords(value!.wakeWord).join('；'),
    sendCommands: sendCommandsText.split(/[;；]/).map((item) => item.trim()).filter(Boolean),
  })

  const check = async (): Promise<void> => {
    if (!value || busy || checking) return
    setChecking(true)
    setResults(null)
    setMessage('正在测试语音服务连接…')
    try {
      const res = await fetch(new URL('voice-mode/service-check', document.baseURI), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentValue()),
      })
      const data = await res.json() as { error?: string; results?: ConnectionResults }
      if (!res.ok || !data.results) throw new Error(data.error ?? `HTTP（请求状态）${res.status}`)
      setResults(data.results)
      setMessage(Object.values(data.results).every((item) => item.ok) ? '流式识别、批量识别和语音合成连接成功；取消地址已检查格式。' : '部分语音服务连接失败，请查看下方结果。')
    } catch (error) { setMessage(`测试连接失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setChecking(false) }
  }
  const save = async (): Promise<void> => {
    if (!value || busy) return
    setBusy(true)
    setMessage('正在保存…')
    try {
      const res = await fetch(new URL(BASE.slice(1), document.baseURI), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentValue()) })
      const data = await res.json() as { error?: string; config?: ServiceConfig }
      if (!res.ok) throw new Error(data.error ?? `HTTP（请求状态）${res.status}`)
      if (data.config) { setValue(data.config); setSendCommandsText(data.config.sendCommands.join('；')) }
      window.dispatchEvent(new Event('dshvm-config-saved'))
      setMessage('已保存。摘要配置用于下一次播报；常开唤醒及唤醒词在返回聊天页后生效，发送触发词在下次进入语音模式时生效。')
    } catch (error) { setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  const fields: Array<{ key: 'asrStreamUrl' | 'asrBatchUrl' | 'asrModel' | 'ttsStreamUrl' | 'ttsCancelUrl' | 'wakeWord'; label: string; hint: string }> = [
    { key: 'asrStreamUrl', label: '流式语音识别地址', hint: 'WebSocket（实时连接）完整地址，用于实时字幕和语音命令。' },
    { key: 'asrBatchUrl', label: '批量语音识别地址', hint: 'HTTP（网络请求）转写接口完整地址，流式失败时用于定稿兜底。' },
    { key: 'asrModel', label: '批量识别模型', hint: '批量转写请求中的 model（模型名）参数。' },
    { key: 'ttsStreamUrl', label: '语音合成地址', hint: 'HTTP（网络请求）流式合成接口完整地址，回复与待处理事项提醒共用。' },
    { key: 'ttsCancelUrl', label: '语音合成取消地址', hint: '填写完整接口地址，{generationId} 由插件自动替换，无需手填编号；留空时仅中断当前请求。' },
    { key: 'wakeWord', label: '唤醒词', hint: '最多 10 个，用中文分号「；」或英文分号「;」隔开；常开唤醒时说任意一个即可。手动点击麦克风无需说唤醒词。' },
  ]
  return <section data-dshvm-service-settings="page" style={{ maxWidth: 640, padding: '4px 0 32px', color: 'var(--dsw-alias-label-primary)' }}>
    <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>语音设置</h2>
    <p style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 }}>
      配置语音识别与合成服务。回复播报和待处理事项提醒共用合成服务，只需配置一次。
    </p>
    {value && <>
      {fields.map(({ key, label, hint }) => <label key={key} style={{ display: 'block', marginTop: 18 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 7 }}>{hint}</span>
        <input style={fieldStyle} disabled={busy || checking} value={String(value[key])} onChange={(event) => change(key, event.target.value)} />
      </label>)}
      <label style={{ display: 'block', marginTop: 18 }}>
        <span style={{ display: 'block', marginBottom: 7 }}>自动播报摘要字数</span>
        <input aria-label="自动播报摘要字数" type="number" min={10} max={300} step={1} style={fieldStyle}
          disabled={busy || checking} value={value.summaryLength} onChange={(event) => change('summaryLength', Number(event.target.value))} />
        <span style={{ fontSize: 12 }}>默认约 30 字，按每次模型调用已完成的正文生成；实际字数由模型决定。</span>
      </label>
      <label style={{ display: 'block', marginTop: 18 }}>
        <span style={{ display: 'block', marginBottom: 7 }}>摘要模型</span>
        <select aria-label="摘要模型" style={fieldStyle} disabled={busy || checking}
          value={value.summaryModel ? JSON.stringify(value.summaryModel) : ''}
          onChange={(event) => change('summaryModel', event.target.value ? JSON.parse(event.target.value) as ServiceConfig['summaryModel'] : null)}>
          <option value="">跟随本次主模型</option>
          {value.summaryModel && !models.some((model) => model.provider === value.summaryModel?.provider && model.model === value.summaryModel?.model)
            && <option value={JSON.stringify(value.summaryModel)}>{value.summaryModel.provider} / {value.summaryModel.model}（当前配置）</option>}
          {models.map((model) => <option key={JSON.stringify([model.provider, model.model])}
            value={JSON.stringify({ provider: model.provider, model: model.model })}>{model.name}</option>)}
        </select>
        <span style={{ fontSize: 12 }}>{modelsError || '使用 DSH 已配置的模型和凭据。每条自动播报额外调用一次模型。'}</span>
      </label>
      <label style={{ display: 'block', marginTop: 18 }}>
        <span style={{ display: 'block', marginBottom: 7 }}>摘要提示词</span>
        <textarea aria-label="摘要提示词" rows={5} style={fieldStyle} disabled={busy || checking}
          value={value.summaryPrompt} onChange={(event) => change('summaryPrompt', event.target.value)} />
        <span style={{ fontSize: 12 }}>{'{length} 会替换为上面的目标字数。保存后用于下一条摘要。'}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, fontSize: 13 }}>
        <input type="checkbox" disabled={busy || checking} checked={value.alwaysListen} onChange={(event) => change('alwaysListen', event.target.checked)} />
        常开唤醒（{value.alwaysListen ? '已开启' : '已关闭'}）
      </label>
      <p style={{ margin: '6px 0 0 25px', fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' }}>
        开启后，聊天页可见时在浏览器本机监听唤醒词，喊中才启动语音识别；首次需允许麦克风。关闭或切走页面即停用待机监听。
      </p>
      <label style={{ display: 'block', marginTop: 18 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>发送触发词</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 7 }}>最多 10 个，用中文分号「；」或英文分号「;」隔开；已有草稿时说出任一完整短句即可发送。留空则只使用手动发送。</span>
        <input style={fieldStyle} disabled={busy || checking} value={sendCommandsText} onChange={(event) => { setSendCommandsText(event.target.value); setResults(null) }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22, fontSize: 13 }}>
        <input type="checkbox" disabled={busy || checking} checked={value.approvalVoice} onChange={(event) => change('approvalVoice', event.target.checked)} />
        待审批、待回答和计划审阅时播放语音提示（{value.approvalVoice ? '已开启' : '已关闭'}）
      </label>
      <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy || checking} onClick={() => void check()}
          style={{ padding: '9px 18px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
            cursor: checking ? 'wait' : 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)' }}>
          {checking ? '正在测试…' : '测试连接'}
        </button>
        <button type="button" disabled={busy || checking} onClick={() => void save()}
          style={{ padding: '9px 18px', border: 0, borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
            color: 'white', background: 'var(--dsw-alias-brand-primary)' }}>保存配置</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: '8px 0 0' }}>测试当前输入的识别与合成接口；取消地址只检查格式，不发送取消请求。测试不会保存配置或播放声音。</p>
    </>}
    {message && <p role="status" aria-live="polite" style={{ fontSize: 13, marginTop: 14 }}>{message}</p>}
    {results && <ul ref={resultsRef} aria-label="语音服务连接结果" style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
      {([['stream', '流式语音识别'], ['batch', '批量语音识别'], ['tts', '语音合成']] as const).map(([key, label]) =>
        <li key={key} style={{ color: results[key].ok ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
          {label}：{results[key].ok ? '成功' : '失败'}（{results[key].ms} 毫秒）— {results[key].message}
        </li>)}
    </ul>}
  </section>
}
