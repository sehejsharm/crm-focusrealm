import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

/**
 * Prospects added by hand can start at any stage (warm introductions go
 * straight to a Legion meeting), Legion Meet 3 exists, and none of this
 * touches prospects that were already there.
 */

let base = "";
let cookie = "";
let close: () => Promise<void>;

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json: json as any };
}

before(async () => {
  Object.assign(process.env, {
    PGLITE_DIR: mkdtempSync(path.join(tmpdir(), "crm-stages-")),
    SEED_DEMO: "false",
    SETUP_CODE: "setup-code-for-tests",
    IN_PROCESS_SCHEDULER: "false",
    DATABASE_URL: "",
  });
  const { createApp, ensureReady } = await import("../app.js");
  await ensureReady();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "setup-code-for-tests", employee_code: "FR-0001", full_name: "Test Founder", password: "a-long-password-1" }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  cookie = (r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
  close = async () => {
    server.close();
    const { db } = await import("../db/index.js");
    await db.close();
  };
});

after(async () => close?.());

test("a founder adds a connection straight into Legion Meet 1, then moves it to Meet 3", async () => {
  const existing = await call("POST", "/api/contacts", { full_name: "Existing Lead", phone: "9810000001", company: "Old Co" });
  assert.equal(existing.status, 200, JSON.stringify(existing.json));
  const before = (await call("GET", `/api/contacts/${existing.json.contact.id}`)).json.contact;

  const warm = await call("POST", "/api/contacts", { full_name: "Warm Intro", phone: "9810000002", company: "New Co", stage: "legion_meet_1" });
  assert.equal(warm.status, 200, JSON.stringify(warm.json));
  assert.equal(warm.json.contact.stage, "legion_meet_1");
  assert.equal(warm.json.contact.status, "handed_off");

  const id = warm.json.contact.id;
  const m3 = await call("POST", `/api/contacts/${id}/stage`, { stage: "legion_meet_3" });
  assert.equal(m3.status, 200, JSON.stringify(m3.json));
  assert.equal(m3.json.contact.stage, "legion_meet_3");

  const meeting = await call("POST", "/api/meetings", { contactId: id, stage: "legion_meet_3", scheduledAt: new Date(Date.now() + 86400_000).toISOString() });
  assert.equal(meeting.status, 200, JSON.stringify(meeting.json));

  const qualified = await call("POST", "/api/contacts", { full_name: "Qualified Intro", phone: "9810000003", stage: "qualified" });
  assert.equal(qualified.status, 200, JSON.stringify(qualified.json));
  assert.equal(qualified.json.contact.stage, "qualified");

  // A prospect added by hand at the first stage can be moved by a founder too.
  const moved = await call("POST", `/api/contacts/${existing.json.contact.id}/stage`, { stage: "legion_meet_2" });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));

  const after = (await call("GET", `/api/contacts/${existing.json.contact.id}`)).json.contact;
  assert.equal(after.full_name, before.full_name);
  assert.equal(after.phone, before.phone);
  assert.equal(after.company_name, before.company_name);
});
