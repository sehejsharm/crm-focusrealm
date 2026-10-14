import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

/**
 * Drives the real HR-console client (docs/hr-console/crm-sync.server.ts)
 * against a real CRM app on an embedded Postgres: sales hires get a login,
 * everyone else is never sent, retries are idempotent, offboarding locks out.
 */

const SECRET = "test-hr-secret-0123456789abcdef";
let base = "";
let close: () => Promise<void>;

before(async () => {
  Object.assign(process.env, {
    PGLITE_DIR: mkdtempSync(path.join(tmpdir(), "crm-test-")),
    SEED_DEMO: "false",
    HR_WEBHOOK_SECRET: SECRET,
    IN_PROCESS_SCHEDULER: "false",
    DATABASE_URL: "",
  });
  const { createApp, ensureReady } = await import("../app.js");
  await ensureReady();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.FOCUS_REALM_CRM_URL = base;
  process.env.FOCUS_REALM_CRM_SECRET = SECRET;
  close = async () => {
    server.close();
    const { db } = await import("../db/index.js");
    await db.close();
  };
});

after(async () => close?.());

async function login(loginId: string, password: string) {
  return fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: loginId, password }) });
}

const bd = {
  id: "cand_bd_1",
  invitedName: "Riya Kapoor",
  invitedEmail: "riya@example.com",
  startDate: "2026-10-20",
  details: { fullName: "Riya Kapoor", phone: "9876501234" },
  role: { id: "business-development", label: "Business Development", roleTitle: "Business Development Intern" },
  workspaceLoginId: "FR-0042",
};

test("a sales hire gets a CRM login with the Workspace employee ID", async () => {
  const client = await import("../../../../docs/hr-console/crm-sync.server.js");
  const creds = await client.provisionCrmAccount(bd);
  assert.ok(creds, "credentials returned");
  assert.equal(creds!.loginId, "FR-0042");
  assert.equal(creds!.crmRole, "sales_rep");
  assert.ok(creds!.temporaryPassword && creds!.temporaryPassword.length >= 10);

  const res = await login("FR-0042", creds!.temporaryPassword!);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { must_change_password: boolean; portal: string } };
  assert.equal(body.user.must_change_password, true);
  assert.equal(body.user.portal, "sales");
});

test("calling again never creates a second account or password", async () => {
  const client = await import("../../../../docs/hr-console/crm-sync.server.js");
  const again = await client.provisionCrmAccount(bd);
  assert.ok(again);
  assert.equal(again!.loginId, "FR-0042");
  assert.equal(again!.temporaryPassword, undefined);
});

test("non-sales people are never sent to the CRM", async () => {
  const client = await import("../../../../docs/hr-console/crm-sync.server.js");
  const r = await client.provisionCrmAccount({ ...bd, id: "cand_mkt", role: { id: "marketing", label: "Marketing", roleTitle: "Marketing Intern" } });
  assert.equal(r, null);
  assert.equal(client.isSalesRole({ role: { label: "Founder's Office", roleTitle: "Founder's Office Intern" } }), false);
  assert.equal(client.isSalesRole({ role: { label: "Sales", roleTitle: "Sales Team Lead" } }), true);
  assert.equal(client.isSalesRole({ role: { label: "Founder's Office", roleTitle: "x" }, crmAccess: true }), true);
});

test("sales leads become sales heads", async () => {
  const client = await import("../../../../docs/hr-console/crm-sync.server.js");
  const r = await client.provisionCrmAccount({ ...bd, id: "cand_lead", workspaceLoginId: "FR-0043", role: { label: "Sales", roleTitle: "Sales Team Lead" } });
  assert.equal(r?.crmRole, "sales_head");
});

test("offboarding locks them out; restoring lets them back in", async () => {
  const client = await import("../../../../docs/hr-console/crm-sync.server.js");
  const reset = await client.resetCrmPassword(bd.id);
  assert.ok(reset?.temporaryPassword);
  await client.offboardCrmAccount(bd.id, "Internship ended");
  assert.equal((await login("FR-0042", reset!.temporaryPassword!)).status, 403);
  await client.restoreCrmAccount(bd.id);
  assert.equal((await login("FR-0042", reset!.temporaryPassword!)).status, 200);
});

test("unsigned or tampered requests are rejected", async () => {
  const res = await fetch(`${base}/api/integrations/hr/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-FR-Timestamp": String(Math.floor(Date.now() / 1000)), "X-FR-Signature": "v1=00" },
    body: JSON.stringify({ id: "x", type: "employee.created", data: { externalId: "y" } }),
  });
  assert.equal(res.status, 401);
});
