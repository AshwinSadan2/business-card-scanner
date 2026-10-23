# Decisions

## 2026-10-22: Build in Node.js, with Slack connected in "Socket Mode", running on the Mac for now
- Why: Node is already installed. Socket Mode lets the scanner hear Slack without a public web address, so it runs from the laptop with no server setup. The Mac's Python (3.9) is too old for the current Claude library.
- What we didn't pick: Python, because of the old version and the extra install. A hosted server (e.g. Vercel), which is more setup before we know v1 works; we'll move there once real cards work. Zapier or Make, which can't do the matching, overwrite logging and thread corrections the plan needs.

## 2026-10-22: Store event tags as a multi-select "Events" field on People in Attio
- Why: one person can be met at several events. A multi-select field holds all of them and is easy to filter on ("everyone from SaaStr 2026").
- What we didn't pick: one Attio list per event, which means a new list for every event and clutter. A separate "Events" object, which is more powerful but too heavy for v1.

## 2026-10-22: Emails and phone numbers are added, never replaced. Name, job title and company are overwritten
- Why: the plan says the card is the newest information, but the plan also says never delete anything in Attio. Replacing an email or phone would delete the old one. The old value of every overwritten field is written to `logs/run.log` first, so it can be put back.
- What we didn't pick: replacing everything, which loses old contact details. Asking before every overwrite, which the user turned down in planning (fully automatic was chosen; see Open Questions in `plan.md`).

## 2026-10-22: Read cards with Claude Opus 5.5, with automatic fallback to another model if it declines
- Why: it's the most accurate current model for reading images, and the fallback means a card is never stuck on a refusal.
- What we didn't pick: a cheaper model (Sonnet or Haiku). That stays possible later if cost matters; it's one line in `src/claude.js`.

## 2026-10-22: Keep a small local memory in `data/state.json`
- Why: Slack sometimes delivers the same message twice, and reposts or `retry` mustn't add the same note twice. Thread replies also need to know which people a card created.
- What we didn't pick: storing this in Attio, which would add clutter fields. Having no memory, which risks duplicate notes.

## 2026-10-23: Move the interview script out of `CLAUDE.md` into `docs/interview-agent.md`
- Why: the design phase is done. Left in `CLAUDE.md`, every new session would start the interview instead of building.
- What we didn't pick: deleting it, since it may be useful for designing the next system.
