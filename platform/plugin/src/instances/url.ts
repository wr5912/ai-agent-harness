export function instanceWebUrl(result: { url: string; lan_access: boolean }, hostname: string): string {
  const url = new URL(result.url)
  if (result.lan_access) url.hostname = hostname
  return url.href
}
