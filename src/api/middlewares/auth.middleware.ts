import { Request, Response, NextFunction } from 'express';
import { authService } from '../../shared/container';
import { TokenPayload } from '../../application/services/auth.service';
import { Actor } from '../../application/services/account.service';
import { UnauthorizedError, ForbiddenError } from '../../shared/errors';

export interface AuthRequest extends Request {
  user?: Actor & { email?: string };
  token?: TokenPayload;
}

/**
 * Verifies the bearer access token and, optionally, that the caller holds all
 * of the given roles. Roles are re-read from the database on every request, so
 * a revoked role takes effect immediately instead of at token expiry.
 */
export function authMiddleware(requiredRoles: string[] = []) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization');
      if (!header || !header.startsWith('Bearer ')) {
        throw new UnauthorizedError('Missing bearer token');
      }

      const token = header.slice('Bearer '.length).trim();
      if (!token) throw new UnauthorizedError('Missing bearer token');

      const payload = await authService.verifyAccessToken(token);

      req.token = payload;
      req.user = { id: payload.sub, roles: payload.roles ?? [], email: payload.email };

      if (requiredRoles.length > 0) {
        const held = req.user.roles;
        if (!requiredRoles.every((role) => held.includes(role))) {
          throw new ForbiddenError('Insufficient permissions');
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAdmin = authMiddleware(['ADMIN']);

/** Narrows the request type after authMiddleware has run. */
export function actorOf(req: AuthRequest): Actor {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  return req.user;
}
