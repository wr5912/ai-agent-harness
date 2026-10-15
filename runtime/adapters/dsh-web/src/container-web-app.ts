import { runtimeModule } from './resolve-runtime.ts'

const Native = await runtimeModule('@deepseek-ai/dsh-web-app', '/opt/dsh/packages/bundle/web-app/package.json')
const Boot = await runtimeModule('@deepseek-ai/dsh-app-boot', '/opt/dsh/packages/bundle/web-app/package.json')
export const name = Native.name
export const Config = Native.Config
export const inject = Native.inject

/** 锁版 WebApp 尚无 publicUrl；保留原装配，只替换它发布的站点地址。 */
export function apply(ctx: any, config: any): void {
  const rootUrl = (context: any) => `http://127.0.0.1:${context.webServer.port}${context.webServer.publicPath('/')}`
  ctx.inject(['connection'], (connectionCtx: any) => {
    const connection = connectionCtx.connection
    const original = connection.authenticatedUrl.bind(connection)
    const descriptor = Object.getOwnPropertyDescriptor(connection, 'authenticatedUrl')
    Object.defineProperty(connection, 'authenticatedUrl', { configurable: true, value: (base: string) => {
      const url = new URL(base)
      url.pathname = connectionCtx.webServer.publicPath(url.pathname)
      return original(url.href)
    } })
    connectionCtx.effect(() => () => {
      if (descriptor) Object.defineProperty(connection, 'authenticatedUrl', descriptor)
      else delete connection.authenticatedUrl
    })
  })
  Native.apply(ctx, { ...config, surfaceContext: false })
  if (!config.surfaceContext) return
  ctx.inject(['systemPrompt'], (promptCtx: any) => {
    Boot.addHarnessSourceSection(promptCtx, '/opt/dsh')
    promptCtx.systemPrompt.section({
      name: 'app:web-surface',
      order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
      text: () => `You are interacting with the user through the DeepSeek Harness Web GUI at ${rootUrl(promptCtx)}. `
        + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
        + 'The browser provides no implicit DOM, route, or screenshot context. '
        + 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while `pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
        + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. '
        + 'Starting another server does not update this GUI. '
        + 'The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. '
        + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.',
    })
  })
  ctx.inject(['shellEnv'], (runtimeCtx: any) => {
    runtimeCtx.shellEnv.register({
      name: 'web-runtime',
      variables: { DSH_WEB_URL: { description: 'Canonical local URL of the DeepSeek Harness Web GUI serving this session.' } },
      resolve: () => ({ DSH_WEB_URL: rootUrl(runtimeCtx) }),
    })
  })
}
