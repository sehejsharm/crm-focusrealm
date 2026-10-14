import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { HttpError } from "./http.js";

export type Role = "founder" | "sales_head" | "sales_rep" | "legion";

export interface AuthUser {
  id: string;
  employee_code: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  title: string | null;
  department: string | null;
  status: "active" | "inactive" | "offboarded";
  must_change_password: boolean;
  token_version: number;
  avatar_hue: number;
  source: string;
  daily_call_target: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = "fr_crm";
const SESSION_HOURS = 12;

export const USER_COLUMNS = `id, employee_code, email, full_name, phone, role, title, department, status,
  must_change_password, token_version, avatar_hue, source, daily_call_target`;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}

export async function verifyPassword(pw: string, hash: string | null) {
  if (!hash) return false;
  return bcrypt.compare(pw, hash);
}

/** Readable temporary password, e.g. "Kite-Harbor-4821". Shown once, then changed. */
export function temporaryPassword(): string {
  const words = [
    "Orbit", "Harbor", "Falcon", "Cedar", "Comet", "Delta", "Ember", "Glacier", "Horizon", "Indigo",
    "Juniper", "Kite", "Lumen", "Meteor", "Nimbus", "Onyx", "Prism", "Quartz", "Ripple", "Summit",
    "Tidal", "Vertex", "Willow", "Zenith", "Aurora", "Beacon", "Cobalt", "Drift", "Echo", "Flare",
  ];
  const a = randomInt(words.length);
  const b = (a + 1 + randomInt(words.length - 1)) % words.length; // never the same word twice
  return `${words[a]}-${words[b]}-${randomInt(1000, 10000)}`;
}

export function signSession(user: Pick<AuthUser, "id" | "token_version">) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, env.jwtSecret, {
    expiresIn: `${SESSION_HOURS}h`,
    issuer: "focus-realm-crm",
  });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

/**
 * Loads the signed-in person on every request, from the database, so that an
 * offboarding or password reset (which bumps token_version) locks them out
 * immediately on every device.
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] ?? bearer(req);
  if (!token) return next();
  try {
    const claims = jwt.verify(token, env.jwtSecret, { issuer: "focus-realm-crm" }) as { sub: string; tv: number };
    const user = await db.maybe<AuthUser>(`select ${USER_COLUMNS} from crm_users where id = $1`, [claims.sub]);
    if (user && user.status === "active" && user.token_version === claims.tv) {
      req.user = user;
      // Cheap presence signal for "who's online" and inactivity flags.
      db.query("update crm_users set last_active_at = now() where id = $1 and (last_active_at is null or last_active_at < now() - interval '2 minutes')", [user.id]).catch(() => {});
    }
  } catch {
    // Expired or tampered token: treat as signed out.
  }
  next();
}

function bearer(req: Request) {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in"));
  if (req.user.must_change_password && !req.path.startsWith("/auth/")) {
    return next(new HttpError(403, "Choose a new password to continue"));
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Please sign in"));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "Your role can't do that"));
    next();
  };
}

export const isManager = (u?: AuthUser) => u?.role === "founder" || u?.role === "sales_head";
export const isFounder = (u?: AuthUser) => u?.role === "founder";

/** Which portal each role lands in. */
export function portalOf(role: Role): "sales" | "legion" | "founder" {
  if (role === "founder") return "founder";
  if (role === "legion") return "legion";
  return "sales";
}
