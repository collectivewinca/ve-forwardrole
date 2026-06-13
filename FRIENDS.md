# ve-work for friends

## What it is

A daily robot that scouts product / founder / exec roles you'd actually take, tailors your CV and cover letter to each one, and gives you a polished shortlist URL you can share with mentors or recruiters.

The honest version: it doesn't apply for you. Quality, not volume. You still write the click.

## What you get

- **A private dashboard** at `https://work.velab.org/work/p/<yourname>` — your queue, your applications log, edit your profile
- **A shareable shortlist** at `https://<your-slug>.here.now/` — same data, polished read-only view, password-protected
- **A morning Telegram ping** at 7am UTC (3am ET) summarising new roles + a link to today's PR
- **On-demand tailoring**: for any role you want to apply to, a CV + cover letter in your voice in ~30 seconds — no template feel, no invented skills

## What I need from you to onboard

1. **LinkedIn "Save to PDF" of your profile**
   Go to your LinkedIn profile → click the "More" button under your header → "Save to PDF". Send me the file.
2. **3–8 role keywords you'd take**
   Examples: "head of product", "founder in residence", "AI product", "VP engineering", "chief of staff". Be honest — these are the filter; too broad = noise.
3. **Locations** — cities and/or "Remote"
4. **Hard NOs** (optional) — companies, words, or filters. Examples: "no equity-only", "no crypto", "no 100% commission", "skip these specific companies".
5. **Your email** — for the dashboard login
6. **Telegram chat ID** (optional) — if you want the morning ping. (Message `@discoopsbot` once, then send me the ID it shows.)

Five minutes of your time. I'll have you up by tomorrow morning's run.

## What happens every day automatically

1. Discovers ~30 new LinkedIn job postings matching your criteria (via Apify)
2. AI-filters out the obvious junk (commission-only, internships, wrong seniority, wrong country, hard-NO terms)
3. Validates each listing is still accepting applications (no dead links)
4. Surfaces a one-click "Find <Your School> alums at this company" button per row — opens LinkedIn search in your own logged-in session
5. Tags any role you've already tailored with a match score
6. Updates your private dashboard + shareable shortlist
7. Sends you a Telegram digest

You wake up to a shortlist of ~10–15 roles worth looking at. Junk doesn't reach you.

## How to actually apply to a role

1. See it on your dashboard or in the morning ping
2. Decide you want it
3. Tell me the URL (text, email, however) → I tailor your CV + cover letter in ~30 seconds — actually reading the JD, mapping your real experience, not pattern-matching
4. You paste/upload to LinkedIn yourself

The CV gets reordered to lead with what's most relevant to that specific role, written in your voice, never inventing skills you don't have. The cover letter is 3 paragraphs: why this company specifically, your most relevant proof, a specific ask. No "I am writing to apply for" or "I believe I would be a great fit" — those are banned.

## What you can share

The `<your-slug>.here.now` URL + password is yours to share with:
- A mentor reviewing your search
- A recruiter asking "what are you targeting?"
- A friend offering an intro at one of the companies
- Yourself, as a bookmark across devices

It updates daily without you doing anything. Different from a static resume PDF — it's a living view of what you're actually looking at.

## What it WON'T do

- **Apply for you.** Deliberate. Auto-apply is what gets you flagged by ATS systems and ghosted by recruiters. The "I read the JD and chose to apply" signal is the whole point.
- **Fix a sparse LinkedIn.** Better PDF in = better tailoring out. If your profile is two lines per role, the tailoring has nothing to work with.
- **Find roles you didn't ask for.** The keywords are the filter. If you want broader, broaden them.
- **Cold-DM recruiters on LinkedIn.** Against ToS, kills your account, doesn't work anyway.
- **Promise interviews.** It optimises for quality applications. Conversion is up to your background and the market.

## Privacy

- Your data lives on my private VM (`ve-code` on exe.dev), not on Vercel / Google / OpenAI / any large platform
- Your LinkedIn PDF stays on disk, never committed to git
- Your dashboard is password-protected (your email + password I send you)
- Your shareable URL is password-protected (separate, easier-to-remember password)
- I can read your profile + applications log to help you, debug something, or improve the system. Nothing leaves the VM unless you intentionally share your URL.
- Your data goes nowhere else. No analytics, no telemetry, no third-party trackers.

## Cost

- **Free for you.** I cover the infrastructure (Apify discovery + LLM tailoring + hosting). About $0.20–0.50/day per friend, which is fine at the scale of "a handful of people I trust".
- **Your time investment**: 5 minutes once to onboard, ~30 seconds per role to decide if you want it tailored, ~5 minutes per real application to paste into LinkedIn and click submit.

## Honest expectations after 30 days

- ~300–400 discovered roles
- ~150 that passed triage
- ~20–30 you'd seriously consider
- ~5–10 you actually apply to
- The rest is up to you and the market

This is a tool for being deliberate, not for scaling generic applications. If your goal is "send 200 applications this month", this is the wrong tool. If your goal is "find the 5 roles that are real and apply with intention", this is exactly the tool.

## To start

Text or email me your LinkedIn PDF + 3–8 keywords you'd take. I'll set you up tonight. First results show up on your dashboard within 24 hours.

— Alet
