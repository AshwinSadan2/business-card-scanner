// Human-readable run log: logs/run.log at the project root.
// Every line: "2026-10-22 14:03  message". Also echoed to the terminal.
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.resolve("logs");
const LOG_FILE = path.join(LOG_DIR, "run.log");
fs.mkdirSync(LOG_DIR, { recursive: true });

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function log(message) {
  const line = `${stamp()}  ${message}`;
  fs.appendFileSync(LOG_FILE, line + "\n");
  console.log(line);
}

export function logError(context, err) {
  const detail = err?.status ? `HTTP ${err.status}: ${err.message}` : err?.message || String(err);
  log(`ERROR ${context}: ${detail}`);
}
