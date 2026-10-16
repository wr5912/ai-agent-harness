import { renderToStaticMarkup } from 'react-dom/server'
import { PlatformLogo } from './logo.tsx'
import logo from '../assets/harness-logo.svg'
import { PLATFORM_SLOGAN } from './home-entry.ts'
import { visualTokens } from './styles/tokens.ts'

export function loginPage(action: string, error = ''): string {
  return '<!doctype html>' + renderToStaticMarkup(<html lang="zh-CN">
    <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>登录 · Harness工程平台</title><link rel="icon" type="image/svg+xml" href={logo} /><style>{`
      ${visualTokens}
      *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;color-scheme:light;
        padding:24px;background:var(--hep-bg);color:var(--hep-text);font:14px/1.7 system-ui,"Microsoft YaHei",sans-serif}
      main{width:min(100%,420px);padding:32px;background:var(--hep-surface);border:1px solid var(--hep-border);border-radius:16px;
        box-shadow:var(--hep-shadow)}header{text-align:center;margin-bottom:28px}
      h1{font-size:24px;font-weight:600;margin:12px 0 0}header p{font-size:13px;color:var(--hep-muted);margin:6px 0}
      label{display:block;margin:20px 0 8px;font-weight:500}input,button{width:100%;min-height:44px;padding:10px 12px;border-radius:var(--hep-control-radius);font:inherit;transition:border-color var(--hep-motion-fast),box-shadow var(--hep-motion-fast),background-color var(--hep-motion-fast)}
      input{border:1px solid var(--hep-border);background:var(--hep-surface);color:var(--hep-text)}button{margin-top:24px;background:var(--hep-primary);color:white;border:0;cursor:pointer;font-weight:500}
      button:hover{background:var(--hep-primary-hover);box-shadow:0 4px 12px #0075ca20}
      input:focus-visible,button:focus-visible{outline:2px solid var(--hep-primary);outline-offset:3px}
      [role=alert]{color:#a62020;margin:16px 0 0}
      @media(prefers-reduced-motion:no-preference){main{animation:hep-enter var(--hep-motion) var(--hep-ease)}}
      @media(max-width:440px){main{padding:24px}h1{font-size:22px}}
      `}</style></head>
    <body><main><header><PlatformLogo size={64} /><h1>Harness工程平台</h1>
      <p>{PLATFORM_SLOGAN}</p></header>
      <form method="post" action={action}>
        <label htmlFor="username">用户名</label><input id="username" name="username" autoComplete="username" required autoFocus maxLength={256} />
        <label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
        {error && <p role="alert">{error}</p>}<button type="submit">登录</button>
      </form></main></body></html>)
}
