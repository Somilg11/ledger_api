import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserRepository } from '../../infrastructure/database/mongodb/repositories/user.repository';
import { config } from '../../shared/config/app.config';

export class AuthService {
  constructor(private userRepository: UserRepository) {}

  async register(email: string, password: string, name?: string, phone?: string) {
    // Check if user exists
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const user = await this.userRepository.create({
      email,
      passwordHash,
      name,
      phone,
      roles: ['USER'],
      status: 'PENDING_VERIFICATION',
    });

    return {
      userId: String(user._id),
      email: user.email,
      status: user.status,
    };
  }

  async login(email: string, password: string) {
    // Find user
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('INVALID_CREDENTIALS');
    }

    // Verify password
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new Error('INVALID_CREDENTIALS');
    }

    // Generate tokens
    const payload = { sub: String(user._id), email: user.email, roles: user.roles };
    const accessToken = jwt.sign(payload as any, config.jwtSecret as any, {
      expiresIn: config.jwtExpiresIn,
    } as any) as string;
    const refreshToken = jwt.sign({ sub: String(user._id) } as any, config.jwtSecret as any, {
      expiresIn: config.refreshTokenExpiresIn,
    } as any) as string;

    return {
      accessToken,
      refreshToken,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
    };
  }

  async verifyToken(token: string) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as any;
      return {
        sub: payload.sub || payload.userId,
        email: payload.email,
        roles: payload.roles,
      };
    } catch (err) {
      throw new Error('INVALID_TOKEN');
    }
  }
}
