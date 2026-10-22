// End-to-end run of the card flow with a fake Attio, fake Slack and fake card
// reader - no real keys or network needed.
import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- fake card reader (stands in for Claude) ----
let nextRead;
let nextReply;
mock.module("../src/claude.js", {
  namedExports: {
    readCardPost: async () => nextRead,
    readThreadReply: async () => nextReply,
  },
});

// ---- fake Attio ----
const db = { people: [], companies: [], notes: [], events: ["SaaStr 2026"] };
let idSeq = 0;
const newId = () => `rec-${++idSeq}`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function personRecord(p) {
  return {
    id: { record_id: p.id },
    web_url: `https://app.attio.com/x/person/${p.id}`,
    values: {
      name: p.name ? [p.name] : [],
      email_addresses: p.emails.map((e) => ({ email_address: e })),
      phone_numbers: p.phones.map((n) => ({ original_phone_number: n })),
      job_title: p.job_title ? [{ value: p.job_title }] : [],
      company: p.company ? [{ target_record_id: p.company }] : [],
      events: p.events.map((t) => ({ option: { title: t } })),
    },
  };
}

function applyValues(p, v) {
  if (v.name) p.name = v.name[0];
  if (v.email_addresses) p.emails = [...new Set([...v.email_addresses, ...p.emails])];
  if (v.phone_numbers) p.phones = [v.phone_numbers[0].original_phone_number, ...p.phones];
  if (v.job_title) p.job_title = v.job_title;
  if (v.company) p.company = v.company[0].target_record_id;
  if (v.events) {
    for (const t of v.events) if (!db.events.includes(t)) return false;
    p.events = [...new Set([...v.events, ...p.events])];
  }
  return true;
}

async function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  if (u.host === "files.slack.com") {
    return new Response(Buffer.from("fakejpeg"), { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  const p = u.pathname.replace("/v2", "");
  const body = opts.body ? JSON.parse(opts.body) : {};
  const m = opts.method;

  if (m === "POST" && p === "/objects/people/records/query") {
    const f = body.filter;
    const hits = db.people.filter((x) =>
      f.email_addresses ? x.emails.includes(f.email_addresses.email_address.$eq) : x.name?.full_name === f.name.full_name.$eq,
    );
    return json(200, { data: hits.map(personRecord) });
  }
  if (m === "POST" && p === "/objects/people/records") {
    const person = { id: newId(), name: null, emails: [], phones: [], job_title: null, company: null, events: [] };
    applyValues(person, body.data.values);
    db.people.push(person);
    return json(200, { data: personRecord(person) });
  }
  let hit = p.match(/^\/objects\/people\/records\/(.+)$/);
  if (hit) {
    const person = db.people.find((x) => x.id === hit[1]);
    if (m === "GET") return json(200, { data: personRecord(person) });
    const v = body.data.values;
    if (v.phone_numbers && !/\d{6,}/.test(v.phone_numbers[0].original_phone_number.replace(/\D/g, ""))) {
      return json(400, { message: "Invalid phone number" });
    }
    if (!applyValues(person, v)) return json(400, { message: "Unknown select option" });
    return json(200, { data: personRecord(person) });
  }
  if (m === "POST" && p === "/objects/companies/records/query") {
    const f = body.filter;
    const hits = db.companies.filter((c) => (f.domains ? c.domains.includes(f.domains.domain.$eq) : c.name === f.name.$eq));
    return json(200, { data: hits.map((c) => ({ id: { record_id: c.id }, values: { name: [{ value: c.name }] } })) });
  }
  if (m === "POST" && p === "/objects/companies/records") {
    const c = { id: newId(), name: body.data.values.name, domains: body.data.values.domains ?? [] };
    db.companies.push(c);
    return json(200, { data: { id: { record_id: c.id } } });
  }
  hit = p.match(/^\/objects\/companies\/records\/(.+)$/);
  if (hit) {
    const c = db.companies.find((x) => x.id === hit[1]);
    return json(200, { data: { id: { record_id: c.id }, values: { name: [{ value: c.name }] } } });
  }
  if (p === "/notes") {
    db.notes.push(body.data);
    return json(200, { data: {} });
  }
  if (p === "/objects/people/attributes/events/options") {
    if (m === "GET") return json(200, { data: db.events.map((title) => ({ title, is_archived: false })) });
    db.events.push(body.data.title);
    return json(200, { data: {} });
  }
  return json(404, { message: `fake Attio has no route ${m} ${p}` });
}

// ---- fake Slack ----
const replies = [];
const slack = {
  chat: {
    postMessage: async (msg) => replies.push(msg),
    getPermalink: async ({ message_ts }) => ({ permalink: `https://slack.com/archives/C1/p${message_ts}` }),
  },
};
const photo = [{ mimetype: "image/jpeg", size: 1000, url_private_download: "https://files.slack.com/card.jpg" }];
const lastReply = () => replies.at(-1).text;

let handleCardPost, handleThreadReply;
before(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "cardscan-")));
  globalThis.fetch = fakeFetch;
  process.env.SLACK_CHANNEL_NAME = "businesscard-scanner";
  ({ handleCardPost, handleThreadReply } = await import("../src/process.js"));
});

