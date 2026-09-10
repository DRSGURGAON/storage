import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { NotificationChannel, OutboundMessage } from './notification-channel';

/**
 * Real SMTP, through `nodemailer`. Configured with a single connection
 * string -- `SMTP_URL=smtp://user:pass@host:587` or `smtps://` for
 * implicit TLS -- because one URL is what a deployment already has from
 * its provider, and splitting it into five environment variables only
 * creates five ways to get it half-right.
 *
 * The transport is built once and reused: nodemailer pools connections,
 * and a warehouse sending a burst of dispatch notifications should not
 * open an SMTP session per message.
 *
 * No queue of its own, no retry of its own. A failure here throws, the
 * dispatcher records it against the row with an attempt count, and the
 * next pass tries again -- so a provider outage recovers by itself and a
 * permanently bad address stops being retried, both without this class
 * knowing anything about either.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly channel = 'email' as const;
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: Transporter | null = null;

  get configured(): boolean {
    return Boolean(process.env.SMTP_URL);
  }

  private get from(): string {
    // A From: the receiving server will accept. Falls back to a
    // no-reply on the SMTP host rather than to something that looks
    // like a real person's address.
    return process.env.NOTIFICATION_FROM_EMAIL ?? 'no-reply@localhost';
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.configured) throw new Error('SMTP_URL is not set');
    this.transporter ??= createTransport(process.env.SMTP_URL as string);
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
    this.logger.debug(`email to ${message.to}: ${info.messageId ?? 'sent'}`);
  }
}
