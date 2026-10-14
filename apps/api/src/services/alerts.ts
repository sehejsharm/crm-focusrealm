import { db } from "../db/index.js";
import { env } from "../env.js";
import { emailConfigured, sendMail } from "./email.js";

const esc = (s: unknown) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/**
 * Email copy of an important in-app notification (handoffs, escalations,
 * assigned tasks, new teammates…). Only when SMTP is configured — without it
 * the in-app notification is enough, and nothing piles up in the outbox.
 */
export async function emailNotification(id: string) {
  if (!emailConfigured()) return;
  const n = await db.maybe(
    `select n.*, u.email, u.full_name, u.status from crm_notifications n join crm_users u on u.id = n.user_id where n.id = $1`,
    [id],
  );
  if (!n?.email || n.status !== "active") return;
  const link = `${env.appUrl}${n.link ?? "/"}`;
  await sendMail({
    to: [n.email],
    subject: n.title,
    text: `${n.title}\n\n${n.body ?? ""}\n\nOpen the CRM: ${link}`,
    html: `<!doctype html><html><body style="margin:0;background:#eef2f8;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#0b2a66,#1655c0 60%,#2f86f0);background-color:#1655c0;padding:18px 24px">
<img src="${env.appUrl}/brand/focus-realm-mark.png" width="32" height="32" alt="Focus Realm" style="display:inline-block;vertical-align:middle;border-radius:8px;background:#fff;padding:3px">
<span style="color:#fff;font-weight:700;font-size:15px;vertical-align:middle;margin-left:8px">Focus Realm CRM</span></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 6px;font-size:13px;color:#4b5a72">Hi ${esc(n.full_name.split(" ")[0])},</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#0a1426;line-height:1.4">${esc(n.title)}</p>
${n.body ? `<p style="margin:10px 0 0;font-size:14px;color:#4b5a72;line-height:1.6">${esc(n.body)}</p>` : ""}
<a href="${esc(link)}" style="display:inline-block;margin-top:20px;background:#1a6ae0;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:12px">Open in the CRM</a>
</td></tr></table></td></tr></table></body></html>`,
  });
}