const jane = { first_name: "Jane", last_name: "Doe", email: "jane@acme.com", phone: "+1 415 555 0100", job_title: "VP Sales", company: "Acme", website: null };

test("new card: person, company, note and event created; reply is ✅", async () => {
  nextRead = { is_card_photo: true, cards: [jane], event: "saastr 2026", note: "Send pricing deck by Friday" };
  await handleCardPost(slack, { channel: "C1", ts: "1.1", text: "...", files: photo, user: "U1" });

  assert.equal(db.people.length, 1);
  assert.equal(db.companies.length, 1);
  assert.equal(db.people[0].company, db.companies[0].id);
  assert.deepEqual(db.people[0].events, ["SaaStr 2026"]); // matched existing event, not a new one
  assert.equal(db.notes.length, 1);
  assert.match(db.notes[0].content, /Send pricing deck/);
  assert.match(db.notes[0].content, /slack\.com\/archives/);
  assert.match(lastReply(), /✅ Jane Doe, VP Sales, Acme, jane@acme.com - added to Attio · Tagged: SaaStr 2026/);
  assert.match(lastReply(), /you typed "saastr 2026"/);
});

test("same Slack message delivered twice is ignored", async () => {
  const before = replies.length;
  await handleCardPost(slack, { channel: "C1", ts: "1.1", text: "...", files: photo, user: "U1" });
  assert.equal(replies.length, before);
});

test("same card posted again: updated not duplicated, flagged as already added", async () => {
  nextRead = { is_card_photo: true, cards: [{ ...jane, job_title: "CRO" }], event: "SaaStr 2026", note: "Send pricing deck by Friday" };
  await handleCardPost(slack, { channel: "C1", ts: "1.2", text: "...", files: photo, user: "U1" });
  assert.equal(db.people.length, 1);
  assert.equal(db.people[0].job_title, "CRO");
  assert.match(lastReply(), /updated in Attio/);
  assert.match(lastReply(), /Already added a minute ago/);
  const log = fs.readFileSync("logs/run.log", "utf8");
  assert.match(log, /Overwriting title: was "VP Sales", now "CRO"/);
});

