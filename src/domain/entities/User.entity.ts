export class User {
  id?: string;
  email: string;
  passwordHash: string;
  name?: string;
  phone?: string;
  roles: string[];
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

  constructor(params: { email: string; passwordHash: string; name?: string; phone?: string }) {
    this.email = params.email;
    this.passwordHash = params.passwordHash;
    this.name = params.name;
    this.phone = params.phone;
    this.roles = ['USER'];
    this.status = 'PENDING_VERIFICATION';
  }
}
