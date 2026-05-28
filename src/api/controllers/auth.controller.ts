import { Request, Response } from 'express';
import { AuthService } from '../../application/services/auth.service';
import { UserRepository } from '../../infrastructure/database/mongodb/repositories/user.repository';

// Instantiate dependencies (in production, use DI container)
const userRepository = new UserRepository();
const authService = new AuthService(userRepository);

export async function register(req: Request, res: Response) {
  try {
    const { email, password, name, phone } = req.body;
    const result = await authService.register(email, password, name, phone);
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message === 'EMAIL_EXISTS') {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Email already exists' } });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Registration failed' } });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Login failed' } });
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'refreshToken required' } });

    const payload = await authService.verifyToken(refreshToken);
    // Issue new access token
    const newAccess = authService.issueAccessToken(String(payload.sub), payload.email, payload.roles || []);
    return res.json({ success: true, data: { accessToken: newAccess } });
  } catch (err: any) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
  }
}
