// pi/llm.ts — single Claude call helper for every pipeline script.
//
// Provider resolution, in order:
//   1. ANTHROPIC_API_KEY set        → https://api.anthropic.com (works anywhere)
//   2. exe.dev link-local gateway   → http://169.254.169.254 (exe.dev VMs only)
//
// Forks running outside exe.dev just set ANTHROPIC_API_KEY in .env and every
// LLM-dependent step (triage, keyword expansion, PDF parsing, enrichment)
// lights up with no other change.

const KEY = (process.env.ANTHROPIC_API_KEY || '').trim()
const URL = KEY
  ? 'https://api.anthropic.com/v1/messages'
  : 'http://169.254.169.254/gateway/llm/anthropic/v1/messages'

export async function callClaude(
  prompt: string,
  opts: { model?: string; maxTokens?: number; timeoutMs?: number; system?: string } = {},
): Promise<string> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(KEY ? { 'x-api-key': KEY } : {}),
    },
    body: JSON.stringify({
      model: opts.model || 'claude-haiku-4-5',
      max_tokens: opts.maxTokens || 300,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`llm ${res.status}: ${text.slice(0, 200)}`)
  try {
    const d = JSON.parse(text)
    return String(d.content?.[0]?.text || '')
  } catch (e) {
    throw new Error(`llm parse: ${(e as Error).message}`)
  }
}
