/** 默认语音发送命令；设置页可替换或清空。 */
export const DEFAULT_SEND_COMMANDS = ['发送', '确认发送', '确认'] as const

/** ASR 定稿可能带句末标点；只匹配完整短句，避免把「发送给我……」误判为发送。 */
export function normalizeSendCommand(text: string): string {
  return text.trim().replace(/[\s\u3000，。！？!?；;、,.]+/g, '')
}

export function matchesSendCommand(text: string, commands: readonly string[]): boolean {
  const phrase = normalizeSendCommand(text)
  return phrase !== '' && commands.some((command) => normalizeSendCommand(command) === phrase)
}
