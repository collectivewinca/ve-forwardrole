import * as fs from 'fs'
import * as path from 'path'

export interface JobData {
  title: string
  company: string
  location: string
  salary: string | null
  visa_sponsorship: boolean | 'unknown'
  requirements: string[]
  nice_to_haves: string[]
  application_method: 'form' | 'email' | 'external' | 'linkedin'
  deadline: string | null
  company_mission: string
  red_flags: string[]
  url: string
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function saveJobData(job: JobData, outputDir: string): string {
  const slug = toSlug(job.company)
  const date = new Date().toISOString().split('T')[0]
  const filename = `${slug}-${date}.json`
  fs.mkdirSync(outputDir, { recursive: true })
  const filepath = path.join(outputDir, filename)
  fs.writeFileSync(filepath, JSON.stringify(job, null, 2))
  return filepath
}
