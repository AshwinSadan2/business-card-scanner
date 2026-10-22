// The always-on listener. Connects to Slack, watches #businesscard-scanner,
// and hands each card post / thread reply to process.js one at a time.
import "dotenv/config";
import bolt from "@slack/bolt";
import { log, logError } from "./log.js";
import { handleCardPost, handleThreadReply } from "./process.js";

const { App } = bolt;
const CHANNEL_NAME = (process.env.SLACK_CHANNEL_NAME || "businesscard-scanner").replace(/^#/, "");
process.env.SLACK_CHANNEL_NAME = CHANNEL_NAME;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

async function findChannelId() {
  let cursor;
  do {
    const res = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 200, cursor });
    const hit = res.channels.find((c) => c.name === CHANNEL_NAME);
    if (hit) return hit.id;
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
  throw new Error(`Channel #${CHANNEL_NAME} not found. Create it and invite the bot with /invite @Card Scanner`);
}

// One job at a time, so two cards from the same event can't both create the event.
let queue = Promise.resolve();
const enqueue = (job) => {
  queue = queue.then(job).catch((err) => logError("unexpected problem", err));
};

let channelId;

app.event("message", async ({ event, client }) => {
  if (event.channel !== channelId) return; // ignore the rest of Slack
  if (event.bot_id || event.subtype === "bot_message") return; // ignore our own replies
  if (event.subtype && !["file_share", "thread_broadcast"].includes(event.subtype)) return; // edits, deletes, joins...

  const isThreadReply = event.thread_ts && event.thread_ts !== event.ts;
  if (isThreadReply) {
    enqueue(() => handleThreadReply(client, { channel: event.channel, threadTs: event.thread_ts, text: event.text ?? "" }));
  } else {
    enqueue(() => handleCardPost(client, { channel: event.channel, ts: event.ts, text: event.text ?? "", files: event.files, user: event.user }));
  }
});

(async () => {
  try {
    await app.start();
    channelId = await findChannelId();
    log(`Business card scanner is running - watching #${CHANNEL_NAME}`);
  } catch (err) {
    logError("starting up", err);
    process.exit(1);
  }
})();
