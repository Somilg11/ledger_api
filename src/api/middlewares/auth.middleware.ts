import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/config/app.config';

export interface AuthRequest extends Request {
  user?: { sub: string; email?: string; roles?: string[] };
}

export function authMiddleware(requiredPermissions?: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') || req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    }

    const token = auth.split(' ')[1];
    try {
      const payload = jwt.verify(token, config.jwtSecret) as any;
      req.user = { sub: payload.sub || payload.userId, email: payload.email, roles: payload.roles };

      // simple permission check (if provided)
      if (requiredPermissions && requiredPermissions.length > 0) {
        const roles = req.user.roles || [];
        const has = requiredPermissions.every((p) => roles.includes(p));
        if (!has) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
        }
      }

      return next();
    } catch (err) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    }
  };
}
