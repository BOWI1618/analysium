/**
 * Outgoing mail over plain SMTP.
 *
 * SMTP rather than a vendor SDK on purpose: every provider speaks it, so the
 * choice between Yandex, Brevo, Resend or a company mailbox is four
 * environment variables and no code at all. Swapping providers — or moving
 * off one that stops being reachable — costs nothing.
 *
 * With MAIL_ENABLED=false nothing is sent and the message is written to the log
 * instead. That is what development uses, and it is also the escape hatch if
 * SMTP breaks in production: sign-in stops depending on mail delivery rather
 * than locking the whole team out.
 */
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { log } from './logger';

let transporter: Transporter | null = null;

function transport(): Transporter {
  if (!transporter) {
    transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 is implicit TLS; 587 and 25 start plain and upgrade.
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends a message, or logs it when mail is switched off.
 *
 * Never throws: a registration must not fail because the mail server is
 * momentarily unreachable. The caller gets `false` and can tell the person to
 * ask for another message.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!env.MAIL_ENABLED) {
    log.info({ to: mail.to, subject: mail.subject, body: mail.text }, 'mail disabled — not sent');
    return false;
  }

  try {
    await transport().sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    log.info({ to: mail.to, subject: mail.subject }, 'mail sent');
    return true;
  } catch (error) {
    log.error({ err: error, to: mail.to, subject: mail.subject }, 'mail failed');
    return false;
  }
}

/** Verifies the SMTP settings without sending anything. Used by the health check. */
export async function verifyMailTransport(): Promise<boolean> {
  if (!env.MAIL_ENABLED) return true;
  try {
    await transport().verify();
    return true;
  } catch (error) {
    log.error({ err: error }, 'SMTP verification failed');
    return false;
  }
}
