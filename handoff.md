# Handoff

## Where we are
Version 1 of the business card scanner is built, tested against stand-in services (13/13 tests pass) and pushed to the private repo `AshwinSadan2/business-card-scanner`. It hasn't touched the real Slack, Attio or Claude yet, because `.env` has no keys. The Attio workspace (Northern Loop) and the Slack channel (`#businesscard-scanner`) exist and have been checked.

## Last session did
- 2026-10-22: Built the scanner, the tests, the README, the Slack app manifest and the `.env` template. Created the GitHub repo.
- 2026-10-23: Checked Attio and Slack through the chat connections. All the People fields the code needs exist, "Events" doesn't yet, and the channel exists. Moved the interview script to `docs/` and wrote this handoff.

## Next session does
1. Check `.env` with the masked view first (`sed -E 's/[A-Za-z0-9]/x/g' .env`), then run `npm run check`.
2. Fix any ❌. If "Events" is missing, run `npm run setup-attio`.
3. Run `npm start`, post one real card in `#businesscard-scanner`, and compare the Attio record and `logs/run.log` against the card.
4. Fix whatever the real Attio rejects. Phone formats and the company-name search are the most likely, since they've only been checked against docs.

## Waiting on
- The user: create the Slack app from `slack-app-manifest.yml` and invite it with `/invite @Card Scanner`.
- The user: put 4 keys in `.env` (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ATTIO_API_KEY`, `ANTHROPIC_API_KEY`). See `README.md` steps 1–4.

*Last updated: 2026-10-23*
