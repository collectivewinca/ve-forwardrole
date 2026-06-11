import * as fs from 'fs'
import * as path from 'path'
import type { JobData } from './read-job'

export type ApplicationStatus = 'Applied' | 'Skipped' | 'Failed' | 'Pending'

export interface ApplicationEntry {
  job: JobData
  status: ApplicationStatus
  matchScore: number // 1-10
  tailoredCvPath: string
  tailoringChoices: string[]
  notes: string
}

export function logApplication(entry: ApplicationEntry): void {
  if (entry.matchScore < 1 || entry.matchScore > 10) {
    throw new Error(`matchScore must be 1-10, got ${entry.matchScore}`)
  }
  const trackerPath = path.join(process.cwd(), 'applications.md')
  const date = new Date().toISOString().split('T')[0]

  const block = `
---
## ${entry.job.company} — ${entry.job.title}
- **Date:** ${date}
- **URL:** ${entry.job.url}
- **Status:** ${entry.status}
- **Match Score:** ${entry.matchScore}/10
- **Tailored CV:** ${entry.tailoredCvPath}
- **Key Tailoring Choices:**
${entry.tailoringChoices.map((c: string) => `  - ${c}`).join('\n')}
- **Notes:** ${entry.notes}
---
`

  fs.appendFileSync(trackerPath, block)
}
