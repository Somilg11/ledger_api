import { Request, Response } from 'express';
import { AccountRepository } from '../../infrastructure/database/mongodb/repositories/account.repository';
import { AccountService } from '../../application/services/account.service';

const repo = new AccountRepository();
const service = new AccountService(repo);

export class AccountController {
  async create(req: Request, res: Response) {
    try {
      const data = req.body;
      const created = await service.createAccount(data);
      res.status(201).json({ success: true, data: created });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ success: false, error: 'Missing id' });
      const account = await service.getAccountById(id);
      if (!account) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: account });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getByUser(req: Request, res: Response) {
    try {
      const userId = String(req.params.userId || '');
      if (!userId) return res.status(400).json({ success: false, error: 'Missing userId' });
      const accounts = await service.getAccountsByUser(userId);
      res.json({ success: true, data: accounts });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ success: false, error: 'Missing id' });
      const data = req.body;
      const updated = await service.updateAccount(id, data);
      if (!updated) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async close(req: Request, res: Response) {
    try {
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ success: false, error: 'Missing id' });
      const closed = await service.closeAccount(id);
      if (!closed) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: closed });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}

export const accountController = new AccountController();
