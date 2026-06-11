import * as fs from 'fs'
import * as path from 'path'
import type { JobData } from './read-job'

export interface TailoringResult {
  reasoning: string
  tailoredCv: string
  matchScore: number
  matchExplanation: string
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function loadBaseCv(): string {
  const cvPath = path.join(process.cwd(), 'cv', 'cv.md')
  if (!fs.existsSync(cvPath)) {
    throw new Error('cv/cv.md not found')
  }
  const content = fs.readFileSync(cvPath, 'utf-8')
  if (content.includes('[PASTE YOUR CV HERE]')) {
    throw new Error('cv/cv.md still contains the placeholder. Paste your real CV first.')
  }
  return content
}

export function saveTailoredCv(content: string, job: JobData): string {
  const slug = toSlug(job.company)
  const date = new Date().toISOString().split('T')[0]
  const filename = `${slug}-${date}.md`
  const outputDir = path.join(process.cwd(), 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, filename), content)
  return `output/${filename}`
}
