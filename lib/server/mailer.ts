import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config";

// Email is optional. With SMTP_* configured, invites and notifications are
// also emailed; without it everything still works in-app and the access
// manager copies invite links by hand.

let transport: Transporter | null = null;

export function emailEnabled(): boolean {
  return config.smtp !== null;
}

export interface Email {
  to: string;
  subject: string;
  text: string;
  /** `path` for a file on disk, `href` for a link the mailer downloads. */
  attachments?: { filename: string; path?: string; href?: string; contentType?: string }[];
}

/** Fire-and-forget: a mail outage must never fail the action that triggered it. */
export function sendEmail(email: Email): void {
  const smtp = config.smtp;
  if (!smtp) return;
  transport ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  transport
    .sendMail({ from: smtp.from, to: email.to, subject: email.subject, text: email.text, attachments: email.attachments })
    .catch((error: unknown) => console.error(`[mailer] failed to send "${email.subject}" to ${email.to}`, error));
}
