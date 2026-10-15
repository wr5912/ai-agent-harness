import { renderToStaticMarkup } from 'react-dom/server'
import { PlatformLogo } from './logo.tsx'

export function loginPage(action: string, error = ''): string {
  return '<!doctype html>' + renderToStaticMarkup(<html lang="zh-CN">
    <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>登录 · Harness工程平台</title><style>{`
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
        padding:24px;background:#f3f5f9;color:#152336;font:16px/1.6 system-ui,sans-serif}
      main{width:min(100%,420px);padding:32px;background:white;border:1px solid #e0e5ec;border-radius:20px;
        box-shadow:0 16px 48px #172b4d0d}header{text-align:center;margin-bottom:28px}
      h1{font-size:24px;margin:12px 0 0}header p{font-size:13px;color:#617080;margin:4px 0}
      label{display:block;margin:16px 0 6px}input,button{width:100%;padding:12px;border-radius:8px;font:inherit}
      input{border:1px solid #bdc7d3}button{margin-top:24px;background:#155eef;color:white;border:0;cursor:pointer}
      input:focus-visible,button:focus-visible{outline:3px solid #9dc0ff;outline-offset:2px}
      [role=alert]{color:#a62020;margin:16px 0 0}@media(max-width:440px){main{padding:24px}h1{font-size:22px}}
      `}</style></head>
    <body><main><header><PlatformLogo size={64} /><h1>Harness工程平台</h1>
      <p>Harness Engineering Platform</p></header>
      <form method="post" action={action}>
        <label htmlFor="username">用户名</label><input id="username" name="username" autoComplete="username" required autoFocus maxLength={256} />
        <label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
        {error && <p role="alert">{error}</p>}<button type="submit">登录</button>
      </form></main></body></html>)
}
