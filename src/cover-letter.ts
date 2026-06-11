import * as fs from 'fs'
import * as path from 'path'
import type { JobData } from './read-job'

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function saveCoverLetter(content: string, job: JobData): string {
  const slug = toSlug(job.company)
  const date = new Date().toISOString().split('T')[0]
  const filename = `${slug}-cover-${date}.md`
  const outputDir = path.join(process.cwd(), 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, filename), content)
  return `output/${filename}`
}
