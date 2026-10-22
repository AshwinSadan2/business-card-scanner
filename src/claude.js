// Everything that uses Claude: reading the card photo + message, and
// understanding thread replies ("email is jane@acme.com", "retry", ...).
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./log.js";

const MODEL = "claude-opus-5-5";
const client = new Anthropic({ maxRetries: 3, timeout: 60_000 });

const nullableString = { type: ["string", "null"] };

const CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards", "event", "note", "is_card_photo"],
  properties: {
    is_card_photo: {
      type: "boolean",
      description: "false if the photo has no business card in it at all",
    },
    cards: {
      type: "array",
      description: "One entry per readable business card front with a person on it. Empty if none (e.g. only the back of a card).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["first_name", "last_name", "email", "phone", "job_title", "company", "website"],
        properties: {
          first_name: nullableString,
          last_name: nullableString,
          email: nullableString,
          phone: nullableString,
          job_title: nullableString,
          company: nullableString,
          website: nullableString,
        },
      },
    },
    event: { ...nullableString, description: "Event name the user typed, exactly as typed. null if none." },
    note: { ...nullableString, description: "The user's note about the conversation / next steps. null if none." },
  },
};

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "event", "updates"],
  properties: {
    action: {
      type: "string",
      enum: ["retry", "update", "ignore"],
      description: "retry = user wants the card processed again; update = user is giving corrections or missing details; ignore = chit-chat, nothing to do",
    },
    event: { ...nullableString, description: "Event name if the user is giving or correcting it, else null" },
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["person_number", "first_name", "last_name", "email", "phone", "job_title", "company"],
        properties: {
          person_number: { type: "integer", description: "1-based number of the person in the list this update is for" },
          first_name: nullableString,
          last_name: nullableString,
          email: nullableString,
          phone: nullableString,
          job_title: nullableString,
          company: nullableString,
        },
      },
    },
  },
};

async function ask(content, schema) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("the card reader declined this image");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`the card reader returned nothing (stop reason: ${response.stop_reason})`);
  return JSON.parse(text);
}

export async function readCardPost(image, messageText) {
  log(`Sending photo to Claude (${MODEL}) to read the card`);
  return ask(
    [
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
      {
        type: "text",
        text:
          "This photo was posted in Slack by someone who met these people at an event. " +
          "Read every business card in the photo and copy the details exactly as printed " +
          "(keep phone numbers with their country code if shown). Leave a field null if it isn't on the card - never guess. " +
          "If you only see the back of a card or a logo with no person, return an empty cards list.\n\n" +
          "Also pull the event name and the note out of the Slack message below. The user usually writes " +
          "'Event: ...' and 'Note: ...', but may write it loosely. Anything that isn't the event name is the note.\n\n" +
          `Slack message:\n"""\n${messageText || "(no text)"}\n"""`,
      },
    ],
    CARD_SCHEMA,
  );
}

export async function readThreadReply(replyText, people, currentEvent) {
  const list = people
    .map((p, i) => `${i + 1}. ${p.first_name ?? ""} ${p.last_name ?? ""}, ${p.job_title ?? "no title"}, ${p.company ?? "no company"}, ${p.email ?? "no email"}`)
    .join("\n");
  log("Asking Claude what the thread reply means");
  return ask(
    [
      {
        type: "text",
        text:
          "A business card was scanned and these people were added to the CRM:\n" +
          `${list || "(nobody yet)"}\n` +
          `Event: ${currentEvent ?? "(none given)"}\n\n` +
          "The user then replied in the Slack thread. Work out what they want. " +
          "Only fill in fields they are actually giving or correcting; leave the rest null. " +
          "If there is just one person, updates are for person 1.\n\n" +
          `Reply:\n"""\n${replyText}\n"""`,
      },
    ],
    REPLY_SCHEMA,
  );
}
