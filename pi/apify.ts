// pi/apify.ts — Apify actor runner with token failover.
//
// Tokens: APIFY_TOKEN (primary) then APIFY_TOKEN_FALLBACKS (comma-separated).
// On a quota/billing response (402/403/429 or "limit exceeded" body) the next
// token is tried, and the working index is remembered for the rest of the
// process so every subsequent call starts on a live token.

const TOKENS = [
  (process.env.APIFY_TOKEN || '').trim(),
  ...(process.env.APIFY_TOKEN_FALLBACKS || '').split(',').map((t) => t.trim()),
].filter(Boolean)

let tokenIdx = 0

export function apifyAvailable(): boolean {
  return TOKENS.length > 0
}

function quotaError(status: number, body: string): boolean {
  return status === 402 || status === 429 || (status === 403 && /limit|exceeded|disabled|payment/i.test(body))
}

// Run an actor synchronously and return its dataset items, or null on failure.
// `actor` uses the tilde form, e.g. "apimaestro~linkedin-profile-detail".
export async function runActorSync(
  actor: string,
  input: unknown,
  timeoutMs = 90000,
): Promise<unknown[] | null> {
  for (; tokenIdx < TOKENS.length; tokenIdx++) {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${TOKENS[tokenIdx]}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutMs),
        },
      )
      if (res.ok) {
        const items = (await res.json()) as unknown[]
        return Array.isArray(items) ? items : null
      }
      const body = (await res.text()).slice(0, 200)
      if (quotaError(res.status, body)) {
        console.log(`  apify: token ${tokenIdx + 1}/${TOKENS.length} exhausted (${res.status}) — ${tokenIdx + 1 < TOKENS.length ? 'rotating to next' : 'no tokens left'}`)
        continue // try next token
      }
      console.log(`  apify: ${actor} ${res.status} — ${body}`)
      return null // non-quota error: rotating won't help
    } catch (e) {
      console.log(`  apify: ${actor} failed — ${(e as Error).message}`)
      return null
    }
  }
  return null
}
