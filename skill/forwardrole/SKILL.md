---
name: forwardrole
description: |
  Quality-first job-search assistant backed by a ve-forwardrole repo. Use when
  the user says "find me roles", "tailor my CV / resume", "apply to this job",
  "write a cover letter for <url>", "parse my LinkedIn", "who do I know at
  <company>", "run my job pipeline", or "set up my job search". Drives the
  ve-forwardrole agents (linkedin-parser, job-reader, cv-tailor,
  cover-letter-writer, application-tracker) and pipeline scripts. Never invents
  skills, employers, or dates — tailoring reorders and reframes only.
author: VE LAB (collectivewinca)
version: 1.0.0
date: 2026-06-11
---

# forwardrole — job-search assistant

## Locate or create the workspace

1. Find the repo: look for a directory containing `jobs/queue.md` AND
   `.claude/agents/cv-tailor.md` — check the cwd, then `~/ve-work`,
   `~/forwardrole`. Remember the path as REPO.
2. If none exists, offer to set one up:
   `gh repo create <user>/my-forwardrole --private --template collectivewinca/ve-forwardrole --clone`
   then `cd` in and run `npm install`. (Private is non-negotiable — the queue
   holds the user's real job hunt.)

## First-time profile setup

1. Ask for their LinkedIn "Save to PDF" export (profile → More → Save to PDF);
   place it at `REPO/profiles/<name>/linkedin.pdf`.
2. Parse it following `.claude/agents/linkedin-parser.md` → write
   `profiles/<name>/profile.md`. NEVER invent or embellish — preserve verbatim.
3. Ask: role keywords (3–8), locations, hard NOs, minimum acceptable total comp,
   availability. Write `profiles/<name>/search.yaml` (copy the shape from
   `profiles/example/search.example.yaml`).

## Per-job workflow (the core loop)

For "apply to <url>" / "tailor my CV for <url>":
1. Append the URL to `jobs/queue.md` under `## Queue` as
   `<url> | profile=<name>`.
2. Read the posting following `.claude/agents/job-reader.md` → job JSON
   (requirements, red flags, salary, visa).
3. Tailor following `.claude/agents/cv-tailor.md`: show the reasoning FIRST,
   then the tailored CV, with a match score /10. Score < 5 → flag it and ask
   before continuing.
4. Cover letter per `.claude/agents/cover-letter-writer.md` (3 paragraphs, the
   user's voice). Save both under `profiles/<name>/output/`.
5. Log it per `.claude/agents/application-tracker.md` →
   `profiles/<name>/applications.md`.

## Warm intros ("who do I know at <company>?")

Read `profiles/<name>/.enrichment/alumni.json` if present (pipeline output:
ranked alumni + ex-colleague contacts with intro angles). Otherwise derive
anchors from profile.md (schools, past employers) and suggest LinkedIn
people-search links: `https://www.linkedin.com/search/results/people/?keywords=<company>%20<school>`.

## The autonomous pipeline (if the user wants automation)

- One-shot setup: `bash pi/onboard.sh --name=<n> --pdf=<pdf> --keywords=... --locations=...`
- Manual runs: `npm run discover` (3-source role discovery), `npm run triage`,
  `bash pi/ship.sh` (enrich + render + notify), or everything:
  `bash pi/run-pipeline.sh`.
- LLM provider for the pipeline comes from .env — any ONE of
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `LLM_BASE_URL`+`LLM_MODEL`
  (OpenRouter/Ollama/Groq/any OpenAI-compatible). See `.env.example`.
- Cron: `0 7,19 * * * bash REPO/pi/run-pipeline.sh >> REPO/pi/cron.log 2>&1`
  (never inline commands with `%` in crontab).

## Hard rules (from CLAUDE.md — always apply)

- NEVER invent skills, jobs, dates, or qualifications.
- Always show tailoring reasoning before the tailored CV.
- Never mix profiles' data; each person lives under `profiles/<name>/` only.
- The repo must stay private; never suggest publishing it.
