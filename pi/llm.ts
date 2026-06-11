// pi/llm.ts — single LLM call helper for every pipeline script.
//
// Provider resolution, in order:
//   1. LLM_BASE_URL set     → any OpenAI-compatible endpoint (OpenRouter,
//                             Ollama, Groq, LM Studio, Gemini's compat API,
//                             Vercel AI Gateway, ...). LLM_MODEL required,
//                             LLM_API_KEY optional (local Ollama needs none).
//   2. ANTHROPIC_API_KEY    → https://api.anthropic.com (native Messages API)
//   3. OPENAI_API_KEY       → https://api.openai.com (chat completions)
//   4. exe.dev gateway      → http://169.254.169.254 (exe.dev VMs only)
//
// So a fork sets exactly ONE thing — whichever provider they already pay for —
// and triage, keyword expansion, PDF parsing and enrichment all light up.

const COMPAT_URL = (process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, '')
const COMPAT_KEY = (process.env.LLM_API_KEY || '').trim()
const COMPAT_MODEL = (process.env.LLM_MODEL || '').trim()
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim()
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim()

interface Opts { model?: string; maxTokens?: number; timeoutMs?: number; system?: string }

export async function callClaude(prompt: string, opts: Opts = {}): Promise<string> {
  if (COMPAT_URL) return openaiCompat(`${COMPAT_URL}/chat/completions`, COMPAT_KEY, COMPAT_MODEL, prompt, opts)
  if (ANTHROPIC_KEY) return anthropic('https://api.anthropic.com/v1/messages', ANTHROPIC_KEY, prompt, opts)
  if (OPENAI_KEY) return openaiCompat('https://api.openai.com/v1/chat/completions', OPENAI_KEY, 'gpt-4o-mini', prompt, opts)
  return anthropic('http://169.254.169.254/gateway/llm/anthropic/v1/messages', '', prompt, opts)
}

async function anthropic(url: string, key: string, prompt: string, opts: Opts): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(key ? { 'x-api-key': key } : {}),
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
    return String(JSON.parse(text).content?.[0]?.text || '')
  } catch (e) {
    throw new Error(`llm parse: ${(e as Error).message}`)
  }
}

async function openaiCompat(url: string, key: string, model: string, prompt: string, opts: Opts): Promise<string> {
  if (!model) throw new Error('LLM_MODEL must be set when using LLM_BASE_URL (e.g. "anthropic/claude-haiku-4.5" on OpenRouter, "llama3.1" on Ollama)')
  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: prompt },
  ]
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens || 300, messages }),
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`llm ${res.status}: ${text.slice(0, 200)}`)
  try {
    return String(JSON.parse(text).choices?.[0]?.message?.content || '')
  } catch (e) {
    throw new Error(`llm parse: ${(e as Error).message}`)
  }
}
