// Small local memory in data/state.json (git-ignored).
// - cards: one entry per Slack card post (keyed by message ts), so a post is
//   never processed twice and thread replies know which people they refer to.
// - recentPeople: Attio record id -> last time we wrote to it, to spot the
//   same card being posted twice in quick succession.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { cards: {}, recentPeople: {} };
  }
}

let state = load();

function save() {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export function getCard(ts) {
  return state.cards[ts];
}

export function saveCard(ts, card) {
  state.cards[ts] = { ...state.cards[ts], ...card, updatedAt: new Date().toISOString() };
  save();
}

export function lastTouched(recordId) {
  return state.recentPeople[recordId] ? new Date(state.recentPeople[recordId]) : null;
}

export function touchPerson(recordId) {
  state.recentPeople[recordId] = new Date().toISOString();
  save();
}

// Remembers which notes were already put on which person, so a card posted
// twice (or retried) doesn't get the same note twice.
export function noteAlreadyAdded(recordId, noteKey) {
  return (state.notes?.[recordId] ?? []).includes(noteKey);
}

export function rememberNote(recordId, noteKey) {
  state.notes ??= {};
  state.notes[recordId] = [...(state.notes[recordId] ?? []), noteKey];
  save();
}
