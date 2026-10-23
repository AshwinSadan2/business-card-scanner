# Business Card Scanner

At the start of every session, read `handoff.md` first.

Slack photo of a business card in `#businesscard-scanner` → Claude reads it → person, company, note and event tag in Attio → reply in the Slack thread. Spec: `plan.md`. Setup steps: `README.md`. Past decisions: `decisions.md` (don't reopen them without a new reason). Session logs: `sessions/`.

## Where things are
- `src/index.js` listens to Slack (Socket Mode, so no public web address needed). `src/process.js` runs the card flow and the thread-reply flow. `src/claude.js` reads cards (model `claude-opus-5-5`). `src/attio.js` talks to Attio. `src/match.js` does event-name and company matching.
- `npm test` runs the whole flow against a fake Attio, Slack and card reader. Run it after every code change. All 13 tests must pass.
- `npm run check` tests the real keys. `npm run setup-attio` adds the Events field (safe to run twice).
- `logs/run.log` is the run history and holds old values before any overwrite. `data/state.json` is the local memory. Both are git-ignored.
- `docs/interview-agent.md` is the systems-design interview script used to write `plan.md`. Use it only if we're designing a new system.

## Rules
- Never delete anything in Attio. Only create and update.
- Before running `npm run check` or anything else that reads `.env`, run the masked view (`sed -E 's/[A-Za-z0-9]/x/g' .env`) first. The scanner expects `NAME=value` lines, and `.env.example` shows the format.
- Attio workspace: **Northern Loop** (slug `northern-loop`). The People fields the code uses are `name`, `email_addresses`, `phone_numbers`, `job_title`, `company` and `events`. `events` is a multi-select and doesn't exist until setup creates it.
- The Attio chat connection can read the workspace but **can't create fields**. Create fields with `npm run setup-attio` or by hand in Attio.
- Explain changes in plain English. The user isn't a developer.
