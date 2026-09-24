import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { UserRepository } from '../../infrastructure/database/mongodb/repositories/user.repository';
import { VerificationService } from './verification.service';
import { tokenStore } from '../../infrastructure/cache/token.store';
import { config } from '../../shared/config/app.config';
import { ConflictError, UnauthorizedError, ForbiddenError } from '../../shared/errors';
import { assertStrongPassword } from '../../shared/utils/password';

// Re-exported so existing imports keep working.
export { assertStrongPassword };

export interface TokenPayload {
  sub: string;
  email?: string;
  roles: string[];
  /** Not a token claim - filled in from the database on verification. */
  emailVerified?: boolean;
  /** User tokenVersion at issue time - lets a password change kill live tokens. */
  ver: number;
  typ: 'access' | 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
}

function ttlSeconds(expiresIn: string): number {
  const match = /^(\d+)([smhd])?$/.exec(expiresIn.trim());
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] || 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}

export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private verification: VerificationService = new VerificationService()
  ) {}

  private sign(payload: Omit<TokenPayload, 'iat' | 'exp'>, secret: string, expiresIn: string): string {
    const options = {
      expiresIn,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    } as SignOptions;
    return jwt.sign(payload, secret, options);
  }

  private verify(token: string, secret: string, expectedType: 'access' | 'refresh'): TokenPayload {
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, secret, {
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
      }) as TokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    // Without this check an access token could be replayed as a refresh token
    // (and vice versa), turning a 15-minute credential into a 7-day one.
    if (payload.typ !== expectedType) {
      throw new UnauthorizedError(`Expected a ${expectedType} token`);
    }
    return payload;
  }

  issueAccessToken(sub: string, email: string | undefined, roles: string[], ver: number): string {
    return this.sign(
      { sub, email, roles, ver, typ: 'access', jti: crypto.randomUUID() },
      config.jwtSecret,
      config.jwtExpiresIn
    );
  }

  private async issueRefreshToken(sub: string, roles: string[], ver: number): Promise<string> {
    const jti = crypto.randomUUID();
    const token = this.sign(
      { sub, roles, ver, typ: 'refresh', jti },
      config.jwtRefreshSecret,
      config.refreshTokenExpiresIn
    );
    await tokenStore.registerRefreshToken(sub, jti, ttlSeconds(config.refreshTokenExpiresIn));
    return token;
  }

  async register(email: string, password: string, name?: string, phone?: string) {
    assertStrongPassword(password);

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.userRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    try {
      const user = await this.userRepository.create({
        email: normalizedEmail,
        passwordHash,
        name,
        phone,
        roles: ['USER'],
        status: 'ACTIVE',
        emailVerified: false,
      });

      const issued = await this.verification.issueEmailVerification(user);

      return {
        userId: String(user._id),
        email: user.email,
        status: user.status,
        emailVerified: user.emailVerified,
        // The link is returned only while mail is mocked. Handing a
        // verification link to whoever called /auth/register would otherwise
        // let anyone verify an address they do not control.
        verification: config.mockEmail
          ? { link: issued.link, expiresAt: issued.expiresAt, delivery: 'mock' as const }
          : undefined,
      };
    } catch (err: unknown) {
      // Unique index is the real guard against the check-then-insert race.
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError('Email already registered');
      }
      throw err;
    }
  }

  async login(email: string, password: string) {
    const user = await this.userRepository.findByEmailWithSecret(email);

    if (!user) {
      // Hash a dummy value so a missing user takes the same time as a wrong
      // password - otherwise response timing enumerates valid emails.
      await bcrypt.compare(password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      throw new UnauthorizedError('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenError('Account temporarily locked after repeated failed logins');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError(`Account is ${user.status}`);
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      await this.userRepository.recordFailedLogin(
        String(user._id),
        config.limits.maxFailedLogins,
        config.limits.loginLockSeconds
      );
      throw new UnauthorizedError('Invalid credentials');
    }

    await this.userRepository.clearLoginFailures(String(user._id));

    const sub = String(user._id);
    const accessToken = this.issueAccessToken(sub, user.email, user.roles, user.tokenVersion);
    const refreshToken = await this.issueRefreshToken(sub, user.roles, user.tokenVersion);

    return {
      accessToken,
      refreshToken,
      expiresIn: ttlSeconds(config.jwtExpiresIn),
      user: { id: sub, email: user.email, name: user.name, roles: user.roles, status: user.status },
    };
  }

  /** Verifies an access token for the auth middleware. */
  async verifyAccessToken(token: string): Promise<TokenPayload> {
    const payload = this.verify(token, config.jwtSecret, 'access');

    if (await tokenStore.isAccessTokenDenied(payload.jti)) {
      throw new UnauthorizedError('Token has been revoked');
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User no longer exists');
    if (user.status !== 'ACTIVE') throw new ForbiddenError(`Account is ${user.status}`);
    if (user.tokenVersion !== payload.ver) throw new UnauthorizedError('Token has been invalidated');

    // Roles come from the database, not the token, so a role revoked a minute
    // ago cannot be used for the remaining life of an issued token. The same
    // applies to verification state - a token minted before verification must
    // not keep reporting the user as unverified.
    return { ...payload, roles: user.roles, email: user.email, emailVerified: user.emailVerified };
  }

  /**
   * Rotates a refresh token: the presented token is consumed atomically and a
   * new pair is issued. Re-presenting a consumed token means the token leaked,
   * so every session for that user is killed.
   */
  async refresh(refreshToken: string) {
    const payload = this.verify(refreshToken, config.jwtRefreshSecret, 'refresh');

    const consumed = await tokenStore.consumeRefreshToken(payload.sub, payload.jti);
    if (!consumed) {
      await tokenStore.revokeAllRefreshTokens(payload.sub);
      await this.userRepository.bumpTokenVersion(payload.sub);
      throw new UnauthorizedError('Refresh token reuse detected - all sessions revoked');
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User no longer exists');
    if (user.status !== 'ACTIVE') throw new ForbiddenError(`Account is ${user.status}`);
    if (user.tokenVersion !== payload.ver) throw new UnauthorizedError('Token has been invalidated');

    const sub = String(user._id);
    return {
      accessToken: this.issueAccessToken(sub, user.email, user.roles, user.tokenVersion),
      refreshToken: await this.issueRefreshToken(sub, user.roles, user.tokenVersion),
      expiresIn: ttlSeconds(config.jwtExpiresIn),
    };
  }

  /** Revokes the presented access token and, when supplied, the refresh token. */
  async logout(accessPayload: TokenPayload, refreshToken?: string, allDevices = false) {
    const remaining = accessPayload.exp ? accessPayload.exp - Math.floor(Date.now() / 1000) : 0;
    await tokenStore.denyAccessToken(accessPayload.jti, remaining);

    if (refreshToken) {
      try {
        const payload = this.verify(refreshToken, config.jwtRefreshSecret, 'refresh');
        if (payload.sub === accessPayload.sub) {
          await tokenStore.consumeRefreshToken(payload.sub, payload.jti);
        }
      } catch {
        // An unusable refresh token does not make logout fail.
      }
    }

    if (allDevices) {
      await tokenStore.revokeAllRefreshTokens(accessPayload.sub);
      await this.userRepository.bumpTokenVersion(accessPayload.sub);
    }

    return { revoked: true, allDevices };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    assertStrongPassword(newPassword);

    const user = await this.userRepository.findById(userId);
    if (!user) throw new UnauthorizedError('User no longer exists');

    const withSecret = await this.userRepository.findByEmailWithSecret(user.email);
    if (!withSecret) throw new UnauthorizedError('User no longer exists');

    const match = await bcrypt.compare(currentPassword, withSecret.passwordHash);
    if (!match) throw new UnauthorizedError('Current password is incorrect');

    withSecret.passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    withSecret.tokenVersion += 1; // every existing session dies with the old password
    await withSecret.save();

    await tokenStore.revokeAllRefreshTokens(userId);
    return { changed: true };
  }

  async verifyEmail(token: unknown) {
    return this.verification.verifyEmail(token);
  }

  /**
   * Always reports success. A different response for an unknown address would
   * turn this into an account-existence oracle.
   */
  async resendEmailVerification(email: unknown) {
    const issued = await this.verification.resendEmailVerification(email);

    return {
      sent: true,
      verification:
        config.mockEmail && issued
          ? { link: issued.link, expiresAt: issued.expiresAt, delivery: 'mock' as const }
          : undefined,
    };
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UnauthorizedError('User no longer exists');
    return user.toJSON();
  }
}
