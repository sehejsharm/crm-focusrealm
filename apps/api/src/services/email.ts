import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";

/**
 * Outgoing email. With SMTP configured (e.g. the company SpaceMail mailbox:
 * mail.spacemail.com, port 465) mail is sent for real. Without it, each email
 * is written to ./.data/outbox as an .html file so it can be previewed — the
 * CRM never pretends an email went out when it didn't.
 */

export const emailConfigured = () => Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);

let transport: Transporter | null = null;

export interface Mail {
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(mail: Mail): Promise<{ delivered: boolean; via: "smtp" | "outbox"; id?: string; file?: string }> {
  const to = [...new Set(mail.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) throw new Error("No recipients");
  if (emailConfigured()) {
    transport ??= nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
    const info = await transport.sendMail({ from: env.mailFrom, to, subject: mail.subject, html: mail.html, text: mail.text });
    return { delivered: true, via: "smtp", id: info.messageId };
  }
  mkdirSync(env.outboxDir, { recursive: true });
  const file = path.join(env.outboxDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${mail.subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.html`);
  await writeFile(file, `<!-- To: ${to.join(", ")} | Subject: ${mail.subject} -->\n${mail.html}`);
  console.log(`[email] SMTP not configured — wrote "${mail.subject}" for ${to.join(", ")} to ${file}`);
  return { delivered: false, via: "outbox", file };
}
