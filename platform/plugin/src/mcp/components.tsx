import { useState, type InputHTMLAttributes } from 'react'

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return <span className="harness-password-field"><input {...props} type={visible ? 'text' : 'password'} />
    <button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={event => { event.preventDefault(); setVisible(!visible) }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!visible && <path d="m3 3 18 18" />}</svg>
    </button>
  </span>
}

export function PublishedService({ service }: { service: any }) {
  return <div className="mcp-card" aria-label="已发布组合服务"><div className="mcp-card-head"><div><h3>工具组合编排</h3><p className="mcp-muted">{service.publishedTools.length} 个已发布工具 · 服务 ID：{service.id}</p></div></div>
    <p>发布后自动显示，草稿不对外提供。在“工具与资源分组”中勾选工具并保存，再将分组 MCP 链接和统一访问 Token 配置给智能体。</p>
    <ul className="mcp-catalog">{service.publishedTools.map((tool: any) => <li key={tool.toolName}><strong>{tool.title}</strong><code>{tool.toolName}</code><small>{tool.description}</small></li>)}</ul>
    <p className="mcp-muted">在“工具组合编排”中编辑和发布；在“工具与资源调试”中发现并调用已发布工具。</p>
  </div>
}
