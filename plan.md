# Business Card Scanner

> This spec is designed to be used as context for a new Claude Code session. Drop it in a project folder and begin building from here.

## Outcome
At conferences, the user meets people and collects business cards. Instead of typing contacts in by hand, they post a photo of the card in a Slack channel (`#businesscard-scanner`) together with the event name and a short typed note about what they discussed and any next steps. Within about 30 seconds, the system reads the card, creates or updates the person in Attio, links them to their company, attaches the note, tags them with the event, and replies in the Slack thread to confirm what it did. Version 1 is for one user (the owner) across many events; teammates may use it later by posting in the same channel.

## Success Signal
The morning after an event where the user met, say, 30 people, they open Attio and:
1. **All 30** people are there, with none missing or duplicated
2. Details are **correct**: name, email, phone, job title and company match the cards
3. Each person is **linked to their company** (3 people from Acme all show under Acme)
4. Each person has **the user's note** attached
5. Each person is **tagged with the event** (e.g. "SaaStr 2026"), so everyone from that event can be pulled up later

Every card posted in Slack also has a ✅, ⚠️ or ❌ reply in its thread. No card goes unanswered.

## Inputs
- **Card photo:** a photo of the business card — from a Slack message the user posts in `#businesscard-scanner` — freshness: processed as soon as it's posted
- **Event name:** typed in the same Slack message (e.g. `Event: SaaStr 2026`) — freshness: per message
- **Note:** typed in the same Slack message (what they talked about, next steps) — freshness: per message
- **Existing Attio data:** people, companies and previously used event names — from Attio — freshness: checked live on every card (used for matching people, companies and events)

**Suggested message format** (the system should also cope with loose variations):
```
[card photo]
Event: SaaStr 2026
Note: Talked about scaling their outbound team. Send pricing deck by Friday.
```

**Missing or unreadable data:** add whatever can be read and flag the gaps in the Slack reply (e.g. "⚠️ No email found, reply here with it"). The user can reply in the thread with the missing detail and the system updates Attio.

**Offline note:** Slack can't send without a connection. A message written offline is held or marked "not sent" on the phone and is processed once it goes through. The system can't see anything until Slack delivers it.

## Logic
- **Trigger:** a new message with a photo posted in `#businesscard-scanner`. Thread replies on an existing card post are also handled, as corrections or extra details for that card.
- **Decision points:**
  1. **Is there a photo?** No → reply "No card photo found" and do nothing in Attio.
  2. **How many cards are in the photo?** One → continue. Several → process each person separately, with the same note and event. None readable (e.g. the back of a card) → reply "⚠️ Couldn't find contact details. Is this the back of the card?" and add nothing.
  3. **Is this person already in Attio?** Match on **email first**. With no email on the card, match on **name + company**. If unclear (name-only match, or same name at a different company), create a new person and flag "⚠️ Possible duplicate of [link]".
  4. **Existing person → overwrite.** The card is treated as the newest information: new title, company, phone etc. replace the old values. **Old values are written to the log before overwriting.**
  5. **Is the company already in Attio?** Yes → link the person to it. No → create the company, then link.
  6. **Which event?** Compare the typed event name with events already in Attio and use the closest match (ignoring case, spacing and small typos). No close match → create a new event and say so in the reply ("🆕 New event created: Saastr26"). No event typed → add the person anyway and flag "⚠️ No event given, reply with it."
  7. **Was this card already processed?** (e.g. posted twice) → update instead of duplicating, add the note only once, and reply "Already added a minute ago."
- **Rules:**
  - Only react to messages in `#businesscard-scanner`. Ignore the rest of Slack.
  - Only act on messages that contain a photo (or thread replies to a card post).
  - **Never delete anything in Attio.** Only create and update.
  - Every person must end up with an event tag, or a ⚠️ asking for one.
  - **A card is never silently lost.** Every post gets a ✅, ⚠️ or ❌ reply.
  - If something fails (Attio down, card reading times out), retry automatically a few times. If it still fails, reply "❌ Not added to Attio, reason: ___. Repost or reply 'retry'."
- **Human-in-the-loop:** none before writing. By the user's choice, the system writes to Attio **fully automatically**. The user reviews afterwards through the Slack thread reply and fixes mistakes by replying in the thread. (See High-Stakes Actions and Open Questions for the tradeoff.)

## Output
- **Produces (per person on the card):**
  1. A **person record** in Attio (created or updated): name, email, phone, job title
  2. A **company record** in Attio (created if new), with the person linked to it
  3. A **note** on the person containing the user's typed note, the event name, and a **link back to the Slack message** with the card photo
  4. An **event tag** on the person (one consistent value per event, so all contacts from an event can be filtered)
  5. A **reply in the Slack thread**, e.g. "✅ Jane Doe, VP Sales, Acme, jane@acme.com, added to Attio · Tagged: SaaStr 2026 ✓ · [Attio link]", plus any ⚠️ flags
