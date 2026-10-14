import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { loginPage } from './login.tsx'

const KEY = credentialKey('harness-platform', 'browser-sessions')
const COOKIE = 'harness_platform_session'
const MAX_AGE = 30 * 24 * 60 * 60
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
interface Session { digest: string; authority: string; expires: number }
interface Sessions { version: 1; account: string; sessions: Session[] }

function stored(record: CredentialRecord | undefined, account: string): Sessions {
  if (!record) return { version: 1, account, sessions: [] }
  const value = record.kind === 'grant' ? record.payload as Sessions : undefined
  if (!value || value.version !== 1 || typeof value.account !== 'string' || !Array.isArray(value.sessions)
    || !value.sessions.every(session => session && /^[a-f0-9]{64}$/.test(session.digest)
      && typeof session.authority === 'string' && Number.isSafeInteger(session.expires))) {
    throw new Error('平台会话记录无效，认证未启用。')
  }
  return { version: 1, account, sessions: value.account === account
    ? value.sessions.filter(session => session.expires > Date.now()) : [] }
}

function accountAt(assetRoot: string): { username: string; password: string } {
  try {
    const account = JSON.parse(readFileSync(join(assetRoot, 'platform/credentials/admin.json'), 'utf8'))
    if (typeof account.username !== 'string' || !account.username.trim() || account.username.length > 256
      || typeof account.password !== 'string' || !account.password || account.password.length > 1024) throw new Error()
    return account
  } catch {
    throw new Error('无法读取平台账号配置，请检查 platform/credentials/admin.json。')
  }
}

function formBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 4096) { chunks.length = 0; reject(new Error('body too large')); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('body aborted')))
  })
}

export async function applyAuthentication(ctx: Context, assetRoot: string) {
  const connection = ctx.connection
  const nativeRejection = connection.requestRejection.bind(connection)
  let active = false
  let sessions = new Map<string, Session>()
  const authority = (req: IncomingMessage) => `${ctx.webServer.protocol}//${req.headers.host?.toLowerCase()}`
  const sessionOf = (req: IncomingMessage) => {
    const values = (req.headers.cookie ?? '').split(';').map(value => value.trim())
      .filter(value => value.startsWith(`${COOKIE}=`)).map(value => value.slice(COOKIE.length + 1))
    if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0])) return undefined
    const session = sessions.get(hash(values[0]))
    return session && session.expires > Date.now() && session.authority === authority(req) ? session : undefined
  }
  const fence = (req: IncomingMessage) => nativeRejection(req) === 403
  const redirect = (res: ServerResponse, location: string, cookie?: string) => {
    res.writeHead(303, { 'cache-control': 'no-store', 'referrer-policy': 'same-origin', location,
      ...(cookie ? { 'set-cookie': cookie } : {}) })
    res.end()
  }
  // 原生 API、RPC 和 Fetch 网关共用此入口；初始化失败或卸载后也不能退回 Token 认证。
  Object.defineProperties(connection, {
    requestRejection: { configurable: true, value: (req: IncomingMessage) =>
      fence(req) ? 403 : active && sessionOf(req) ? undefined : 401 },
    authorizeIndex: { configurable: true, value: (req: IncomingMessage, res: ServerResponse) => {
      if (fence(req)) { res.writeHead(403); res.end(); return false }
      if (!active || !sessionOf(req)) { redirect(res, '/login'); return false }
      if (new URL(req.url ?? '/', 'http://platform.invalid').searchParams.has('token')) {
        redirect(res, '/'); return false
      }
      res.setHeader('cache-control', 'no-store')
      return true
    } },
    authenticatedUrl: { configurable: true, value: (base: string) => {
      const url = new URL(base)
      url.searchParams.delete('token')
      return url.href
    } },
  })
  ctx.effect(() => () => { active = false; sessions.clear() })
  const account = accountAt(assetRoot)
  const accountDigest = hash(JSON.stringify([account.username, account.password]))
  const update = async (mutate: (sessions: Session[]) => Session[]) => {
    const record = await ctx.credentials.modifyRecord(KEY, async current => {
      const value = stored(current, accountDigest)
      return { kind: 'grant', payload: { ...value, sessions: mutate(value.sessions) } }
    })
    if (!record) throw new Error('平台会话记录无法保存。')
    sessions = new Map(stored(record, accountDigest).sessions.map(session => [session.digest, session]))
  }
  await update(value => value)
  const cookieHeader = (value: string, age: number) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${ctx.webServer.protocol === 'https:' ? '; Secure' : ''}`
  const html = (res: ServerResponse, status = 200, error = '') => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      // no-referrer 会使浏览器表单的 Origin 变成 null，导致同源登录被拒绝。
      'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" })
    res.end(loginPage(error))
  }
  for (const path of ['/login', '/logout']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, async handler(req, res) {
      if (!active) { res.writeHead(503); res.end(); return }
      if (fence(req)) { res.writeHead(403); res.end(); return }
      if (path === '/login' && req.method === 'GET') {
        if (sessionOf(req)) redirect(res, '/')
        else html(res)
        return
      }
      if (req.method !== 'POST') { res.writeHead(405, { allow: path === '/login' ? 'GET, POST' : 'POST' }); res.end(); return }
      if (req.headers.origin?.toLowerCase() !== authority(req)) { res.writeHead(403); res.end(); return }
      if (path === '/logout') {
        const session = sessionOf(req)
        if (!session) { res.writeHead(401); res.end(); return }
        sessions.delete(session.digest)
        try { await update(value => value.filter(item => item.digest !== session.digest)) }
        catch { res.writeHead(503); res.end(); return }
        redirect(res, '/login', cookieHeader('', 0))
        return
      }
      if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
        res.writeHead(415); res.end(); return
      }
      let body: string
      try { body = await formBody(req) }
      catch { html(res, 413, '登录信息过长或请求未完成。'); return }
      const fields = new URLSearchParams(body)
      const matches = fields.getAll('username').length === 1 && fields.getAll('password').length === 1
        && timingSafeEqual(Buffer.from(hash(JSON.stringify([fields.get('username'), fields.get('password')]))), Buffer.from(accountDigest))
      if (!matches) { html(res, 401, '用户名或密码错误。'); return }
      const value = randomBytes(32).toString('base64url')
      const session = { digest: hash(value), authority: authority(req), expires: Date.now() + MAX_AGE * 1000 }
      try { await update(items => [...items, session]) }
      catch { html(res, 503, '暂时无法保存登录状态，请重试。'); return }
      redirect(res, '/', cookieHeader(value, MAX_AGE))
    } }))
  }
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: '__DSH_TRANSPORT__', value: { ownsHost: true } })
  })
  active = true
}
