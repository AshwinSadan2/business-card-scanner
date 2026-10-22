import { test } from "node:test";
import assert from "node:assert/strict";
import { closestEvent, companyDomain, sameCompanyName } from "../src/match.js";

test("event names match despite case, spacing and small typos", () => {
  const events = ["SaaStr 2026", "Dreamforce 2026", "Web Summit"];
  assert.equal(closestEvent("saastr 2026", events), "SaaStr 2026");
  assert.equal(closestEvent("SaaStr2026", events), "SaaStr 2026");
  assert.equal(closestEvent("Saastr 2025", events), "SaaStr 2026"); // one typo
  assert.equal(closestEvent("dreamforce", events), null); // too different -> new event
  assert.equal(closestEvent("Websummit", events), "Web Summit");
  assert.equal(closestEvent("", events), null);
});

test("company domain comes from website, else work email, never gmail", () => {
  assert.equal(companyDomain({ website: "https://www.acme.com/about" }), "acme.com");
  assert.equal(companyDomain({ email: "jane@acme.io" }), "acme.io");
  assert.equal(companyDomain({ email: "jane@gmail.com" }), null);
  assert.equal(companyDomain({}), null);
});

test("company names compare without Inc/Ltd", () => {
  assert.ok(sameCompanyName("Acme, Inc.", "acme"));
  assert.ok(!sameCompanyName("Acme", "Apex"));
});
