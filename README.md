# ve-forwardrole

**A quality-first job-search robot.** It finds senior roles you'd actually take, filters
out the junk, maps warm intros (alumni + ex-colleagues) into every company, scores how
well each JD fits you, tailors your CV and cover letter in your own voice — and never
invents a skill, a date, or a job you didn't have.

Not a mass-apply bot. One well-tailored application beats ten generic ones.

Built on [Claude Code](https://claude.com/claude-code). Multi-profile: run it for
yourself and your friends without mixing anyone's data.

---

## ⚠️ Before anything else: your data stays private

Your queue and profiles contain **your real job hunt** — names, target roles, salary
expectations. Use **"Use this template"** (green button) to get your own **private**
copy. Never fork publicly, never flip your copy public. The `.gitignore` keeps
`profiles/` and `.env` out of git, but the queue itself is tracked — that's by design
(the cron commits to it), which is exactly why your copy must stay private.

---

## Tier 1 — Claude Code only (works in 10 minutes, zero new accounts)

You need: [Claude Code](https://claude.com/claude-code), git, Node 18+.

```bash
# 1. "Use this template" on GitHub → create your PRIVATE copy → clone it
git clone https://github.com/YOU/your-copy && cd your-copy
npm install

# 2. Your LinkedIn: profile → More → "Save to PDF"
mkdir -p profiles/me && cp ~/Downloads/Profile.pdf profiles/me/linkedin.pdf

# 3. Open the repo in Claude Code and say:
#      Run linkedin-parser on profiles/me/linkedin.pdf
#    Review the generated profiles/me/profile.md.
```

Per job, in Claude Code:

```
Add the URL to jobs/queue.md tagged | profile=me, then:
  Run job-reader on <url>
  Run cv-tailor for profile=me
  Run cover-letter-writer for profile=me
  Run application-tracker for profile=me
```

The agents in `.claude/agents/` load automatically. `CLAUDE.md` teaches each session the
rules (never invent experience, always show tailoring reasoning, match score < 5 = flag).

## Tier 2 — the autonomous robot (optional, additive)

A cron chain discovers roles twice daily, triages them with Claude, maps warm intro
paths, scores JD fit, and updates a per-person dashboard. Every piece degrades
gracefully — add keys as you go:

| Capability | Needs | Cost |
|---|---|---|
| ATS discovery (Greenhouse/Lever/Ashby/SmartRecruiters boards) | **nothing** — public JSON + a `companies.yaml` watchlist | free |
| Auto-triage, PDF parsing, outreach drafts | `ANTHROPIC_API_KEY` | pennies/day (Haiku) |
| Neural search + warm paths (alumni/ex-colleagues) + fit scores | `EXA_API_KEY` | free tier OK |
| LinkedIn job discovery | `APIFY_TOKEN` | ~cents/run |
| Web dashboard (queue actions, run-now, outreach buttons) | PocketBase (single binary) + any Linux box | ~$5/mo VPS |
| Morning Telegram digest | bot token from @BotFather | free |

```bash
bash setup.sh          # checks node, installs deps, fetches PocketBase,
                       # copies .env.example → .env, prints what's missing
bash pi/onboard.sh --name=me --pdf=profiles/me/linkedin.pdf \
  --keywords="head of product, VP product" --locations="New York, Remote"

# cron (twice daily) — NOTE: keep commands in the script; a literal % in a
# crontab line silently truncates the command.
0 7,19 * * * bash /path/to/repo/pi/run-pipeline.sh >> /path/to/repo/pi/cron.log 2>&1
```

Dashboard (optional): `cd app && npm install && npm run build` on a Node 20.9+ machine,
deploy with `VE_WORK_VM=user@host bash pi/deploy-app.sh`. Start PocketBase
(`./pocketbase serve`) — `pb_migrations/` adds the `profile` field its login needs —
and create one user per person (email + password + `profile` = their folder name).
New users get an onboarding wizard on first login: PDF upload, role keywords,
availability, minimum-offer indicator, hard NOs.

## How discovery compounds

1. You (or the wizard) seed keywords; Claude expands them into adjacent titles.
2. Three sources fan out: ATS boards (watchlist), LinkedIn (Apify), Exa neural search.
3. Claude triages every find against your filters — wrong seniority, wrong country,
   lowball comp, hard NOs never reach you.
4. Exa maps **warm paths**: alumni of *your* schools and ex-colleagues from *your* past
   companies at each shortlisted firm, ranked, with a drafted intro message.
5. Companies where your network clusters get their whole board watched — a flywheel.

## Repo map

```
.claude/agents/    five Claude Code subagents (parser, reader, tailor, writer, tracker)
src/               queue validation (npm run check)
pi/                the autonomous pipeline (discover → triage → enrich → render)
app/               Next.js dashboard (multi-user, PocketBase auth)
profiles/example/  sanitized example profile
jobs/queue.md      the shared role queue (one line per role, tagged per profile)
pb_migrations/     PocketBase schema (users.profile field)
```

## Operating model

One copy of this repo = **one operator + their people**. You run the instance; friends
get a login and a dashboard. There is no SaaS, no telemetry, no shared backend — every
instance is sovereign and private.

## License

MIT — see [LICENSE](LICENSE).
