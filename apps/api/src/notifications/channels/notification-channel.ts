/** One notification, resolved down to something a provider can actually send. */
export interface OutboundMessage {
  /** Where it goes: an email address for `email`, a mobile number otherwise. */
  to: string;
  subject: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Blueprint §56 lists four channels and V1 delivered one. The other three
 * were never a design problem -- `notification_rules.channels` already
 * says which to use and `notifications.channel` already records which was
 * tried -- they were an integration problem: nothing in the codebase knew
 * how to hand a message to an SMTP server or an SMS provider.
 *
 * This is that seam, and it is deliberately narrow. A channel takes a
 * resolved message and either returns or throws; it does not read the
 * database, decide who should be told, or retry. Everything about *when*
 * and *how often* belongs to `NotificationDispatcherService`, so a new
 * provider is one class implementing two members and nothing else.
 *
 * `configured` is the honest half of the interface. An installation with
 * no SMTP server is the normal case in development and a real one in
 * production, and a channel that cannot send must say so rather than
 * pretending success -- the dispatcher leaves those rows pending, visibly,
 * instead of marking them delivered.
 */
export interface NotificationChannel {
  readonly channel: 'email' | 'whatsapp' | 'sms';
  /** False when this deployment has not been given the credentials to send. */
  readonly configured: boolean;
  send(message: OutboundMessage): Promise<void>;
}
