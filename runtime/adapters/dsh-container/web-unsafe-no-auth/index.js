// 仅适配 source.lock.json 锁定的 HostConnectionService 内部接口；升级 DSH 须重测。
export const name = 'web-unsafe-no-auth'
export const inject = ['connection']

export function apply(ctx) {
  const connection = ctx.connection
  const replacements = {
    requestRejection: () => undefined,
    authorizeIndex: () => true,
    authenticatedUrl: (baseUrl) => baseUrl,
  }
  const previous = Object.fromEntries(Object.keys(replacements).map((key) => {
    if (typeof connection[key] !== 'function') throw new Error(`web-unsafe-no-auth: missing ${key}`)
    return [key, Object.getOwnPropertyDescriptor(connection, key)]
  }))
  ctx.effect(() => {
    Object.defineProperties(connection, Object.fromEntries(
      Object.entries(replacements).map(([key, value]) => [key, { configurable: true, value }]),
    ))
    return () => {
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(connection, key, descriptor)
        else delete connection[key]
      }
    }
  })
}
