import { config } from '../../shared/config/app.config';
import { logger } from '../../shared/logger';

export interface OutboundMail {
  to: string;
  subject: string;
  /** Plain-text body, for logs and the mock outbox. */
  text: string;
  /** The action link the message is built around, when it has one. */
  actionUrl?: string;
  sentAt: Date;
}

export interface Mailer {
  send(mail: Omit<OutboundMail, 'sentAt'>): Promise<void>;
}

/**
 * Mock transport.
 *
 * The delivery boundary is real — everything upstream of this class behaves
 * exactly as it would in production — but nothing leaves the process. Messages
 * are logged and kept in a small ring buffer so the simulation console can
 * show the link that would have been emailed.
 *
 * Swapping in real delivery means writing one more class against this
 * interface; no caller changes.
 */
export class MockMailer implements Mailer {
  private readonly outbox: OutboundMail[] = [];
  private readonly capacity = 50;

  async send(mail: Omit<OutboundMail, 'sentAt'>): Promise<void> {
    const entry: OutboundMail = { ...mail, sentAt: new Date() };

    this.outbox.unshift(entry);
    if (this.outbox.length > this.capacity) this.outbox.length = this.capacity;

    logger.info(
      { to: entry.to, subject: entry.subject, actionUrl: entry.actionUrl },
      'mock mail delivered to the in-memory outbox'
    );
  }

  /** Most recent messages first. Development only. */
  recent(limit = 20): OutboundMail[] {
    return this.outbox.slice(0, limit);
  }
}

class NullMailer implements Mailer {
  async send(): Promise<void> {
    // Production placeholder. Real delivery (SES, Postmark, SMTP) plugs in here.
    throw new Error(
      'No mail transport is configured. Implement a real Mailer before enabling email in production.'
    );
  }
}

export const mockMailer = new MockMailer();

export const mailer: Mailer = config.mockEmail ? mockMailer : new NullMailer();
