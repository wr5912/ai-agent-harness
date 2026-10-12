export const name = 'web-remote-settings'

export function apply(ctx) {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_REMOTE_HOST_SETTINGS__', value: true })
  })
}
