# HR console → Sales CRM integration

When someone in the **sales department** joins in the Focus Realm HR console
(`sehejsharm/focusrealmhr`), they automatically get a **CRM login** — alongside
the Workspace login everyone already gets. Nobody outside sales gets one.

This uses the same contract as the HR console's Workspace connection, so the
HR side can reuse its pattern: one signed endpoint, idempotent events, a
temporary password shown once.

## Setup

| Where | Variable | Value |
|---|---|---|
| CRM | `HR_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| HR console | `FOCUS_REALM_CRM_URL` | The CRM's address, e.g. `https://crm.focusrealm.com` |
| HR console | `FOCUS_REALM_CRM_SECRET` | The same value as `HR_WEBHOOK_SECRET` on the CRM |

All server-side only — never `NEXT_PUBLIC_`/`VITE_` prefixed. With either HR
variable unset, the HR console's CRM calls are silent no-ops.

The client the HR console uses is [`docs/hr-console/crm-sync.server.ts`](hr-console/crm-sync.server.ts).
Copy it verbatim to `lib/onboarding/crm-sync.server.ts` in the HR console;
replace it wholesale when it changes here. The ready-made prompt for doing the
whole HR-side change with Claude Code is in [`HR_CONSOLE_PROMPT.md`](HR_CONSOLE_PROMPT.md).

## Endpoint

```
POST {CRM}/api/integrations/hr/events
Content-Type: application/json
X-FR-Timestamp: <unix seconds>
X-FR-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{ "id": "evt_…", "type": "employee.created", "createdAt": "…", "data": { … } }
```

- Requests older or newer than 5 minutes are rejected (replay protection).
- Each event `id` is applied **once**. A retried event returns the stored
  result — without the temporary password — so a retry can never create a
  second account or a second password.
- `4xx` = the request is wrong (don't retry). `5xx` = retry with the same id.

### `data`

| Field | Notes |
|---|---|
| `externalId` | **Required.** The HR console's candidate id. Links the two systems. |
| `fullName`, `email`, `phone`, `title`, `department`, `startDate` | As in the Workspace contract. `department` is the HR role label (e.g. "Business Development"); `title` the role title. |
| `employeeCode` | Their Workspace employee ID (e.g. `FR-0042`). The CRM uses it as the CRM login so everyone has one ID. If missing or taken, the CRM issues its own (`FRS-0001`…). |
| `crmAccess` | Optional founder override: `true` forces a login, `false` refuses one. Otherwise the CRM decides. |
| `crmRole` | Optional: `sales_rep` / `sales_head` / `legion`. Otherwise worked out from the title. |
| `reason` | For `employee.offboarded`. |

### Who gets a login

The CRM matches `department`, `title` and `role` against its list of sales
departments (founders edit it in **Settings → HR console**; default: *sales,
business development, business-development, bd, inside sales*). Titles
containing *head, lead, manager, vp, director* become **sales heads**;
everyone else from sales becomes a **sales team member**. Anyone else gets
`{ "ok": true, "skipped": true, "reason": "not_in_crm_departments" }` and no
account. The HR client also filters on its side, so non-sales people's
details never leave the HR console.

### Events

| Event | What the CRM does |
|---|---|
| `employee.created` | Creates the CRM login (if in sales). Returns credentials the first time. |
| `employee.updated` | Updates name/email/phone/title. Moved **into** sales → login created (credentials returned). Moved **out of** sales → login switched off, signed out everywhere, history kept. |
| `employee.offboarded` | Locked out and signed out on every device; history kept. Their open prospects are flagged to founders and sales heads for reassignment (never reassigned automatically). |
| `employee.restored` | Can sign in again. |
| `employee.credentials_reset` | New temporary password (returned once); signed out everywhere. |

### Response

Mirrors the Workspace so the HR console can record it the same way:

```json
{
  "ok": true,
  "user": { "employeeCode": "FR-0042", "email": "riya@focusrealm.com", "loginUrl": "https://crm…/login", "crmRole": "sales_rep" },
  "credentials": { "loginId": "FR-0042", "email": "riya@focusrealm.com", "temporaryPassword": "Comet-Harbor-4821" }
}
```

`credentials` is present only when a password was just generated. Treat it
exactly like the Workspace one: seal it at rest, show it once, then destroy it.
The person signs in at `loginUrl` with their employee ID and must choose their
own password at first sign-in.

## What the CRM receives — and doesn't

Name, role/title, department, start date, email and (where consent covers it)
phone. Never the Aadhaar number or copy, address, parent's name, agreement or
assessment results.
