import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { env } from "../env.js";
import {
  clearSessionCookie, hashPassword, portalOf, setSessionCookie, signSession, USER_COLUMNS, verifyPassword, type AuthUser,
} from "../lib/auth.js";
import { badRequest, HttpError, parse } from "../lib/http.js";
import { audit } from "../lib/record.js";
import { aiConfigured } from "../services/analysis.js";
import { emailConfigured } from "../services/email.js";
import { getSetting } from "../services/settings.js";
import { activeProvider } from "../services/telephony/index.js";
import { transcriptionConfigured } from "../services/transcription.js";

export const authRouter = Router();

// Simple in-memory brute-force guard: 8 failed attempts per login ID per 15 minutes.
const failures = new Map<string, { n: number; until: number }>();

function present(u: AuthUser) {
  return { ...u, portal: portalOf(u.role), token_version: undefined };
}

authRouter.post("/login", async (req, res) => {
  const body = parse(z.object({ login: z.string().min(1).max(200), password: z.string().min(1).max(200) }), req.body);
  const key = body.login.trim().toLowerCase();
  const f = failures.get(key);
  if (f && f.n >= 8 && f.until > Date.now()) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");

  // Employee ID is the login (as in the HR console). Email also works when it's unique.
  const users = await db.many<AuthUser & { password_hash: string | null }>(
    `select ${USER_COLUMNS}, password_hash from crm_users where upper(employee_code) = upper($1) or lower(email) = lower($1)`,
    [body.login.trim()],
  );
  const user = users.length === 1 ? users[0] : users.find((u) => u.employee_code.toUpperCase() === body.login.trim().toUpperCase());
  const ok = user && (await verifyPassword(body.password, user.password_hash));
  if (!user || !ok) {
    failures.set(key, { n: (f?.until ?? 0) > Date.now() ? (f!.n + 1) : 1, until: Date.now() + 15 * 60_000 });
    throw new HttpError(401, "That employee ID or password isn't right");
  }
  if (user.status !== "active") throw new HttpError(403, user.status === "offboarded" ? "This account has been offboarded" : "This account is inactive — talk to your sales head");
  failures.delete(key);
  await db.query(`update crm_users set last_login_at = now(), last_active_at = now() where id = $1`, [user.id]);
  setSessionCookie(res, signSession(user));
  await audit({ id: user.id, label: user.full_name }, "auth.login", "user", user.id, { ip: req.ip });
  const { password_hash: _ph, ...safe } = user;
  res.json({ user: present(safe as AuthUser) });
});

authRouter.post("/logout", async (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) throw new HttpError(401, "Please sign in");
  res.json({ user: present(req.user) });
});

authRouter.post("/change-password", async (req, res) => {
  if (!req.user) throw new HttpError(401, "Please sign in");
  const body = parse(
    z.object({ current: z.string().min(1), next: z.string().min(10, "Use at least 10 characters").max(200) }),
    req.body,
  );
  const row = await db.one(`select password_hash from crm_users where id = $1`, [req.user.id]);
  if (!(await verifyPassword(body.current, row.password_hash))) throw badRequest("Your current password isn't right");
  if (body.current === body.next) throw badRequest("Pick a password you haven't used here");
  const u = await db.one<AuthUser>(
    `update crm_users set password_hash = $2, must_change_password = false, token_version = token_version + 1, updated_at = now()
     where id = $1 returning ${USER_COLUMNS}`,
    [req.user.id, await hashPassword(body.next)],
  );
  setSessionCookie(res, signSession(u));
  await audit({ id: u.id, label: u.full_name }, "auth.password_changed", "user", u.id);
  res.json({ user: present(u) });
});

authRouter.patch("/profile", async (req, res) => {
  if (!req.user) throw new HttpError(401, "Please sign in");
  const body = parse(z.object({ phone: z.string().max(30).optional(), email: z.string().email().optional() }), req.body);
  const u = await db.one<AuthUser>(
    `update crm_users set phone = coalesce($2, phone), email = coalesce($3, email), updated_at = now() where id = $1 returning ${USER_COLUMNS}`,
    [req.user.id, body.phone ?? null, body.email ?? null],
  );
  res.json({ user: present(u) });
});

/** Public: what the sign-in page and the app shell need to know. */
authRouter.get("/meta", async (_req, res) => {
  const t = await getSetting("telephony");
  const demo = env.demoLogins
    ? await db.many(
        `select employee_code, full_name, role, title, avatar_hue from crm_users where source = 'seed' and status = 'active'
         order by case role when 'founder' then 0 when 'sales_head' then 1 when 'legion' then 2 else 3 end, full_name limit 12`,
      )
    : [];
  res.json({
    demoLogins: demo,
    demoPassword: env.demoLogins && demo.length ? "focus-realm-demo" : null,
    telephonyMode: t.mode,
    bridgeReady: Boolean(activeProvider()),
    aiConfigured: aiConfigured(),
    transcriptionConfigured: transcriptionConfigured(),
    emailConfigured: emailConfigured(),
    storage: env.storageDriver,
    database: env.databaseUrl ? "postgres" : "embedded",
  });
});
