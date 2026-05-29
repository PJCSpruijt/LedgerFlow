import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Outbound email via SMTP (nodemailer).
 *
 * When SMTP_HOST is not configured the service runs in "dev" mode: instead of
 * sending, it logs the message (including the action link) and reports
 * delivered=false so callers can surface the link to the admin in-app. This
 * keeps invitations/resets usable in local/dev without an SMTP provider.
 */

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return env.SMTP_HOST.trim().length > 0;
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface SendResult {
  delivered: boolean;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    logger.warn(
      { to: opts.to, subject: opts.subject, body: opts.text },
      "Email not configured (SMTP_HOST empty) — logging message instead of sending",
    );
    return { delivered: false };
  }
  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  logger.info({ to: opts.to, subject: opts.subject }, "Email sent");
  return { delivered: true };
}

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${title}</h2>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
<p style="font-size:12px;color:#64748b">LedgerFlow</p>
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p><a href="${href}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${label}</a></p>
<p style="font-size:12px;color:#64748b">Werkt de knop niet? Plak deze link in je browser:<br/>${href}</p>`;
}

export function sendInvitationEmail(opts: {
  to: string;
  firstName: string;
  link: string;
}): Promise<SendResult> {
  const html = shell(
    "Welkom bij LedgerFlow",
    `<p>Hoi ${opts.firstName},</p>
     <p>Er is een account voor je aangemaakt. Stel je wachtwoord in om aan de slag te gaan:</p>
     ${button(opts.link, "Wachtwoord instellen")}
     <p style="font-size:13px;color:#64748b">Deze link verloopt over 7 dagen.</p>`,
  );
  const text = `Hoi ${opts.firstName},\n\nEr is een LedgerFlow-account voor je aangemaakt. Stel je wachtwoord in via:\n${opts.link}\n\nDeze link verloopt over 7 dagen.`;
  return sendMail({ to: opts.to, subject: "Stel je LedgerFlow-wachtwoord in", html, text });
}

export function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  link: string;
}): Promise<SendResult> {
  const html = shell(
    "Wachtwoord opnieuw instellen",
    `<p>Hoi ${opts.firstName},</p>
     <p>Er is een wachtwoord-reset aangevraagd voor je LedgerFlow-account. Kies een nieuw wachtwoord:</p>
     ${button(opts.link, "Nieuw wachtwoord instellen")}
     <p style="font-size:13px;color:#64748b">Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren. De link verloopt over 1 uur.</p>`,
  );
  const text = `Hoi ${opts.firstName},\n\nKies een nieuw wachtwoord voor je LedgerFlow-account via:\n${opts.link}\n\nDeze link verloopt over 1 uur.`;
  return sendMail({ to: opts.to, subject: "Reset je LedgerFlow-wachtwoord", html, text });
}
