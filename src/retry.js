import { log } from "./log.js";

// Try something up to `attempts` times, waiting a bit longer each time.
// Only retries failures that might go away on their own (timeouts, outages,
// "too many requests"). Mistakes in what we sent (400s) fail straight away.
export async function withRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      const worthRetrying = !status || status === 408 || status === 429 || status >= 500;
      if (!worthRetrying || i === attempts) break;
      const waitMs = 2000 * i;
      log(`Retry ${i}/${attempts - 1} for ${label} in ${waitMs / 1000}s (${status ? "HTTP " + status : err.message})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
