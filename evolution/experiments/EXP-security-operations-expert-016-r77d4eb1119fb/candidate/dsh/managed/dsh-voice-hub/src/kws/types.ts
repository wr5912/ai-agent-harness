export type KeywordSpec = string | { text: string; tokens: string }

export interface WakeOptions {
  keywords: KeywordSpec[]
  assetsPath: string
  threshold?: number
  score?: number
  cooldownMs?: number
  loadTimeoutMs?: number
}

export interface KwsEngine {
  load(mic: MediaStream): Promise<void>
  resume(): void
  pause(): void
  dispose(): void
  onKeyword(handler: (keyword: string) => void): () => void
  onError?(handler: (message: string) => void): () => void
}
