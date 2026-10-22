// Talks to Attio. This file only ever creates and updates - it never deletes.
import { log } from "./log.js";
import { withRetry } from "./retry.js";

const BASE = "https://api.attio.com/v2";
export const EVENTS_ATTRIBUTE = "events"; // multi-select field on People, created by `npm run setup-attio`

async function call(method, pathname, body) {
  return withRetry(`Attio ${method} ${pathname}`, async () => {
    const res = await fetch(BASE + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.ATTIO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      log(`Attio ${method} ${pathname} -> FAILED (HTTP ${res.status})`);
      const err = new Error(json.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    log(`Attio ${method} ${pathname} -> OK`);
    return json;
  });
}

// ---- reading values out of Attio records ----

const first = (record, slug) => record?.values?.[slug]?.[0];

export function describePerson(record) {
  const name = first(record, "name");
  return {
    id: record.id.record_id,
    url: record.web_url,
    full_name: name?.full_name ?? null,
    first_name: name?.first_name ?? null,
    last_name: name?.last_name ?? null,
    emails: (record.values?.email_addresses ?? []).map((e) => e.email_address),
    phones: (record.values?.phone_numbers ?? []).map((p) => p.phone_number ?? p.original_phone_number),
    job_title: first(record, "job_title")?.value ?? null,
    company_id: first(record, "company")?.target_record_id ?? null,
    events: (record.values?.[EVENTS_ATTRIBUTE] ?? []).map((o) => o.option?.title).filter(Boolean),
  };
}

// ---- people ----

export async function getPerson(recordId) {
  const res = await call("GET", `/objects/people/records/${recordId}`);
  return res.data;
}

export async function findPeopleByEmail(email) {
  const res = await call("POST", "/objects/people/records/query", {
    filter: { email_addresses: { email_address: { $eq: email.toLowerCase() } } },
    limit: 5,
  });
  return res.data;
}

export async function findPeopleByName(fullName) {
  const res = await call("POST", "/objects/people/records/query", {
    filter: { name: { full_name: { $eq: fullName } } },
    limit: 10,
  });
  return res.data;
}

function personValues(p, companyId) {
  const values = {};
  if (p.first_name || p.last_name) {
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ");
    values.name = [{ first_name: p.first_name ?? "", last_name: p.last_name ?? "", full_name: full }];
  }
  if (p.email) values.email_addresses = [p.email.toLowerCase()];
  if (p.job_title) values.job_title = p.job_title;
  if (companyId) values.company = [{ target_object: "companies", target_record_id: companyId }];
  return values;
}

export async function createPerson(p, companyId) {
  const res = await call("POST", "/objects/people/records", { data: { values: personValues(p, companyId) } });
  return res.data;
}

// PATCH: single values (title, company, name) are replaced; list values
// (emails, phones, events) are added to, so nothing already there is lost.
export async function updatePerson(recordId, p, companyId) {
  const res = await call("PATCH", `/objects/people/records/${recordId}`, {
    data: { values: personValues(p, companyId) },
  });
  return res.data;
}

// Phone numbers are written on their own: Attio rejects numbers it can't
// understand, and that shouldn't block the rest of the contact being saved.
export async function addPhone(recordId, phone) {
  const values = { phone_numbers: [{ original_phone_number: phone }] };
  if (!phone.trim().startsWith("+") && process.env.DEFAULT_PHONE_COUNTRY) {
    values.phone_numbers[0].country_code = process.env.DEFAULT_PHONE_COUNTRY;
  }
  await call("PATCH", `/objects/people/records/${recordId}`, { data: { values } });
}

export async function tagEvent(recordId, eventTitle) {
  await call("PATCH", `/objects/people/records/${recordId}`, {
    data: { values: { [EVENTS_ATTRIBUTE]: [eventTitle] } },
  });
}

// ---- companies ----

export async function findCompanyByDomain(domain) {
  const res = await call("POST", "/objects/companies/records/query", {
    filter: { domains: { domain: { $eq: domain } } },
    limit: 1,
  });
  return res.data[0] ?? null;
}

export async function findCompanyByName(name) {
  const res = await call("POST", "/objects/companies/records/query", {
    filter: { name: { $eq: name } },
    limit: 1,
  });
  return res.data[0] ?? null;
}

export async function createCompany(name, domain) {
  const values = { name };
  if (domain) values.domains = [domain];
  const res = await call("POST", "/objects/companies/records", { data: { values } });
  return res.data;
}

export async function getCompanyName(companyId) {
  if (!companyId) return null;
  const res = await call("GET", `/objects/companies/records/${companyId}`);
  return first(res.data, "name")?.value ?? null;
}

// ---- notes ----

export async function addNote(recordId, title, content) {
  await call("POST", "/notes", {
    data: { parent_object: "people", parent_record_id: recordId, title, format: "plaintext", content },
  });
}

// ---- events (options of the multi-select field) ----

export async function listEvents() {
  const res = await call("GET", `/objects/people/attributes/${EVENTS_ATTRIBUTE}/options`);
  return res.data.filter((o) => !o.is_archived).map((o) => o.title);
}

export async function createEvent(title) {
  await call("POST", `/objects/people/attributes/${EVENTS_ATTRIBUTE}/options`, { data: { title } });
}

// ---- setup helpers ----

export async function whoAmI() {
  return call("GET", "/self");
}

export async function eventsAttributeExists() {
  try {
    await call("GET", `/objects/people/attributes/${EVENTS_ATTRIBUTE}`);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

export async function createEventsAttribute() {
  await call("POST", "/objects/people/attributes", {
    data: {
      title: "Events",
      description: "Events where we met this person (filled in by the business card scanner)",
      api_slug: EVENTS_ATTRIBUTE,
      type: "select",
      is_required: false,
      is_unique: false,
      is_multiselect: true,
      config: {},
    },
  });
}
