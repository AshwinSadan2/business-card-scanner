// Small matching helpers: event names, email domains, company names.

const squash = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// "saastr 2026", "SaaStr2026", "Saastr 2O26" all match "SaaStr 2026".
// Ignores case, spaces and punctuation, and allows a typo or two.
export function closestEvent(typed, existing) {
  const t = squash(typed);
  if (!t) return null;
  let best = null;
  for (const name of existing) {
    const d = distance(t, squash(name));
    const allowed = Math.max(1, Math.floor(Math.max(t.length, squash(name).length) * 0.15));
    if (d <= allowed && (!best || d < best.d)) best = { name, d };
  }
  return best?.name ?? null;
}

const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "msn.com",
]);

// Company website domain from the card's website or work email.
export function companyDomain(card) {
  if (card.website) {
    const host = card.website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    if (host.includes(".")) return host;
  }
  const emailDomain = card.email?.toLowerCase().split("@")[1];
  if (emailDomain && !FREE_EMAIL.has(emailDomain)) return emailDomain;
  return null;
}

export function sameCompanyName(a, b) {
  const clean = (s) => squash((s ?? "").replace(/\b(inc|ltd|llc|gmbh|corp|corporation|limited|co)\b\.?/gi, ""));
  return !!a && !!b && clean(a) === clean(b);
}
