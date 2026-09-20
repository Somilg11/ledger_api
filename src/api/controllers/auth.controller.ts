import { Request, Response } from 'express';
import { authService } from '../../shared/container';
import { AuthRequest } from '../middlewares/auth.middleware';
import { UnauthorizedError } from '../../shared/errors';

export async function register(req: Request, res: Response) {
  const { email, password, name, phone } = req.body;
  const result = await authService.register(email, password, name, phone);
  res.status(201).json({ success: true, data: result });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.status(200).json({ success: true, data: result });
}

export async function refresh(req: Request, res: Response) {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ success: true, data: result });
}

export async function logout(req: AuthRequest, res: Response) {
  if (!req.token) throw new UnauthorizedError('Not authenticated');
  const result = await authService.logout(req.token, req.body?.refreshToken, req.body?.allDevices === true);
  res.status(200).json({ success: true, data: result });
}

export async function me(req: AuthRequest, res: Response) {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  const profile = await authService.getProfile(req.user.id);
  res.status(200).json({ success: true, data: profile });
}

export async function changePassword(req: AuthRequest, res: Response) {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
  res.status(200).json({ success: true, data: result });
}