- **Consumer:** the user (later, teammates), in Attio and in the Slack thread.
- **Storage:** contact data lives in Attio. The card photo stays in Slack and is linked from the Attio note (not copied). The run history lives in the log file.

## Version Control
- **Repo:** GitHub (private)
- **`.gitignore` must exclude:** `.env`, API keys/tokens (Slack, Attio, AI provider), `logs/`, local data files, any secrets
- **Commit cadence:** at least one commit per working milestone; push regularly
- **Why:** one rollback-able safety net is worth more than any other guardrail in early builds

## Logging (Phase 1 Guardrail)
- **Log location:** `logs/run.log` at project root
- **What gets logged:** each card received (time, channel, event, note), what was read from the card, the matching decision (new vs. existing person/company/event, and why), **the old values of any field before it is overwritten**, every call to Attio and Slack with whether it succeeded, every retry, and every error with full context
- **Format:** human-readable lines, e.g.
  ```
  2026-10-22 14:03  New card from #businesscard-scanner (event: SaaStr 2026)
  2026-10-22 14:03  Read card: Jane Doe, VP Sales, Acme, jane@acme.com
  2026-10-22 14:03  Found existing person in Attio by email → updating
  2026-10-22 14:03  Overwriting title: was "Head of Sales", now "VP Sales"
  2026-10-22 14:03  Attio update OK. Note added. Slack reply sent.
  ```
- **Why:** in version one, this is the single best tool for debugging when something goes wrong, and the old-value lines let us undo a bad overwrite.

## High-Stakes Actions & Approval Gates
- **Action:** creating and updating people and companies in Attio, including **overwriting existing fields**
  - **Why it's high-stakes:** a misread card (blurry photo, stylized font) can replace correct, verified data in the CRM, and Attio has no easy "undo"
  - **Approval gate:** **none, by the user's explicit choice (fully automatic).** Mitigations: (1) the old values are logged before every overwrite so they can be restored; (2) every card gets a Slack reply showing exactly what was written, so mistakes are visible within a minute; (3) the system never deletes anything.
- **Action:** posting replies in Slack
  - **Why it's high-stakes:** low. It only replies in threads in the user's own `#businesscard-scanner` channel.
  - **Approval gate:** none needed.

## System Edges
- **Edge 1: Event name typed differently** ("SaaStr 2026" vs "Saastr26") → match to the closest existing event; the reply shows which event was used, or "🆕 New event created" so typos are obvious.
- **Edge 2: Something fails partway** (Attio down, card reading times out, connection drops) → retry automatically a few times; if it still fails, reply "❌ Not added to Attio, reason: ___. Repost or reply 'retry'." A card is never silently lost.
- **Edge 3: Same card posted twice** → recognized via the email match (and the recent post history); update, don't duplicate; add the note once; reply "Already added a minute ago."
- **Edge 4: Two cards in one photo, or the back of a card** → several cards: add each person separately with the same note/event and list them all in the reply. No contact details found: reply "⚠️ Is this the back of the card?" and add nothing.
- **Edge 5: Bad overwrite from a misread card** → accepted risk (fully automatic). Old values are in the log so they can be restored; the Slack reply makes the mistake visible straight away.

## System Diagram
See `diagram.html` for the visual flow.

## Suggested Tech Stack (High-Level)
- **Slack** (named by the user): where cards are posted and confirmations are replied
- **Attio** (named by the user): the CRM where people, companies, notes and event tags live
- **An AI model that can read images:** to read the card photo and pull out the contact details
- **A small always-on service:** listens for new posts in the Slack channel and runs the steps within a minute
- **A log file:** `logs/run.log`
- **GitHub:** private repo for version control

## Open Questions
- **Overwrite risk (accepted tradeoff):** the user chose fully automatic overwriting of existing Attio records with no approval step. If bad overwrites start happening, revisit the "middle ground" option: new people are added automatically, but changes to existing people show a before/after in Slack and wait for a ✅.
- **How to store the event tag in Attio:** a select/multi-select field on the person, an Attio list per event, or a separate "Events" object. A person can meet you at several events over time, so it needs to hold more than one event. Decide during the build after looking at the Attio workspace.
- **Job changes:** if someone changes company, their email changes too, so the system will create a new person. The "possible duplicate" warning catches some of these; merging is manual for now.
- **Teammates later:** decide whether anyone in the channel can post cards and whether the note should record who met the person.
- **Version 2 ideas:** voice notes instead of typed notes (turned into text automatically); draft follow-up emails for each contact based on the note (drafts only, never sent automatically); looking up missing emails/LinkedIn when the card doesn't have them.
