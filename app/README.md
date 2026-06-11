# app/ — the dashboard

Per-person, auth-gated Next.js dashboard: queue with fit/warm badges and
star/applied/skip actions, pipeline run-now buttons, AI outreach drafts per warm
contact, onboarding wizard for new users, profile/search/watchlist editors.

## Stack
Next.js (standalone output, basePath `/work`) + PocketBase (auth; `users` needs
the `profile` text field — `../pb_migrations/` adds it).

## Build & deploy
Build needs Node ≥ 20.9; the runtime box only needs 18+.

```bash
cd app && npm install && npm run build          # on your laptop
VE_WORK_VM=user@yourbox bash ../pi/deploy-app.sh
```

The service on the box: `node server.js` with env `VE_WORK_ROOT=$HOME/ve-work`,
`POCKETBASE_URL=http://127.0.0.1:8090`, behind any reverse proxy at `/work`.

## Users
Create one PocketBase user per person (email + password + `profile` = their
folder under `profiles/`). First login routes to the onboarding wizard.
