// The step-by-step flow for (1) a new card post and (2) a reply in a card's thread.
import crypto from "node:crypto";
import * as attio from "./attio.js";
import { readCardPost, readThreadReply } from "./claude.js";
import { log, logError } from "./log.js";
import { closestEvent, companyDomain, sameCompanyName } from "./match.js";
import * as store from "./store.js";
import { withRetry } from "./retry.js";

const SUPPORTED_IMAGES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 4_500_000;
const RECENT_MINUTES = 10;

// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

async function reply(slack, channel, threadTs, text) {
  await withRetry("Slack reply", () => slack.chat.postMessage({ channel, thread_ts: threadTs, text, unfurl_links: false }));
  log("Slack reply sent");
}

// Downloads the card photo. iPhone HEIC photos and very large photos are
// swapped for Slack's own JPEG preview, which the card reader can open.
async function downloadImage(file) {
  let url = file.url_private_download || file.url_private;
  if (!SUPPORTED_IMAGES.includes(file.mimetype) || (file.size ?? 0) > MAX_IMAGE_BYTES) {
    url = file.thumb_1024 || file.thumb_960 || file.thumb_800 || file.thumb_720 || file.thumb_480;
    log(`Photo is ${file.mimetype}, ${Math.round((file.size ?? 0) / 1024)} KB - using Slack's preview image instead`);
  }
  if (!url) throw new Error("couldn't download the photo from Slack");
  const res = await withRetry("Slack photo download", async () => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
    if (!r.ok) {
      const err = new Error(`photo download failed (HTTP ${r.status})`);
      err.status = r.status;
      throw err;
    }
    return r;
  });
  const mediaType = (res.headers.get("content-type") || "").split(";")[0];
  if (!SUPPORTED_IMAGES.includes(mediaType)) {
    throw new Error(`Slack sent the photo as "${mediaType}", which can't be read. Is the bot missing the files:read permission?`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  log(`Downloaded photo (${mediaType}, ${Math.round(buffer.length / 1024)} KB)`);
  return { mediaType, base64: buffer.toString("base64") };
}

// ---------------------------------------------------------------------------
// Event + company
// ---------------------------------------------------------------------------

// Returns { title, isNew, typed } or null when no event was given.
async function resolveEvent(typed) {
  if (!typed?.trim()) return null;
  const existing = await attio.listEvents();
  const match = closestEvent(typed, existing);
  if (match) {
    log(`Event "${typed}" matched existing event "${match}"`);
    return { title: match, isNew: false, typed };
  }
  const title = typed.trim();
  await attio.createEvent(title);
  log(`No close match for "${typed}" among ${existing.length} events -> created new event "${title}"`);
  return { title, isNew: true, typed };
}

async function resolveCompany(card) {
  const domain = companyDomain(card);
  let company = null;
  if (domain) company = await attio.findCompanyByDomain(domain);
  if (!company && card.company) company = await attio.findCompanyByName(card.company);
  if (company) {
    log(`Found existing company in Attio (${card.company ?? domain})`);
    return { id: company.id.record_id, isNew: false };
  }
  if (!card.company) return { id: null, isNew: false };
  const created = await attio.createCompany(card.company, domain);
  log(`Created new company "${card.company}"${domain ? ` (${domain})` : ""}`);
  return { id: created.id.record_id, isNew: true };
}

// ---------------------------------------------------------------------------
// One person: match, create or update, tag, note
// ---------------------------------------------------------------------------

const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(" ");

async function findExisting(card, companyId) {
  const flags = [];
  if (card.email) {
    const byEmail = await attio.findPeopleByEmail(card.email);
    if (byEmail.length) {
      log(`Found existing person in Attio by email (${card.email}) -> updating`);
      return { existing: byEmail[0], flags };
    }
  }
  const name = fullName(card);
  if (name) {
    const byName = (await attio.findPeopleByName(name)).map((r) => ({ r, p: attio.describePerson(r) }));
    const sameCompany = byName.find(({ p }) => companyId && p.company_id === companyId);
    if (sameCompany && !card.email) {
      log(`Found existing person in Attio by name + company (${name}) -> updating`);
      return { existing: sameCompany.r, flags };
    }
    if (byName.length) {
      const other = byName[0].p;
      log(`Name "${name}" exists in Attio but email/company don't match -> creating new person, flagging possible duplicate`);
      flags.push(`⚠️ Possible duplicate of <${other.url}|${other.full_name}> - check and merge in Attio if it's the same person`);
    }
  }
  return { existing: null, flags };
}

// Writes the old value of every field that will change, so a bad overwrite can be undone.
async function logOverwrites(before, card, companyId) {
  const name = fullName(card);
  if (name && before.full_name && name !== before.full_name) log(`Overwriting name: was "${before.full_name}", now "${name}"`);
  if (card.job_title && card.job_title !== before.job_title) log(`Overwriting title: was "${before.job_title ?? "(empty)"}", now "${card.job_title}"`);
  if (companyId && before.company_id && companyId !== before.company_id) {
    const oldName = await attio.getCompanyName(before.company_id).catch(() => before.company_id);
    log(`Overwriting company: was "${oldName}" (${before.company_id}), now ${card.company ?? companyId}`);
  }
  if (card.email && !before.emails.includes(card.email.toLowerCase())) log(`Adding email ${card.email} (existing: ${before.emails.join(", ") || "none"})`);
  if (card.phone) log(`Adding phone ${card.phone} (existing: ${before.phones.join(", ") || "none"})`);
}

async function savePerson(card, { event, note, permalink, postTs }) {
  const flags = [];
  const name = fullName(card);
  if (!name && !card.email) {
    return { ok: false, line: `⚠️ Found a card${card.company ? ` for ${card.company}` : ""} but couldn't read a name or email - nothing added. Reply with the details.` };
  }

  const company = await resolveCompany(card);
  const { existing, flags: matchFlags } = await findExisting(card, company.id);
  flags.push(...matchFlags);

  let record;
  let status;
  if (existing) {
    const before = attio.describePerson(existing);
    const touched = store.lastTouched(before.id);
    const fromThisPost = (store.getCard(postTs)?.people ?? []).some((p) => p.recordId === before.id);
    if (touched && Date.now() - touched.getTime() < RECENT_MINUTES * 60_000 && !fromThisPost) {
      const mins = Math.max(1, Math.round((Date.now() - touched.getTime()) / 60_000));
      flags.push(`ℹ️ Already added ${mins === 1 ? "a minute" : mins + " minutes"} ago - updated, not duplicated`);
    }
    await logOverwrites(before, card, company.id);
    record = await attio.updatePerson(before.id, card, company.id);
    status = "updated";
  } else {
    record = await attio.createPerson(card, company.id);
    log(`Created new person "${name || card.email}"`);
    status = "new";
  }
  const person = attio.describePerson(record);
  store.touchPerson(person.id);

  if (card.phone) {
    try {
      await attio.addPhone(person.id, card.phone);
    } catch (err) {
      logError(`saving phone "${card.phone}"`, err);
      flags.push(`⚠️ Couldn't save phone "${card.phone}" (Attio didn't accept the format) - add it by hand`);
    }
  }

  if (event) {
    await attio.tagEvent(person.id, event.title);
    log(`Tagged with event "${event.title}"`);
  } else {
    flags.push("⚠️ No event given - reply here with it (e.g. `Event: SaaStr 2026`)");
  }

  const noteKey = crypto.createHash("sha1").update(`${postTs}|${note ?? ""}`).digest("hex");
  if (store.noteAlreadyAdded(person.id, noteKey)) {
    log("Note already on this person - not adding it again");
  } else {
    const content = [
      note || "(no note typed)",
      "",
      `Event: ${event?.title ?? "not given"}`,
      `Card photo: ${permalink ?? "(link unavailable)"}`,
      "Added by the business card scanner.",
    ].join("\n");
    await attio.addNote(person.id, event ? `Met at ${event.title}` : "Business card scan", content);
    store.rememberNote(person.id, noteKey);
    log("Note added");
  }

  if (!card.email) flags.push("⚠️ No email on the card - reply here with it");
  if (!card.company) flags.push("⚠️ No company on the card - reply here with it");

  const summary = [name, card.job_title, card.company, card.email].filter(Boolean).join(", ");
  const tag = event ? ` · Tagged: ${event.title} ✓` : "";
  const line = `✅ ${summary} - ${status === "new" ? "added to" : "updated in"} Attio${tag} · <${person.url}|Open in Attio>`;
  return { ok: true, line, flags, recordId: person.id, card, status };
}

// ---------------------------------------------------------------------------
// (1) New card post
// ---------------------------------------------------------------------------

export async function handleCardPost(slack, { channel, ts, text, files, user }, { force = false } = {}) {
  const previous = store.getCard(ts);
  if (previous && !force) {
    log(`Message ${ts} was already handled (${previous.status}) - skipping`);
    return;
  }
  const image = (files ?? []).find((f) => f.mimetype?.startsWith("image/"));
  log(`New card post in #${process.env.SLACK_CHANNEL_NAME} from user ${user} (message ${ts})${force ? " [retry]" : ""}`);
  store.saveCard(ts, { channel, text, files, user, status: "processing" });

  if (!image) {
    log("No photo in the message - nothing added");
    await reply(slack, channel, ts, "❌ No card photo found in this message. Post the photo with your event and note.");
    store.saveCard(ts, { status: "no photo" });
    return;
  }

  try {
    const permalink = (await slack.chat.getPermalink({ channel, message_ts: ts }).catch(() => null))?.permalink;
    const photo = await downloadImage(image);
    const read = await readCardPost(photo, text);
    log(`Read message: event "${read.event ?? "(none)"}", note "${read.note ?? "(none)"}"`);
    read.cards.forEach((c, i) =>
      log(`Read card ${i + 1}: ${[fullName(c), c.job_title, c.company, c.email, c.phone, c.website].map((v) => v ?? "-").join(", ")}`),
    );

    if (!read.cards.length) {
      log("No contact details found on the photo - nothing added");
      await reply(slack, channel, ts, read.is_card_photo
        ? "⚠️ Couldn't find contact details. Is this the back of the card? Nothing was added."
        : "⚠️ I couldn't see a business card in this photo. Nothing was added.");
      store.saveCard(ts, { status: "no details", event: read.event, note: read.note, people: [] });
      return;
    }

    const event = await resolveEvent(read.event);
    const lines = [];
    if (event?.isNew) lines.push(`🆕 New event created: *${event.title}*`);
    else if (event && event.typed.trim() !== event.title) lines.push(`Using existing event *${event.title}* (you typed "${event.typed}")`);

    const people = [];
    for (const card of read.cards) {
      try {
        const result = await savePerson(card, { event, note: read.note, permalink, postTs: ts });
        lines.push(result.line, ...(result.flags ?? []).map((f) => `      ${f}`));
        people.push({ ...card, recordId: result.recordId ?? null });
      } catch (err) {
        logError(`saving ${fullName(card) || card.email || "a card"}`, err);
        lines.push(`❌ ${fullName(card) || "Unknown person"} - not added to Attio, reason: ${err.message}. Reply 'retry' to try again.`);
        people.push({ ...card, recordId: null });
      }
    }
    if (read.cards.length > 1) lines.unshift(`Found ${read.cards.length} cards in this photo:`);

    store.saveCard(ts, { status: "done", event: event?.title ?? null, note: read.note, permalink, people });
    await reply(slack, channel, ts, lines.join("\n"));
    log(`Finished message ${ts}: ${people.filter((p) => p.recordId).length}/${people.length} people saved`);
  } catch (err) {
    logError(`processing message ${ts}`, err);
    store.saveCard(ts, { status: "failed", error: err.message });
    await reply(slack, channel, ts, `❌ Not added to Attio, reason: ${err.message}. Repost or reply 'retry'.`).catch((e) =>
      logError("sending the failure reply", e),
    );
  }
}

// ---------------------------------------------------------------------------
// (2) Reply in a card's thread: corrections, missing details, or "retry"
// ---------------------------------------------------------------------------

export async function handleThreadReply(slack, { channel, threadTs, text }) {
  const card = store.getCard(threadTs);
  if (!card) {
    log(`Thread reply on message ${threadTs}, which isn't a card post I know - ignoring`);
    return;
  }
  log(`Thread reply on card post ${threadTs}: "${text}"`);

  try {
    if (/^\s*retry\s*$/i.test(text)) {
      return await handleCardPost(slack, { channel, ts: threadTs, text: card.text, files: card.files, user: card.user }, { force: true });
    }
    const people = card.people ?? [];
    const intent = await readThreadReply(text, people, card.event);
    log(`Reply understood as: ${intent.action}${intent.event ? `, event "${intent.event}"` : ""}, ${intent.updates.length} person update(s)`);

    if (intent.action === "retry") {
      return await handleCardPost(slack, { channel, ts: threadTs, text: card.text, files: card.files, user: card.user }, { force: true });
    }
    if (intent.action === "ignore") return;

    const lines = [];
    let event = card.event ? { title: card.event, isNew: false, typed: card.event } : null;
    if (intent.event) {
      event = await resolveEvent(intent.event);
      lines.push(event.isNew ? `🆕 New event created: *${event.title}*` : `Event set to *${event.title}*`);
      for (const p of people.filter((p) => p.recordId)) {
        await attio.tagEvent(p.recordId, event.title);
        log(`Tagged ${fullName(p)} with event "${event.title}"`);
      }
      if (!intent.updates.length) lines.push(`✅ Tagged ${people.filter((p) => p.recordId).length} person/people with ${event.title}`);
    }

    for (const u of intent.updates) {
      const idx = u.person_number - 1;
      const current = people[idx] ?? {};
      const changes = Object.fromEntries(
        ["first_name", "last_name", "email", "phone", "job_title", "company"].filter((k) => u[k]).map((k) => [k, u[k]]),
      );
      if (!Object.keys(changes).length) continue;
      const merged = { ...current, ...changes };
      const changeText = Object.entries(changes).map(([k, v]) => `${k.replace("_", " ")} → ${v}`).join(", ");

      if (current.recordId) {
        log(`Applying correction to ${fullName(merged)}: ${changeText}`);
        const companyId = changes.company ? (await resolveCompany(merged)).id : null;
        const before = attio.describePerson(await attio.getPerson(current.recordId));
        await logOverwrites(before, changes, companyId);
        const updated = await attio.updatePerson(current.recordId, changes, companyId);
        if (changes.phone) await attio.addPhone(current.recordId, changes.phone);
        lines.push(`✅ Updated ${fullName(merged)}: ${changeText} · <${updated.web_url}|Open in Attio>`);
      } else {
        log(`Person ${u.person_number} wasn't saved before - adding now with the new details`);
        const result = await savePerson(merged, { event, note: card.note, permalink: card.permalink, postTs: threadTs });
        lines.push(result.line, ...(result.flags ?? []).map((f) => `      ${f}`));
        if (result.recordId) merged.recordId = result.recordId;
      }
      people[idx] = merged;
    }

    store.saveCard(threadTs, { event: event?.title ?? null, people });
    if (lines.length) await reply(slack, channel, threadTs, lines.join("\n"));
  } catch (err) {
    logError(`handling thread reply on ${threadTs}`, err);
    await reply(slack, channel, threadTs, `❌ Couldn't apply that, reason: ${err.message}. Try again or reply 'retry'.`).catch((e) =>
      logError("sending the failure reply", e),
    );
  }
}
