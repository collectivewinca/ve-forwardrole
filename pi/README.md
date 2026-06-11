# pi/ — the autonomous pipeline

Runs on any Linux box with Node 18+. Each script is independently runnable; the
cron chain is `pi/run-pipeline.sh` (profile-graph → expand-keywords → discover →
triage → ship).

```bash
git clone <your-private-copy> ~/ve-work && cd ~/ve-work
bash ../setup.sh        # or: npm install && cp .env.example .env
bash pi/onboard.sh --name=<you> --pdf=<linkedin.pdf> --keywords=... --locations=...
```

## Cron

```
0 7,19 * * * bash $HOME/ve-work/pi/run-pipeline.sh >> $HOME/ve-work/pi/cron.log 2>&1
0 * * * *    cd $HOME/ve-work && bash pi/cron-watchdog.sh >> pi/cron.log 2>&1
```

Keep commands inside scripts: an unescaped `%` in a crontab line truncates the
command silently (crontab(5) treats `%` as end-of-command + stdin).

## Scripts

| Script | Does |
|---|---|
| `profile-graph.ts` | profile.md → schools + past employers (warm-path anchors) |
| `expand-keywords.ts` | Claude expands your keywords into adjacent titles (7-day cache) |
| `discover.ts` | 3-source discovery: ATS boards + Apify LinkedIn + Exa |
| `sources/ats.ts` | Greenhouse/Lever/Ashby/SmartRecruiters public boards, slug auto-resolution |
| `triage.ts` | Claude keep/skip per role vs your filters + hidden prefs |
| `enrich.ts` / `enrich-exa.ts` | listing validation, external roles, warm paths |
| `company-dossier.ts` / `jd-fit.ts` | sourced company briefs, JD fit scores |
| `render.ts` | per-profile HTML shortlist (+ optional here.now publish) |
| `ship.sh` | commit/PR (against YOUR origin), enrichment passes, Telegram digest |
| `llm.ts` | Claude call helper: ANTHROPIC_API_KEY or exe.dev gateway |
