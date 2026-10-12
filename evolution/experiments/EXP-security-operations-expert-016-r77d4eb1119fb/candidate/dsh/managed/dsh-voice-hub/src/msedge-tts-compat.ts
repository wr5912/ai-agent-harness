import { createRequire } from 'node:module'
import type { ProsodyOptions } from 'msedge-tts'

// 宿主 ESM 构建产物旁的 CJS 包；避免 DSH profile 解析 msedge-tts 的 buffer/index 子路径。
const { MsEdgeTTS, OUTPUT_FORMAT } = createRequire(import.meta.url)('./msedge-tts.cjs') as typeof import('msedge-tts')

export { MsEdgeTTS, OUTPUT_FORMAT }
export type { ProsodyOptions }
