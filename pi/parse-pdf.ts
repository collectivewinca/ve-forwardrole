#!/usr/bin/env npx ts-node
// pi/parse-pdf.ts — Pi-runnable LinkedIn PDF → profile.md
//
// Replaces the Claude Code `linkedin-parser` subagent so the cron and
// onboarding flow can parse a friend's PDF without needing an interactive
// Claude Code session. Uses pdf-parse to extract text, exe-dev gateway
// (Claude Sonnet/Haiku) to apply the extraction rules.

import * as fs from 'fs'
import * as path from 'path'
import { callClaude } from './llm'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require('pdf-parse')

const ROOT = path.resolve(__dirname, '..')

const PROMPT = `You are a LinkedIn profile parser. Given the raw text of a LinkedIn "Save to PDF" export, produce a clean profile.md.

PHILOSOPHY: preserve verbatim, never invent. Vague LinkedIn copy is still signal — downstream agents decide what to sharpen per job.

Output exactly this section structure (omit any section that is empty in the PDF):
# Profile: <Name>
## Contact
## Headline / Personal Statement
## Experience
## Education
## Skills
## Projects
## Awards / Recognition
## Recommendations (from LinkedIn)
## Volunteer Experience
## Certifications
## Languages

EXTRACTION RULES:
1. Experience bullets — verbatim. Do not rewrite, sharpen, or outcome-ify.
2. Endorsement counts — strip ("Python · 47 endorsements" → "Python"). Keep skill order.
3. Recommendations — keep top 3 verbatim with quote, giver's name, and giver's role.
4. Date formatting — normalise to YYYY-MM → YYYY-MM (or → present). Drop "· 2 yrs" suffix.
5. Certifications format: "- <Name> — <Issuer>, <YYYY-MM>".
6. Languages format: "- <Language> (<Proficiency>)".
7. Strip LinkedIn UI chrome: profile views, search appearances, "Open to work", "See more", "Activity", "People also viewed", page numbers.
8. Truncated content gets a trailing [...] — never guess the rest.
9. NEVER invent skills, jobs, or dates not in the PDF.
10. Preserve chronological order: most recent experience first.

Output ONLY the markdown content, no preamble, no code fences.`

interface PdfData { text: string; numpages: number }

async function extractPdfText(pdfPath: string): Promise<string> {
  const buf = fs.readFileSync(pdfPath)
  const data: PdfData = await pdf(buf)
  return data.text
}

function callGateway(systemPrompt: string, userContent: string): Promise<string> {
  return callClaude(userContent, { model: 'claude-sonnet-4-6', maxTokens: 6000, timeoutMs: 120000, system: systemPrompt })
}

async function main() {
  const args = process.argv.slice(2)
  const profile = (args.find((a) => a.startsWith('--profile=')) || '').split('=')[1]
  if (!profile) {
    console.error('Usage: ts-node pi/parse-pdf.ts --profile=<name>')
    process.exit(1)
  }
  const dir = path.join(ROOT, 'profiles', profile)
  const pdfPath = path.join(dir, 'linkedin.pdf')
  const outPath = path.join(dir, 'profile.md')

  if (!fs.existsSync(pdfPath)) {
    console.error(`No linkedin.pdf found at ${pdfPath}`)
    process.exit(1)
  }

  console.log(`Extracting text from ${pdfPath}...`)
  const text = await extractPdfText(pdfPath)
  console.log(`Got ${text.length} chars of raw PDF text`)

  console.log(`Calling exe-dev gateway → claude-sonnet-4-6...`)
  const md = await callGateway(PROMPT, `LinkedIn PDF text:\n\n${text}`)

  fs.writeFileSync(outPath, md.trim() + '\n')
  console.log(`Wrote ${outPath} (${(md.length / 1024).toFixed(1)} KB)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
