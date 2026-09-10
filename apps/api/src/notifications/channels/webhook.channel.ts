import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, OutboundMessage } from './notification-channel';

/**
 * WhatsApp and SMS, over whatever HTTP endpoint the deployment points
 * them at: `WHATSAPP_WEBHOOK_URL` / `SMS_WEBHOOK_URL`, with an optional
 * `*_WEBHOOK_TOKEN` sent as a bearer.
 *
 * Provider-agnostic on purpose, and the reason is `DECISIONS.md` §13's:
 * no provider has been chosen. Every candidate in this market -- Twilio,
 * Gupshup, MSG91, WhatsApp Cloud API -- takes an HTTPS POST with a JSON
 * body naming a destination and a text, and differs only in the field
 * names and the auth header. Hard-coding one of those shapes now would be
 * guessing; posting a documented, stable envelope means a deployment can
 * point this at the provider's endpoint directly when the shapes happen to
 * line up, and at ten lines of glue when they do not.
 *
 * What this is *not* is a stub: it opens the connection, sends the
 * request, and fails on a non-2xx with the provider's own status and body
 * attached, which is what the dispatcher records against the row.
 */
@Injectable()
export class WebhookChannel implements NotificationChannel {
  private readonly logger = new Logger(WebhookChannel.name);

  constructor(readonly channel: 'whatsapp' | 'sms') {}

  private get url(): string | undefined {
    return process.env[`${this.channel.toUpperCase()}_WEBHOOK_URL`];
  }

  private get token(): string | undefined {
    return process.env[`${this.channel.toUpperCase()}_WEBHOOK_TOKEN`];
  }

  get configured(): boolean {
    return Boolean(this.url);
  }

  async send(message: OutboundMessage): Promise<void> {
    const url = this.url;
    if (!url) throw new Error(`${this.channel.toUpperCase()}_WEBHOOK_URL is not set`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        channel: this.channel,
        to: message.to,
        subject: message.subject,
        text: message.body,
        severity: message.severity,
      }),
    });
    if (!response.ok) {
      // The provider's own words, truncated: whatever it said is the most
      // useful thing an operator can read off `notifications.last_error`.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`${this.channel} provider returned ${response.status}: ${detail}`);
    }
    this.logger.debug(`${this.channel} to ${message.to}: ${response.status}`);
  }
}

@Injectable()
export class WhatsappChannel extends WebhookChannel {
  constructor() {
    super('whatsapp');
  }
}

@Injectable()
export class SmsChannel extends WebhookChannel {
  constructor() {
    super('sms');
  }
}
