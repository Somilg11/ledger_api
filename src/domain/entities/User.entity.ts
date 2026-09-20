/**
 * Framework-free domain types. The Mongoose models extend these, so the shape
 * of a user is defined once and the persistence layer cannot drift from it.
 */
export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface User {
  id?: string;
  email: string;
  name?: string;
  phone?: string;
  roles: UserRole[];
  status: UserStatus;
  emailVerified: boolean;
}
