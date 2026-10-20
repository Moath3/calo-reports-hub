// Sends mail through Gmail SMTP using a Workspace App Password — no Workspace
// admin or domain-wide delegation needed, and still DKIM-aligned as calo.app
// because it goes through Google. Returns { sent, ... } and never throws, matching
// emailService.sendEmail's contract. SMTP_USER must have 2-Step Verification on and
// SMTP_PASS is its 16-char app password.
import nodemailer from 'nodemailer';

let transporter = null;

export function smtpConfigured() {
  return !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, '') },
  });
  return transporter;
}

export async function sendSmtp({ to, subject, html, from }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { sent: false, skipped: 'no recipient' };
  try {
    // From must be the authenticated mailbox (or its alias); SMTP_FROM only adds a display name.
    await getTransporter().sendMail({
      from: from || process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipients.join(', '),
      subject,
      html,
    });
    return { sent: true };
  } catch (e) {
    const hint = /invalid login|username and password not accepted|5\.7\.8/i.test(e.message || '')
      ? ' (check SMTP_USER + the 16-char app password, and that 2-Step Verification is on)'
      : '';
    return { sent: false, error: `SMTP: ${e.message}${hint}` };
  }
}
