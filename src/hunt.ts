#!/usr/bin/env npx ts-node

import * as fs from 'fs'
import * as path from 'path'

interface HuntOptions {
  dryRun: boolean
  profile: string | null
}

interface QueueEntry {
  url: string
  profile: string
}

function parseArgs(): HuntOptions {
  const args = process.argv.slice(2)
  const profileArg = args.find((a: string) => a.startsWith('--profile='))
  return {
    dryRun: args.includes('--dry-run'),
    profile: profileArg ? profileArg.split('=')[1] : null,
  }
}

const PLACEHOLDER_URLS = new Set(['https://example.com/jobs/replace-with-real-url'])
const QUEUE_SECTION_HEADERS = ['## queue', '## processed']

function parseQueueLine(line: string): QueueEntry | null {
  if (!line.startsWith('http')) return null
  const [urlPart, ...tagParts] = line.split('|').map((s: string) => s.trim())
  const profileTag = tagParts.find((t: string) => t.startsWith('profile='))
  if (!profileTag) {
    console.error(`  ✗ Missing profile tag: ${urlPart}`)
    console.error(`    Format: <url> | profile=<name>`)
    return null
  }
  return { url: urlPart, profile: profileTag.split('=')[1] }
}

function readJobQueue(): QueueEntry[] {
  const queuePath = path.join(process.cwd(), 'jobs', 'queue.md')
  if (!fs.existsSync(queuePath)) {
    console.error('jobs/queue.md not found.')
    process.exit(1)
  }
  const content = fs.readFileSync(queuePath, 'utf-8')
  let inProcessed = false
  const entries: QueueEntry[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (QUEUE_SECTION_HEADERS.includes(line.toLowerCase())) {
      inProcessed = line.toLowerCase() === '## processed'
      continue
    }
    if (inProcessed) continue
    const entry = parseQueueLine(line)
    if (!entry) continue
    if (PLACEHOLDER_URLS.has(entry.url)) {
      console.log(`  (skipping placeholder: ${entry.url})`)
      continue
    }
    entries.push(entry)
  }
  return entries
}

function profileIsReady(name: string): { ok: boolean; reason?: string } {
  const dir = path.join(process.cwd(), 'profiles', name)
  if (!fs.existsSync(dir)) {
    return { ok: false, reason: `profiles/${name}/ does not exist — create the folder and drop in linkedin.pdf` }
  }
  const profileMd = path.join(dir, 'profile.md')
  if (!fs.existsSync(profileMd)) {
    const pdf = path.join(dir, 'linkedin.pdf')
    if (fs.existsSync(pdf)) {
      return { ok: false, reason: `profile.md missing — run linkedin-parser on profiles/${name}/linkedin.pdf` }
    }
    return { ok: false, reason: `profiles/${name}/ has neither profile.md nor linkedin.pdf` }
  }
  const content = fs.readFileSync(profileMd, 'utf-8')
  if (content.includes('Example Person') || content.includes('email@example.com')) {
    return { ok: false, reason: `profiles/${name}/profile.md still contains template placeholders` }
  }
  return { ok: true }
}

async function main(): Promise<void> {
  const options = parseArgs()

  console.log('claude-job-hunter')
  console.log('Quality over volume.\n')

  const allEntries = readJobQueue()
  const entries = options.profile
    ? allEntries.filter((e: QueueEntry) => e.profile === options.profile)
    : allEntries

  if (entries.length === 0) {
    console.log(options.profile
      ? `No queued jobs for profile=${options.profile}.`
      : 'No job URLs found in jobs/queue.md.')
    process.exit(0)
  }

  const profiles = Array.from(new Set(entries.map((e: QueueEntry) => e.profile)))
  console.log(`Found ${entries.length} job(s) across ${profiles.length} profile(s): ${profiles.join(', ')}\n`)

  let blocked = false
  for (const p of profiles) {
    const check = profileIsReady(p)
    if (!check.ok) {
      console.error(`  ✗ profile=${p}: ${check.reason}`)
      blocked = true
    } else {
      console.log(`  ✓ profile=${p} ready`)
    }
  }
  if (blocked) {
    console.error('\nResolve the issues above, then re-run.')
    process.exit(1)
  }

  if (options.dryRun) {
    console.log('\n[DRY RUN] Jobs ready to process:')
    entries.forEach((e: QueueEntry, i: number) => console.log(`  ${i + 1}. [${e.profile}] ${e.url}`))
    return
  }

  console.log('\nOpen Claude Code and run the agents in order for each job:')
  console.log('  1. job-reader          → "Run job-reader on <url>"')
  console.log('  2. cv-tailor           → "Run cv-tailor for profile=<name> with <job JSON>"')
  console.log('  3. cover-letter-writer → "Run cover-letter-writer for profile=<name>"')
  console.log('  4. application-tracker → "Run application-tracker for profile=<name>"')
  console.log('\nFor a brand-new profile, run linkedin-parser once first on its linkedin.pdf.')
}

main().catch(console.error)
