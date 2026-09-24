import crypto from 'crypto';
import mongoose from 'mongoose';
import { VerificationTokenModel } from '../../infrastructure/database/mongodb/models/verificationToken.model';
import { UserModel, IUser } from '../../infrastructure/database/mongodb/models/user.model';
import { mailer } from '../../infrastructure/email/mailer';
import { config } from '../../shared/config/app.config';
import { ValidationError, NotFoundError } from '../../shared/errors';

export interface IssuedLink {
  /** The raw link. Returned to callers only while mail is mocked. */
  link: string;
  expiresAt: Date;
}

/** Tokens are compared by hash, so the raw value exists only in the link. */
function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class VerificationService {
  /**
   * Issues a single-use email verification link and hands it to the mailer.
   * Any previously issued, unused token for the user is consumed first, so a
   * resend invalidates the older link instead of leaving several live.
   */
  async issueEmailVerification(user: Pick<IUser, '_id' | 'email'>): Promise<IssuedLink> {
    const userId = user._id;

    await VerificationTokenModel.updateMany(
      { userId, purpose: 'EMAIL_VERIFICATION', usedAt: null },
      { $set: { usedAt: new Date() } }
    ).exec();

    const raw = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.emailVerification.tokenTtlSeconds * 1000);

    await VerificationTokenModel.create({
      userId,
      tokenHash: hash(raw),
      purpose: 'EMAIL_VERIFICATION',
      expiresAt,
    });

    const link = `${config.appUrl}/verify-email?token=${raw}`;

    await mailer.send({
      to: user.email,
      subject: 'Confirm your email address',
      text:
        `Confirm your email address to finish setting up your Ledger account.\n\n${link}\n\n` +
        `This link expires in ${Math.round(config.emailVerification.tokenTtlSeconds / 3600)} hours ` +
        `and can be used once. If you did not create an account, ignore this message.`,
      actionUrl: link,
    });

    return { link, expiresAt };
  }

  /** Consumes a token and marks the owning user verified. */
  async verifyEmail(token: unknown): Promise<{ verified: true; email: string }> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
      throw new ValidationError('A verification token is required');
    }

    // Single atomic claim: two simultaneous clicks cannot both consume it.
    const record = await VerificationTokenModel.findOneAndUpdate(
      {
        tokenHash: hash(token),
        purpose: 'EMAIL_VERIFICATION',
        usedAt: null,
        // mongoose.trusted() marks this operator as ours. The global
        // sanitizeFilter, which defends against injected operators, would
        // otherwise rewrite it into an equality match against the object.
        expiresAt: mongoose.trusted({ $gt: new Date() }),
      },
      { $set: { usedAt: new Date() } },
      { new: true }
    ).exec();

    if (!record) {
      // One message for expired, already used and never existed. Telling them
      // apart would let someone probe which tokens are real.
      throw new ValidationError('This verification link is invalid or has expired');
    }

    const user = await UserModel.findByIdAndUpdate(
      record.userId,
      { $set: { emailVerified: true } },
      { new: true }
    ).exec();

    if (!user) throw new NotFoundError('User not found');

    return { verified: true, email: user.email };
  }

  /**
   * Re-sends the link. The response never reveals whether the address is
   * registered, so this cannot be used to enumerate accounts — the returned
   * link is simply absent when there is nothing to send.
   */
  async resendEmailVerification(email: unknown): Promise<IssuedLink | null> {
    if (typeof email !== 'string') throw new ValidationError('email must be a string');

    const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
    if (!user || user.emailVerified || user.status !== 'ACTIVE') return null;

    return this.issueEmailVerification(user);
  }
}
