/** 仅检查 LLM 凭据常量；环境变量、模板插值和代码表达式仍是正常资产。 */
export function containsLiteralLlmKey(path: string, content: string): boolean {
  if (path.endsWith('.llm-api-key')) return true
  const key = '(?:DEEPSEEK_API_KEY|OPENAI_API_KEY|LOCAL_LLM_API_KEY|LLM_API_KEY)'
  const scalar = '(?:sk-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{12,})'
  if (new RegExp(`\\b${key}["']?\\s*[:=]\\s*["']${scalar}["']`, 'i').test(content)) return true
  if (new RegExp(`^\\s*(?:export\\s+)?${key}\\s*[:=]\\s*${scalar}(?=\\s|[;,#]|$)`, 'im').test(content)) return true
  if (/(?:\.sh|\.ya?ml|\.env)$/.test(path) || path.split('/').at(-1) === '.env') {
    return new RegExp(`\\b${key}["']?\\s*[:=]\\s*${scalar}(?=\\s|[;,#]|$)`, 'im').test(content)
  }
  return false
}
