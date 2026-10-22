// `npm run check` - confirms every key in .env is present and works.
// Prints only key names and OK / problem. Never prints a key's value.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import bolt from "@slack/bolt";
import * as attio from "../src/attio.js";

const REQUIRED = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "ATTIO_API_KEY", "ANTHROPIC_API_KEY"];
let ok = true;
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { ok = false; console.log(`  ❌ ${m}`); };

console.log("\nKeys in .env:");
for (const k of REQUIRED) (process.env[k] ? pass : fail)(`${k} ${process.env[k] ? "is set" : "is missing"}`);
if (!ok) process.exit(1);

console.log("\nConnections:");
try {
  const me = await attio.whoAmI();
  if (!me.active) fail("Attio key was rejected");
  else {
    pass(`Attio connected (workspace: ${me.workspace_name})`);
    const needed = ["record_permission:read-write", "object_configuration:read-write", "note:read-write"];
    const missing = needed.filter((s) => !me.scope.split(" ").includes(s));
    missing.length ? fail(`Attio key is missing permissions: ${missing.join(", ")}`) : pass("Attio key has the permissions it needs");
    (await attio.eventsAttributeExists()) ? pass(`"Events" field exists on People`) : fail(`"Events" field missing on People - run: npm run setup-attio`);
  }
} catch (e) {
  fail(`Attio: ${e.message}`);
}

try {
  const auth = await new bolt.App({ token: process.env.SLACK_BOT_TOKEN, signingSecret: "unused" }).client.auth.test();
  pass(`Slack connected (bot: ${auth.user}, workspace: ${auth.team})`);
} catch (e) {
  fail(`Slack bot token: ${e.data?.error ?? e.message}`);
}
if (!process.env.SLACK_APP_TOKEN.startsWith("xapp-")) fail("SLACK_APP_TOKEN should start with xapp- (it's the App-Level Token)");

try {
  await new Anthropic().models.retrieve("claude-opus-5-5");
  pass("Claude connected");
} catch (e) {
  fail(`Claude: ${e.status ? "HTTP " + e.status : e.message}`);
}

console.log(ok ? "\nAll good. Start it with: npm start\n" : "\nFix the ❌ items above, then run npm run check again.\n");
process.exit(ok ? 0 : 1);
