# Business Card Scanner

Post a photo of a business card in `#businesscard-scanner` with the event name and a note. Within about 30 seconds the person is in Attio with their company, your note and an event tag, and the bot replies in the Slack thread with what it did.

```
[card photo]
Event: SaaStr 2026
Note: Talked about scaling their outbound team. Send pricing deck by Friday.
```

The full spec is in `plan.md` and the flow diagram is in `diagram.html`.

---

## One-time setup (about 15 minutes)

### 1. Create the Slack app
1. Go to https://api.slack.com/apps, click **Create New App**, then **From a manifest**, and pick your workspace.
2. Paste in everything from `slack-app-manifest.yml` and click **Create**.
3. **Basic Information** page: scroll to **App-Level Tokens**, click **Generate Token**, give it any name, add the scope `connections:write`, then save. This is your `SLACK_APP_TOKEN` (starts with `xapp-`).
4. **Install App** page: click **Install to Workspace**. Then copy the **Bot User OAuth Token**. This is your `SLACK_BOT_TOKEN` (starts with `xoxb-`).
5. In Slack, create the `#businesscard-scanner` channel (private or public) and type `/invite @Card Scanner` in it.

### 2. Create the Attio key
In Attio, go to **Workspace settings → Developers → New access token**. Give it these permissions, set to **Read & write**:
- Records
- Object configuration
- Notes

### 3. Get a Claude key
Go to https://console.anthropic.com, open **API keys** and create one.

### 4. Put the keys in `.env`
Copy `.env.example` to a new file called `.env` in this folder and paste each key after its `=`. Keep one key per line, in the form `NAME=value`. `.env` never goes to GitHub.

### 5. Install, prepare Attio, check everything
In Terminal, in this folder:
```
npm install
npm run setup-attio     # adds an "Events" field to People in Attio (one time)
npm run check           # tests every key. Shows ✅ or ❌, never the key itself
```

### 6. Start it
```
npm start
```
Leave that Terminal window open. The scanner only works while it's running and your Mac is awake and online. When you're ready, it can move to a small always-on server so it runs 24/7.

---

## Using it

| You post | The bot does |
|---|---|
| Photo + event + note | ✅ Adds or updates the person, links the company, adds the note, tags the event |
| Photo with two or more cards | Adds each person separately with the same note and event |
| Photo of the back of a card | ⚠️ Asks if it's the back. Adds nothing |
| No event typed | Adds the person and ⚠️ asks for the event. Reply `Event: SaaStr 2026` |
| An event spelled differently ("saastr26") | Uses the closest existing event and says which one, or 🆕 creates a new one |
| Something fails (Attio down etc.) | Retries automatically, then ❌ explains why. Reply `retry` |

**Fixing things:** reply in the card's thread in plain English, e.g. "her email is jane@acme.com" or "title is actually CRO". The bot updates Attio and confirms.

## What it will never do
- Delete anything in Attio. It only creates and updates. Emails, phones and events are added to what's already there, never removed.
- React to anything outside `#businesscard-scanner`.

## When something looks wrong
Open `logs/run.log`. Each card shows up as plain lines: what was read, whether the person was new or existing and why, every Attio call, and every error. **Before any field is overwritten, its old value is written to the log**, e.g. `Overwriting title: was "Head of Sales", now "VP Sales"`. Use that to put back anything a misread card changed.

## For builders
- `src/index.js` listens to Slack. `src/process.js` runs the card and reply flows. `src/claude.js` reads cards (Claude Opus 5.5). `src/attio.js` talks to Attio. `src/match.js` matches event names and company domains.
- `npm test` runs the whole flow against a fake Attio, Slack and card reader.
- Local memory (which posts were handled, which notes were added) is in `data/state.json`. It's git-ignored.