test("two cards, new event, one without email", async () => {
  const bob = { first_name: "Bob", last_name: "Lee", email: null, phone: null, job_title: "CTO", company: "Acme", website: null };
  const amy = { first_name: "Amy", last_name: "Chu", email: "amy@globex.com", phone: "n/a", job_title: null, company: "Globex", website: null };
  nextRead = { is_card_photo: true, cards: [bob, amy], event: "Web Summit", note: "Intro call next week" };
  await handleCardPost(slack, { channel: "C1", ts: "2.1", text: "...", files: photo, user: "U1" });

  assert.equal(db.people.length, 3);
  assert.ok(db.events.includes("Web Summit"));
  const text = lastReply();
  assert.match(text, /Found 2 cards/);
  assert.match(text, /🆕 New event created: \*Web Summit\*/);
  assert.match(text, /No email on the card/);
  assert.match(text, /Couldn't save phone "n\/a"/); // bad phone doesn't block the rest
  assert.equal(db.people.find((p) => p.name.full_name === "Bob Lee").company, db.companies.find((c) => c.name === "Acme").id); // linked to the same Acme
});

test("thread reply fills in the missing email", async () => {
  nextReply = { action: "update", event: null, updates: [{ person_number: 1, first_name: null, last_name: null, email: "bob@acme.com", phone: null, job_title: null, company: null }] };
  await handleThreadReply(slack, { channel: "C1", threadTs: "2.1", text: "Bob's email is bob@acme.com" });
  assert.ok(db.people.find((p) => p.name.full_name === "Bob Lee").emails.includes("bob@acme.com"));
  assert.match(lastReply(), /✅ Updated Bob Lee: email → bob@acme.com/);
});

test("back of a card: nothing added, ⚠️ reply", async () => {
  const count = db.people.length;
  nextRead = { is_card_photo: true, cards: [], event: "SaaStr 2026", note: null };
  await handleCardPost(slack, { channel: "C1", ts: "3.1", text: "", files: photo, user: "U1" });
  assert.equal(db.people.length, count);
  assert.match(lastReply(), /Is this the back of the card\?/);
});

test("no photo: ❌ reply", async () => {
  await handleCardPost(slack, { channel: "C1", ts: "4.1", text: "Event: X", files: [], user: "U1" });
  assert.match(lastReply(), /No card photo found/);
});

test("no event typed: person added with ⚠️ asking for it, then reply sets it", async () => {
  nextRead = { is_card_photo: true, cards: [{ ...jane, first_name: "Raj", last_name: "Patel", email: "raj@initech.com", company: "Initech", phone: null }], event: null, note: "Nice chat" };
  await handleCardPost(slack, { channel: "C1", ts: "5.1", text: "...", files: photo, user: "U1" });
  assert.match(lastReply(), /No event given/);
  nextReply = { action: "update", event: "Saastr 2026", updates: [] };
  await handleThreadReply(slack, { channel: "C1", threadTs: "5.1", text: "Event: Saastr 2026" });
  assert.deepEqual(db.people.find((p) => p.name.full_name === "Raj Patel").events, ["SaaStr 2026"]);
});

test("same name at a different company: new person + possible duplicate flag", async () => {
  nextRead = { is_card_photo: true, cards: [{ ...jane, email: null, company: "Hooli", phone: null }], event: "SaaStr 2026", note: null };
  await handleCardPost(slack, { channel: "C1", ts: "6.1", text: "...", files: photo, user: "U1" });
  assert.equal(db.people.filter((p) => p.name.full_name === "Jane Doe").length, 2);
  assert.match(lastReply(), /Possible duplicate of/);
});

test("Attio down: ❌ reply with reason, then 'retry' works", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url).includes("attio") ? json(503, { message: "Service unavailable" }) : realFetch(url, opts));
  nextRead = { is_card_photo: true, cards: [{ ...jane, first_name: "Kim", last_name: "Ng", email: "kim@umbrella.com", company: "Umbrella", phone: null }], event: "SaaStr 2026", note: "x" };
  await handleCardPost(slack, { channel: "C1", ts: "7.1", text: "...", files: photo, user: "U1" });
  assert.match(lastReply(), /❌ Not added to Attio, reason: Service unavailable/);

  globalThis.fetch = realFetch;
  await handleThreadReply(slack, { channel: "C1", threadTs: "7.1", text: "retry" });
  assert.ok(db.people.some((p) => p.name.full_name === "Kim Ng"));
  assert.match(lastReply(), /✅ Kim Ng/);
});
