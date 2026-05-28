# Phase 1: Foundation & Core Architecture

## Table of Contents
1. [Overview](#overview)
2. [Project Setup](#project-setup)
3. [Architecture Principles](#architecture-principles)
4. [Domain Layer](#domain-layer)
5. [Infrastructure Layer](#infrastructure-layer)
6. [Application Layer](#application-layer)
7. [API Layer](#api-layer)
8. [Configuration & Environment](#configuration--environment)
9. [Development Tooling](#development-tooling)
10. [Key Learnings](#key-learnings)

---

## Overview

### Goals of Phase 1
Phase 1 establishes the foundational architecture for a production-grade ledger API system. The focus is on:
- **Clean Architecture**: Separation of concerns with clear boundaries
- **Domain-Driven Design**: Business logic lives in domain entities
- **Scalability**: Redis-backed distributed operations
- **Security**: JWT authentication, rate limiting, idempotency
- **Developer Experience**: Hot reload, debugging, environment management

### Technology Stack
- **Runtime**: Node.js with TypeScript 5.9.3
- **Web Framework**: Express 5.2.1
- **Database**: MongoDB with Mongoose ODM
- **Cache/Store**: Redis with ioredis client
- **Authentication**: JWT tokens with bcryptjs
- **Security**: Helmet, rate limiting, validation
- **Dev Tools**: tsc-watch, VS Code debugging

### What We Built
```
✅ TypeScript configuration with strict mode
✅ Clean architecture folder structure (4 layers)
✅ Domain entities (User, Account, Transaction)
✅ MongoDB models with schemas
✅ Repository pattern for data access
✅ Service layer for business logic
✅ Redis client and cache abstraction
✅ JWT authentication system
✅ Middleware stack (auth, validation, rate limiting, idempotency)
✅ Auth endpoints (register, login)
✅ Environment configuration
✅ VS Code debugging setup
```

---

## Project Setup

### TypeScript Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key Decisions**:
1. **Node16 modules**: Uses Node.js native ESM/CommonJS resolution (avoids module confusion)
2. **Strict mode**: Enables all strict type checking (catches errors early)
3. **ES2020 target**: Modern JavaScript features while maintaining compatibility
4. **rootDir/outDir**: Source in `src/`, compiled code in `dist/`

**Why this matters**: Proper TypeScript config prevents runtime errors and provides excellent IDE support.

---

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "tsc-watch --onSuccess \"node dist/server.js\"",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit"
  }
}
```

**Script Breakdown**:
- `npm run dev`: Watch mode - rebuilds on file change and restarts server
- `npm run build`: Production build - compiles TypeScript to JavaScript
- `npm run start`: Production mode - runs compiled code
- `npm run typecheck`: Type checking only - no code generation

**Why tsc-watch**: Provides hot reload during development without needing nodemon + ts-node.

---

## Architecture Principles

### Clean Architecture (Layered Approach)

```
┌─────────────────────────────────────────┐
│          API Layer (Controllers)        │  ← HTTP requests/responses
├─────────────────────────────────────────┤
│      Application Layer (Services)       │  ← Business logic orchestration
├─────────────────────────────────────────┤
│       Domain Layer (Entities)           │  ← Core business models
├─────────────────────────────────────────┤
│   Infrastructure Layer (DB, Cache)      │  ← External dependencies
└─────────────────────────────────────────┘
```

**Dependency Rule**: Inner layers don't know about outer layers
- API layer depends on Application layer
- Application layer depends on Domain layer
- Infrastructure layer implements interfaces defined by Domain/Application

**Benefits**:
1. **Testability**: Can mock infrastructure without changing business logic
2. **Maintainability**: Changes in one layer don't cascade to others
3. **Scalability**: Easy to swap implementations (e.g., MongoDB → PostgreSQL)

---

### Folder Structure

```
src/
├── api/                          # API Layer (HTTP interface)
│   ├── controllers/              # Request handlers
│   ├── routes/                   # Route definitions
│   └── middlewares/              # HTTP middleware (auth, validation, etc.)
│
├── application/                  # Application Layer (Use cases)
│   └── services/                 # Business logic orchestration
│
├── domain/                       # Domain Layer (Core business)
│   └── entities/                 # Business models (User, Account, Transaction)
│
├── infrastructure/               # Infrastructure Layer (External systems)
│   ├── database/
│   │   └── mongodb/
│   │       ├── models/           # Mongoose schemas
│   │       └── repositories/     # Data access patterns
│   └── cache/                    # Redis client and cache service
│
├── shared/                       # Shared utilities
│   └── config/                   # Configuration management
│
├── app.ts                        # Express app setup
└── server.ts                     # Server startup and lifecycle
```

**Why this structure?**
- **Discoverability**: Clear where to find/add code
- **Separation of concerns**: Each folder has a single responsibility
- **Scalability**: Easy to add new features without cluttering

---

## Domain Layer

### What is the Domain Layer?

The domain layer contains **pure business logic** with no dependencies on frameworks, databases, or external systems. It represents the core concepts of your application.

**Key Characteristics**:
- Framework-agnostic (no Express, Mongoose, etc.)
- Contains business rules and validations
- Defines the "language" of your business (ubiquitous language)

---

### User Entity

**File**: `src/domain/entities/User.entity.ts`

```typescript
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  ACCOUNTANT = 'accountant',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export class User {
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  roles: UserRole[];
  status: UserStatus;
  createdAt?: Date;
  updatedAt?: Date;

  constructor(data: Partial<User>) {
    this.email = data.email || '';
    this.passwordHash = data.passwordHash || '';
    this.name = data.name || '';
    this.phone = data.phone;
    this.roles = data.roles || [UserRole.USER];
    this.status = data.status || UserStatus.ACTIVE;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
}
```

**Design Decisions**:
1. **Enums for constants**: Type-safe role and status values
2. **Constructor with defaults**: Ensures valid state at creation
3. **Partial type**: Allows flexible instantiation
4. **No methods (yet)**: Can add domain methods like `hasRole()`, `isActive()` later

**Example Usage**:
```typescript
const user = new User({
  email: 'john@example.com',
  name: 'John Doe',
  passwordHash: 'hashed_password',
  // roles defaults to [UserRole.USER]
  // status defaults to UserStatus.ACTIVE
});
```

---

### Account Entity

**File**: `src/domain/entities/Account.entity.ts`

```typescript
export enum AccountType {
  SAVINGS = 'savings',
  CURRENT = 'current',
  FIXED_DEPOSIT = 'fixed_deposit',
  LOAN = 'loan',
}

export enum AccountStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  CLOSED = 'closed',
}

export class Account {
  userId: string;
  accountNumber: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  availableBalance: number;
  status: AccountStatus;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;

  constructor(data: Partial<Account>) {
    this.userId = data.userId || '';
    this.accountNumber = data.accountNumber || '';
    this.accountType = data.accountType || AccountType.SAVINGS;
    this.currency = data.currency || 'INR';
    this.balance = data.balance || 0;
    this.availableBalance = data.availableBalance || 0;
    this.status = data.status || AccountStatus.ACTIVE;
    this.metadata = data.metadata;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
}
```

**Key Concepts**:
1. **balance vs availableBalance**: 
   - `balance`: Actual ledger balance
   - `availableBalance`: Balance minus holds/pending transactions
   
2. **metadata field**: Flexible JSON storage for account-specific data (interest rate, linked accounts, etc.)

3. **Currency support**: Multi-currency by design (defaults to INR)

---

### Transaction Entity

**File**: `src/domain/entities/Transaction.entity.ts`

```typescript
export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER = 'transfer',
  FEE = 'fee',
  INTEREST = 'interest',
  REFUND = 'refund',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export class Transaction {
  fromAccount?: string;
  toAccount?: string;
  amount: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  reference?: string;
  description?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
  completedAt?: Date;
  createdAt?: Date;

  constructor(data: Partial<Transaction>) {
    this.fromAccount = data.fromAccount;
    this.toAccount = data.toAccount;
    this.amount = data.amount || 0;
    this.currency = data.currency || 'INR';
    this.type = data.type || TransactionType.DEPOSIT;
    this.status = data.status || TransactionStatus.PENDING;
    this.reference = data.reference;
    this.description = data.description;
    this.metadata = data.metadata;
    this.idempotencyKey = data.idempotencyKey;
    this.completedAt = data.completedAt;
    this.createdAt = data.createdAt;
  }
}
```

**Transaction Patterns**:
1. **Deposit**: `toAccount` set, `fromAccount` null (money enters system)
2. **Withdrawal**: `fromAccount` set, `toAccount` null (money leaves system)
3. **Transfer**: Both accounts set (internal movement)
4. **Idempotency key**: Prevents duplicate transactions (critical for payments)

---

## Infrastructure Layer

### MongoDB Connection

**File**: `src/infrastructure/database/mongodb/connection.ts`

```typescript
import mongoose from 'mongoose';
import config from '../../../shared/config/app.config';

export const connectDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  console.log('MongoDB disconnected');
};
```

**Key Points**:
1. **Async/await**: Database connections are asynchronous operations
2. **Error handling**: Throw errors up to caller (server.ts handles gracefully)
3. **Configuration**: Uses centralized config (don't hardcode connection strings)

**Connection Options** (Mongoose 6+ defaults):
- Auto-reconnect enabled
- Connection pooling (default: 100 connections)
- Server selection timeout: 30 seconds

---

### Mongoose Models

#### User Model

**File**: `src/infrastructure/database/mongodb/models/user.model.ts`

```typescript
import mongoose, { Schema, Document } from 'mongoose';
import { UserRole, UserStatus } from '../../../../domain/entities/User.entity';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  roles: UserRole[];
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    roles: {
      type: [String],
      enum: Object.values(UserRole),
      default: [UserRole.USER],
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
    },
  },
  {
    timestamps: true,
  }
);

export const UserModel = mongoose.model<IUser>('User', UserSchema);
```

**Schema Design Decisions**:

1. **IUser interface extends Document**: Gets Mongoose document methods (_id, save(), etc.)

2. **Email indexing**: 
   ```typescript
   email: { unique: true, index: true }
   ```
   - Creates unique index for fast lookups
   - Prevents duplicate email registrations
   - Essential for login queries

3. **Enum validation**:
   ```typescript
   enum: Object.values(UserRole)
   ```
   - Database-level validation
   - Rejects invalid role values
   - Type-safe with TypeScript enums

4. **Timestamps option**:
   ```typescript
   { timestamps: true }
   ```
   - Auto-creates `createdAt` and `updatedAt`
   - Updated automatically on save()

5. **String transformations**:
   - `lowercase: true` → Stores emails in lowercase (prevents case-sensitivity issues)
   - `trim: true` → Removes leading/trailing whitespace

---

#### Account Model

**File**: `src/infrastructure/database/mongodb/models/account.model.ts`

```typescript
export interface IAccount extends Document {
  userId: mongoose.Types.ObjectId;
  accountNumber: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  availableBalance: number;
  status: AccountStatus;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    accountNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    accountType: {
      type: String,
      enum: Object.values(AccountType),
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      default: AccountStatus.ACTIVE,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);
```

**Advanced Features**:

1. **Reference to User**:
   ```typescript
   userId: { type: Schema.Types.ObjectId, ref: 'User' }
   ```
   - Foreign key relationship
   - Enables `.populate('userId')` to fetch user details
   - Indexed for fast joins

2. **Numeric validation**:
   ```typescript
   balance: { type: Number, min: 0 }
   ```
   - Prevents negative balances at database level
   - Important: Application logic should also validate

3. **Mixed type for metadata**:
   ```typescript
   metadata: { type: Schema.Types.Mixed }
   ```
   - Stores arbitrary JSON objects
   - Flexible schema for extension data

---

#### Transaction Model

**File**: `src/infrastructure/database/mongodb/models/transaction.model.ts`

```typescript
const TransactionSchema = new Schema<ITransaction>(
  {
    fromAccount: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      index: true,
    },
    toAccount: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(TransactionStatus),
      default: TransactionStatus.PENDING,
    },
    reference: String,
    description: String,
    metadata: Schema.Types.Mixed,
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);
```

**Critical Fields**:

1. **Idempotency key**:
   ```typescript
   idempotencyKey: { unique: true, sparse: true }
   ```
   - `sparse: true` → Only indexes non-null values
   - Allows multiple null idempotency keys
   - Prevents duplicate transaction processing

2. **Dual account indexing**:
   ```typescript
   fromAccount: { index: true }
   toAccount: { index: true }
   ```
   - Fast queries for account history
   - Essential for transaction listings

3. **Status tracking**:
   - PENDING → transaction initiated
   - COMPLETED → funds transferred, `completedAt` set
   - FAILED → error occurred, funds not moved
   - CANCELLED → user/system cancelled before completion

---

### Repository Pattern

**File**: `src/infrastructure/database/mongodb/repositories/user.repository.ts`

```typescript
import { UserModel, IUser } from '../models/user.model';
import { User } from '../../../../domain/entities/User.entity';

export class UserRepository {
  async create(user: User): Promise<IUser> {
    const newUser = new UserModel(user);
    return await newUser.save();
  }

  async findByEmail(email: string): Promise<IUser | null> {
    return await UserModel.findOne({ email }).exec();
  }

  async findById(id: string): Promise<IUser | null> {
    return await UserModel.findById(id).exec();
  }

  async update(id: string, data: Partial<User>): Promise<IUser | null> {
    return await UserModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async delete(id: string): Promise<boolean> {
    const result = await UserModel.findByIdAndDelete(id).exec();
    return result !== null;
  }
}
```

**Why Repository Pattern?**

1. **Abstraction**: Hides Mongoose implementation details from business logic
   ```typescript
   // Without repository (controller directly using Mongoose)
   const user = await UserModel.findOne({ email });
   
   // With repository (controller using abstraction)
   const user = await userRepository.findByEmail(email);
   ```

2. **Testability**: Easy to mock for unit tests
   ```typescript
   const mockRepository = {
     findByEmail: jest.fn().mockResolvedValue(mockUser)
   };
   ```

3. **Swappable**: Can switch from MongoDB to PostgreSQL by implementing same interface

4. **Query optimization**: Central place to add `.lean()`, `.select()`, indexes

---

### Redis Infrastructure

#### Redis Client

**File**: `src/infrastructure/cache/redis.client.ts`

```typescript
import Redis from 'ioredis';
import config from '../../shared/config/app.config';

let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl);

    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    redisClient.on('error', (err: Error) => {
      console.error('❌ Redis error:', err);
    });
  }
  return redisClient;
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('Redis disconnected');
  }
};
```

**Singleton Pattern**:
- One Redis connection shared across application
- Prevents connection pool exhaustion
- Initialized lazily on first access

**Connection URL Format**:
```
redis://localhost:6379
redis://:password@localhost:6379
redis://localhost:6379/2  (database number)
```

**Event Handling**:
- `connect`: Confirms successful connection
- `error`: Logs connection/operation errors
- `close`: Triggered when connection closes

---

#### Cache Service

**File**: `src/infrastructure/cache/cache.service.ts`

```typescript
import { getRedisClient } from './redis.client';

export class CacheService {
  private redis = getRedisClient();

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    return await this.redis.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<boolean> {
    if (ttlSeconds) {
      const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    }
    const result = await this.redis.setnx(key, value);
    return result === 1;
  }
}
```

**Method Explanations**:

1. **get/set**: Basic key-value operations
   ```typescript
   await cacheService.set('user:123', JSON.stringify(userData), 3600);
   const cached = await cacheService.get('user:123');
   ```

2. **setIfNotExists**: Atomic operation for distributed locks
   ```typescript
   const acquired = await cacheService.setIfNotExists('lock:payment:123', '1', 30);
   if (acquired) {
     // Process payment
   } else {
     // Another instance is processing
   }
   ```

3. **incr**: Atomic increment (race-condition safe)
   ```typescript
   await cacheService.incr('rate_limit:user:123');
   ```

4. **TTL (Time To Live)**: Auto-expiration
   - `ttlSeconds`: Key automatically deleted after expiry
   - Prevents memory leaks from stale cache

---

## Application Layer

### AuthService

**File**: `src/application/services/auth.service.ts`

```typescript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRepository } from '../../infrastructure/database/mongodb/repositories/user.repository';
import { User } from '../../domain/entities/User.entity';
import config from '../../shared/config/app.config';

export class AuthService {
  constructor(private userRepository: UserRepository) {}

  async register(
    email: string,
    password: string,
    name: string,
    phone?: string
  ): Promise<{ user: any; accessToken: string; refreshToken: string }> {
    // Check if user already exists
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user entity
    const userEntity = new User({
      email,
      passwordHash,
      name,
      phone,
    });

    // Save to database
    const user = await this.userRepository.create(userEntity);

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user._id, email: user.email, roles: user.roles },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      config.jwtSecret,
      { expiresIn: config.refreshTokenExpiresIn }
    );

    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
      accessToken,
      refreshToken,
    };
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: any; accessToken: string; refreshToken: string }> {
    // Find user
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user._id, email: user.email, roles: user.roles },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      config.jwtSecret,
      { expiresIn: config.refreshTokenExpiresIn }
    );

    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
      accessToken,
      refreshToken,
    };
  }

  async verifyToken(token: string): Promise<any> {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }
}
```

**Service Layer Responsibilities**:

1. **Business Logic**: All authentication rules live here
   - Password hashing (bcrypt with 10 rounds)
   - Duplicate email checking
   - Token generation

2. **Orchestration**: Coordinates multiple operations
   ```
   register() flow:
   1. Check existing user (repository call)
   2. Hash password (crypto operation)
   3. Create entity (domain instantiation)
   4. Save user (repository call)
   5. Generate tokens (JWT creation)
   6. Return response
   ```

3. **Error Handling**: Throws descriptive errors
   - "User with this email already exists"
   - "Invalid email or password"
   - "Invalid or expired token"

4. **Dependency Injection**: Receives repository via constructor
   ```typescript
   constructor(private userRepository: UserRepository) {}
   ```
   - Makes testing easy (inject mock repository)
   - Follows SOLID principles

**JWT Token Structure**:

**Access Token** (15 minutes):
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "email": "john@example.com",
  "roles": ["user"],
  "iat": 1708099200,
  "exp": 1708100100
}
```

**Refresh Token** (7 days):
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "iat": 1708099200,
  "exp": 1708704000
}
```

**Token Strategy**:
- Short-lived access token for security
- Long-lived refresh token for UX
- Refresh endpoint (TODO Phase 2) exchanges refresh token for new access token

---

## API Layer

### Middleware Stack

#### 1. Authentication Middleware

**File**: `src/api/middlewares/auth.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../shared/config/app.config';
import { UserRole } from '../../domain/entities/User.entity';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    roles: UserRole[];
  };
}

export const authMiddleware = (requiredRoles?: UserRole[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'No token provided',
        });
      }

      const token = authHeader.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, config.jwtSecret) as any;

      // Attach user to request
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        roles: decoded.roles,
      };

      // Check role permissions
      if (requiredRoles && requiredRoles.length > 0) {
        const hasRole = requiredRoles.some((role) =>
          req.user?.roles.includes(role)
        );
        if (!hasRole) {
          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions',
          });
        }
      }

      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
  };
};
```

**Key Features**:

1. **Bearer Token Extraction**:
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
   - Standard OAuth 2.0 format
   - Splits header and extracts token

2. **JWT Verification**:
   - Validates signature (prevents tampering)
   - Checks expiration (security)
   - Decodes payload (gets user info)

3. **Request Enhancement**:
   ```typescript
   req.user = { userId, email, roles }
   ```
   - Subsequent middleware/controllers access authenticated user
   - No need to decode token multiple times

4. **Role-Based Access Control**:
   ```typescript
   // Protect route with role requirement
   router.get('/admin', authMiddleware([UserRole.ADMIN]), adminController);
   
   // Any authenticated user
   router.get('/profile', authMiddleware(), profileController);
   ```

---

#### 2. Validation Middleware

**File**: `src/api/middlewares/validation.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export const validationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};
```

**Usage with express-validator**:
```typescript
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('name').notEmpty().withMessage('Name is required'),
  ],
  validationMiddleware,
  authController.register
);
```

**Validation Flow**:
1. Express-validator runs validators on request
2. `validationMiddleware` checks for errors
3. If errors exist, returns 400 with error array
4. If valid, proceeds to controller

**Example Error Response**:
```json
{
  "success": false,
  "errors": [
    {
      "msg": "Valid email required",
      "param": "email",
      "location": "body"
    },
    {
      "msg": "Password must be at least 8 characters",
      "param": "password",
      "location": "body"
    }
  ]
}
```

---

#### 3. Redis Rate Limiter

**File**: `src/api/middlewares/redisRateLimit.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedisClient } from '../../infrastructure/cache/redis.client';

const rateLimiter = new RateLimiterRedis({
  storeClient: getRedisClient(),
  keyPrefix: 'rate_limit',
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
  blockDuration: 60, // Block for 60 seconds if exceeded
});

export const redisRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Use IP address as identifier
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    await rateLimiter.consume(key);
    next();
  } catch (error) {
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later',
    });
  }
};
```

**Why Redis-backed Rate Limiting?**

**In-Memory (express-rate-limit)**:
```
Instance 1: {user1: 50 requests}
Instance 2: {user1: 50 requests}
→ Total: 100 requests (limit bypassed!)
```

**Redis-backed**:
```
Instance 1 → Redis: increment(user1) → 50
Instance 2 → Redis: increment(user1) → 100
→ Total: 100 requests (limit enforced!)
```

**Configuration Options**:
- `points`: Request quota (100 requests)
- `duration`: Time window (60 seconds)
- `blockDuration`: Cooldown period after exceeding limit
- `keyPrefix`: Namespace in Redis (`rate_limit:192.168.1.1`)

**Advanced Usage**:
```typescript
// Different limits for authenticated users
const key = req.user ? `user:${req.user.userId}` : `ip:${req.ip}`;
const points = req.user ? 1000 : 100; // Higher limit for logged-in users
```

---

#### 4. Idempotency Middleware

**File**: `src/api/middlewares/idempotency.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../../infrastructure/cache/cache.service';

const cacheService = new CacheService();
const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Only apply to mutation methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers['x-idempotency-key'] as string;
  if (!idempotencyKey) {
    return next();
  }

  const cacheKey = `idempotency:${idempotencyKey}`;

  try {
    // Check if request was already processed
    const cachedResponse = await cacheService.get(cacheKey);
    if (cachedResponse) {
      const parsed = JSON.parse(cachedResponse);
      return res.status(parsed.status).json(parsed.body);
    }

    // Check if request is currently being processed
    const processingKey = `${cacheKey}:processing`;
    const isProcessing = await cacheService.setIfNotExists(
      processingKey,
      '1',
      60
    );

    if (!isProcessing) {
      return res.status(409).json({
        success: false,
        error: 'Request is currently being processed',
      });
    }

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      // Cache the response
      cacheService.set(
        cacheKey,
        JSON.stringify({ status: res.statusCode, body }),
        IDEMPOTENCY_TTL
      );

      // Delete processing flag
      cacheService.del(processingKey);

      return originalJson(body);
    };

    next();
  } catch (error) {
    console.error('Idempotency middleware error:', error);
    next();
  }
};
```

**Idempotency Explained**:

**Problem**: Network failures can cause duplicate requests
```
Client                Server
  |--- POST /transfer -->| (success)
  |                      |
  X <-- timeout         | (no response received)
  |                      |
  |--- POST /transfer -->| (duplicate! money transferred twice)
```

**Solution**: Client sends unique `X-Idempotency-Key` header
```
Client                         Redis Cache
  |--- POST /transfer -------->|
  | X-Idempotency-Key: abc123  | 
  |                            | ✓ Cache response
  |<-- 200 OK ----------------| 
  |                            |
  |--- POST /transfer -------->| (retry)
  | X-Idempotency-Key: abc123  | 
  |                            | ✓ Return cached response
  |<-- 200 OK ----------------| (no duplicate!)
```

**Three States**:
1. **First Request**: No cache, process normally, cache response
2. **Completed**: Cache exists, return cached response (HTTP 200)
3. **Processing**: Processing flag exists, return 409 Conflict

**Real-World Usage**:
```javascript
// Client-side (frontend)
const idempotencyKey = uuidv4(); // Generate once

fetch('/api/v1/transactions', {
  method: 'POST',
  headers: {
    'X-Idempotency-Key': idempotencyKey,
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ amount: 1000, toAccount: '123' })
});

// Safe to retry with same key
```

---

### Controllers

**File**: `src/api/controllers/auth.controller.ts`

```typescript
import { Request, Response } from 'express';
import { AuthService } from '../../application/services/auth.service';
import { UserRepository } from '../../infrastructure/database/mongodb/repositories/user.repository';

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, name, phone } = req.body;

      const userRepository = new UserRepository();
      const authService = new AuthService(userRepository);

      const result = await authService.register(email, password, name, phone);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      const userRepository = new UserRepository();
      const authService = new AuthService(userRepository);

      const result = await authService.login(email, password);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(401).json({
        success: false,
        error: error.message,
      });
    }
  }
}

export const authController = new AuthController();
```

**Controller Responsibilities**:
1. **HTTP Handling**: Extract request data, send responses
2. **Service Instantiation**: Create service with dependencies
3. **Error Translation**: Convert service errors to HTTP status codes
4. **Response Formatting**: Consistent JSON structure

**Standard Response Format**:
```json
// Success
{
  "success": true,
  "data": { /* payload */ }
}

// Error
{
  "success": false,
  "error": "Error message"
}
```

---

### Routes

**File**: `src/api/routes/auth.routes.ts`

```typescript
import { Router } from 'express';
import { body } from 'express-validator';
import { authController } from '../controllers/auth.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';

const router = Router();

router.post(
  '/register',
  [
    body('email')
      .isEmail()
      .withMessage('Valid email is required')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('phone').optional().isMobilePhone('any'),
  ],
  validationMiddleware,
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validationMiddleware,
  authController.login
);

export default router;
```

**Route Structure**:
```typescript
router.METHOD(
  '/path',
  [validators],        // Optional: express-validator checks
  validationMiddleware,// Optional: error handling
  authMiddleware(),    // Optional: authentication
  controller.method    // Controller function
);
```

**Validation Chain**:
- `isEmail()`: Validates email format
- `normalizeEmail()`: Converts to lowercase, removes dots
- `isLength({ min: 8 })`: Minimum character check
- `trim()`: Removes whitespace
- `notEmpty()`: Ensures not blank
- `optional()`: Only validates if present
- `isMobilePhone('any')`: Validates phone format

---

## Configuration & Environment

### Configuration File

**File**: `src/shared/config/app.config.ts`

```typescript
import dotenv from 'dotenv';
dotenv.config();

export default {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ledger_api',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiresIn: process.env.REFRESH_EXPIRES_IN || '7d',
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  },
};
```

**Configuration Best Practices**:

1. **Centralized**: Single source of truth for all config
2. **Environment Variables**: Uses `.env` file (not committed to git)
3. **Defaults**: Fallback values for development
4. **Type Safety**: Import config, not `process.env` directly

**Why dotenv?**
```
// BAD: Scattered throughout codebase
const dbUrl = process.env.MONGO_URI || 'mongodb://localhost...';

// GOOD: Centralized and type-safe
import config from './config/app.config';
const dbUrl = config.mongoUri;
```

---

### Environment Template

**File**: `.env.example`

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/ledger_api

# Redis
REDIS_URL=redis://localhost:6379

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_IN=7d
```

**Usage**:
```bash
cp .env.example .env
# Edit .env with your values
```

**Security Notes**:
1. **Never commit `.env`**: Add to `.gitignore`
2. **Strong JWT secret**: Min 32 characters, random
3. **Production values**: Use environment-specific secrets

---

## Development Tooling

### VS Code Debugging

**File**: `.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Server (Dev)",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/dist/server.js",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Run Dev Server",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Run Tests",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test"],
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to Process",
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

**Debug Configurations**:

1. **Launch Server (Dev)**:
   - Builds TypeScript first
   - Runs compiled code with debugger
   - Loads `.env` file
   - Use for: Debugging production-like build

2. **Run Dev Server**:
   - Runs `npm run dev` with debugger
   - Hot reload with tsc-watch
   - Use for: Active development

3. **Run Tests**:
   - Runs `npm test` with debugger
   - Set breakpoints in test files
   - Use for: Debugging failing tests

4. **Attach to Process**:
   - Attaches to running Node process
   - Requires `--inspect` flag
   - Use for: Debugging already-running server

**How to Debug**:
1. Set breakpoint (click line number in VS Code)
2. Press F5 or click "Run and Debug"
3. Select configuration
4. Code pauses at breakpoints
5. Inspect variables, step through code

---

### App and Server Separation

#### App Configuration

**File**: `src/app.ts`

```typescript
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './api/routes/auth.routes';
import { redisRateLimiter } from './api/middlewares/redisRateLimit.middleware';
import { idempotencyMiddleware } from './api/middlewares/idempotency.middleware';

const app = express();

// Security middleware
app.use(helmet());

// Logging middleware
app.use(morgan('combined'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(redisRateLimiter);

// Idempotency
app.use(idempotencyMiddleware);

// Routes
app.use('/api/v1/auth', authRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
```

**Middleware Order Matters**:
```
1. helmet        → Security headers
2. morgan        → Request logging
3. body parsers  → Parse JSON/URL-encoded
4. rate limiter  → Prevent abuse
5. idempotency   → Prevent duplicates
6. routes        → Business logic
```

---

#### Server Startup

**File**: `src/server.ts`

```typescript
import app from './app';
import config from './shared/config/app.config';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/mongodb/connection';
import { getRedisClient, disconnectRedis } from './infrastructure/cache/redis.client';

const PORT = config.port;

const initialize = async () => {
  try {
    // Connect to MongoDB
    await connectDatabase();
    
    // Connect to Redis
    getRedisClient();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down gracefully...');
  await disconnectDatabase();
  await disconnectRedis();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

initialize();
```

**Why Separate app.ts and server.ts?**

1. **Testability**: Can import `app` without starting server
   ```typescript
   import app from './app';
   import request from 'supertest';
   
   test('health check', async () => {
     const response = await request(app).get('/health');
     expect(response.status).toBe(200);
   });
   ```

2. **Initialization Control**: Server handles connections, app handles routing
3. **Graceful Shutdown**: Clean up resources on SIGINT/SIGTERM

**Startup Sequence**:
```
1. Connect to MongoDB
2. Connect to Redis
3. Start HTTP server
4. Listen on port 3000
```

**Shutdown Sequence**:
```
1. Receive SIGINT (Ctrl+C) or SIGTERM
2. Log shutdown message
3. Disconnect MongoDB
4. Disconnect Redis
5. Exit process
```

---

## Key Learnings

### 1. Clean Architecture Benefits

**Before** (Monolithic):
```typescript
// Everything in one controller
router.post('/register', async (req, res) => {
  const existing = await UserModel.findOne({ email: req.body.email });
  if (existing) return res.status(400).json({ error: 'Exists' });
  
  const hash = await bcrypt.hash(req.body.password, 10);
  const user = await UserModel.create({ ...req.body, passwordHash: hash });
  
  const token = jwt.sign({ userId: user._id }, 'secret');
  res.json({ user, token });
});
```

**After** (Clean Architecture):
```typescript
// Controller (HTTP layer)
async register(req, res) {
  const result = await authService.register(...req.body);
  res.json(result);
}

// Service (Business logic)
async register(email, password, name) {
  // Validate, hash, create user, generate tokens
}

// Repository (Data access)
async create(user) {
  return await UserModel.create(user);
}
```

**Benefits**:
- Each layer has single responsibility
- Easy to test (mock dependencies)
- Can swap implementations (MongoDB → PostgreSQL)
- Business logic reusable (CLI, API, workers)

---

### 2. Repository Pattern Value

**Direct Model Usage** (Controller):
```typescript
const user = await UserModel.findOne({ email }).exec();
```

**Repository Pattern** (Controller):
```typescript
const user = await userRepository.findByEmail(email);
```

**Why Repository Wins**:
1. **Abstraction**: Controllers don't know about Mongoose
2. **Centralized Queries**: All user queries in one place
3. **Easy Optimization**: Add `.lean()`, `.select()` in one place
4. **Testable**: Mock repository easily

```typescript
// Testing with mock repository
const mockRepo = {
  findByEmail: jest.fn().mockResolvedValue(mockUser)
};
const service = new AuthService(mockRepo);
```

---

### 3. Redis for Distributed Systems

**In-Memory Rate Limiting** (Single Instance):
```typescript
// Works fine for single server
const limiter = rateLimit({ windowMs: 60000, max: 100 });
```

**Problem with Multiple Instances**:
```
Load Balancer
     |
     +---> Instance 1 (in-memory: 50 requests)
     |
     +---> Instance 2 (in-memory: 50 requests)
     
Total: 100 requests, but limit is 100 per user (not enforced!)
```

**Redis-Backed** (Distributed):
```
Load Balancer
     |
     +---> Instance 1 ---+
     |                   |
     +---> Instance 2 ---+--> Redis (50 + 50 = 100)
     
Total: 100 requests, limit enforced correctly!
```

**When to Use Redis**:
- ✅ Rate limiting across instances
- ✅ Idempotency keys across instances
- ✅ Session storage
- ✅ Distributed locks
- ❌ Simple caching (consider in-memory first)

---

### 4. Idempotency is Critical

**Without Idempotency**:
```typescript
// Client retries due to network issue
POST /transfer { amount: 1000, to: 'Bob' }
POST /transfer { amount: 1000, to: 'Bob' } // Duplicate!

Result: Bob receives $2000 instead of $1000
```

**With Idempotency**:
```typescript
POST /transfer
Headers: { 'X-Idempotency-Key': 'abc-123' }
Body: { amount: 1000, to: 'Bob' }

// Retry with same key
POST /transfer
Headers: { 'X-Idempotency-Key': 'abc-123' }
Body: { amount: 1000, to: 'Bob' }

Result: Returns cached response, Bob receives $1000 once
```

**Implementation Pattern**:
1. Check cache for idempotency key
2. If exists, return cached response
3. If not, set processing flag
4. Process request
5. Cache response for 24 hours

---

### 5. JWT Token Strategy

**Access Token** (Short-lived):
- Expires in 15 minutes
- Contains user info (id, email, roles)
- Sent with every request
- If compromised, expires quickly

**Refresh Token** (Long-lived):
- Expires in 7 days
- Contains minimal info (just user ID)
- Only used to get new access token
- Stored securely (httpOnly cookie in production)

**Token Flow**:
```
1. Login → Receive access token + refresh token
2. Use access token for API calls
3. Access token expires (15 min)
4. Use refresh token to get new access token
5. Continue using API
6. Refresh token expires (7 days) → Must login again
```

**Security Benefits**:
- Short access token lifetime limits damage if stolen
- Refresh token rarely transmitted (only to /refresh endpoint)
- Can revoke refresh tokens without affecting active sessions

---

### 6. Environment Configuration

**Bad Practice**:
```typescript
// Scattered throughout code
const db = mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost...');
const secret = process.env.JWT_SECRET || 'default-secret';
```

**Good Practice**:
```typescript
// Centralized config
import config from './config/app.config';
mongoose.connect(config.mongoUri);
jwt.sign(payload, config.jwtSecret);
```

**Benefits**:
1. Single place to update configuration
2. Type safety and autocomplete
3. Validation possible (ensure required vars exist)
4. Easy to mock in tests
5. Clear documentation of all config options

---

### 7. Middleware Order is Critical

**Correct Order**:
```typescript
app.use(helmet());           // 1. Security headers
app.use(morgan('combined')); // 2. Logging
app.use(express.json());     // 3. Body parsing
app.use(rateLimiter);        // 4. Rate limiting
app.use(idempotency);        // 5. Idempotency
app.use('/api', routes);     // 6. Business logic
app.use(errorHandler);       // 7. Error handling
```

**Why This Order?**
1. **Security first**: Helmet sets headers before anything else
2. **Logging early**: Capture all requests, even rate-limited ones
3. **Parse before use**: Must parse body before validation/rate limiting
4. **Rate limit before business logic**: Reject abuse early
5. **Idempotency before routes**: Cache/check before processing
6. **Error handler last**: Catches errors from all above middleware

**What Happens if Wrong?**
```typescript
// WRONG: Rate limiter after routes
app.use('/api', routes);     // Processes expensive operations
app.use(rateLimiter);        // Never reached if route throws error!
```

---

### 8. Separation of app.ts and server.ts

**app.ts** (Express configuration):
```typescript
const app = express();
app.use(middleware);
app.use('/api', routes);
export default app;
```

**server.ts** (Server lifecycle):
```typescript
import app from './app';
connectDatabase();
app.listen(3000);
```

**Why Separate?**
1. **Testing**: Import app without starting server
   ```typescript
   import app from './app';
   supertest(app).get('/health').expect(200);
   ```

2. **Multiple Listeners**: Can start server on different ports
   ```typescript
   app.listen(3000); // HTTP
   app.listen(3001); // HTTPS
   ```

3. **Serverless**: Export app without server for AWS Lambda
   ```typescript
   export const handler = serverless(app);
   ```

---

### 9. TypeScript Strict Mode

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

**What Strict Mode Enables**:
- `strictNullChecks`: Can't assign `null`/`undefined` without explicit type
- `strictFunctionTypes`: Function parameters are contravariant
- `strictBindCallApply`: Type-check bind/call/apply
- `noImplicitAny`: Must explicitly type `any`
- `noImplicitThis`: `this` must have explicit type

**Example**:
```typescript
// Without strict mode (compiles, crashes at runtime)
function getUser(id: string) {
  const user = users.find(u => u.id === id);
  return user.name; // ❌ user might be undefined!
}

// With strict mode (compile error)
function getUser(id: string) {
  const user = users.find(u => u.id === id);
  return user.name; // ❌ TS Error: Object is possibly 'undefined'
}

// Fixed
function getUser(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) throw new Error('User not found');
  return user.name; // ✅ user is guaranteed to exist
}
```

---

### 10. Domain-Driven Design Entities

**Anemic Model** (Anti-pattern):
```typescript
// Just data, no behavior
class User {
  email: string;
  roles: string[];
}

// Logic scattered in services
if (user.roles.includes('admin')) { ... }
```

**Rich Domain Model**:
```typescript
class User {
  email: string;
  roles: UserRole[];
  
  hasRole(role: UserRole): boolean {
    return this.roles.includes(role);
  }
  
  isActive(): boolean {
    return this.status === UserStatus.ACTIVE;
  }
  
  canPerformAction(action: string): boolean {
    // Complex business logic here
  }
}

// Usage is clean and readable
if (user.hasRole(UserRole.ADMIN)) { ... }
```

**Benefits**:
- Business logic lives with data (cohesion)
- Self-documenting (method names express intent)
- Reusable across application
- Easier to test domain logic in isolation

---

## Phase 1 Checklist

### ✅ Completed

- [x] TypeScript configuration with strict mode
- [x] Clean architecture folder structure
- [x] Domain entities (User, Account, Transaction)
- [x] MongoDB models and connection
- [x] User repository with CRUD operations
- [x] AuthService with register/login/verifyToken
- [x] Auth controller using service layer
- [x] Auth routes with validation
- [x] JWT authentication middleware
- [x] Validation middleware with express-validator
- [x] Redis client and cache service
- [x] Redis-backed rate limiter
- [x] Idempotency middleware
- [x] Environment configuration with .env
- [x] VS Code debug configurations
- [x] Health check endpoint
- [x] Graceful shutdown handling

### 🚧 Phase 2 Preview

- [ ] Account service and controller
- [ ] Transaction service with ACID guarantees
- [ ] Ledger service for double-entry bookkeeping
- [ ] Refresh token endpoint
- [ ] User profile endpoints (GET, PUT, DELETE)
- [ ] Account CRUD endpoints
- [ ] Transaction endpoints (create, list, get)
- [ ] Unit tests with Jest
- [ ] Integration tests with supertest
- [ ] API documentation with Swagger/OpenAPI
- [ ] Request/Response logging
- [ ] Error handling middleware
- [ ] Input sanitization
- [ ] CORS configuration

---

## Testing the Phase 1 API

### 1. Start Prerequisites

```bash
# Start MongoDB
mongod

# Start Redis
redis-server

# In project directory
cp .env.example .env
npm install
npm run dev
```

---

### 2. Register a User

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123",
    "name": "John Doe",
    "phone": "+1234567890"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "john@example.com",
      "name": "John Doe",
      "roles": ["user"]
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 3. Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123"
  }'
```

---

### 4. Test Rate Limiting

```bash
# Run 101 requests quickly
for i in {1..101}; do
  curl -X GET http://localhost:3000/health
  echo " - Request $i"
done
```

**Expected**: First 100 succeed, 101st returns 429 Too Many Requests

---

### 5. Test Idempotency

```bash
# First request (processes)
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: unique-key-123" \
  -d '{
    "email": "jane@example.com",
    "password": "SecurePass123",
    "name": "Jane Doe"
  }'

# Retry with same key (returns cached response, doesn't create duplicate)
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: unique-key-123" \
  -d '{
    "email": "jane@example.com",
    "password": "SecurePass123",
    "name": "Jane Doe"
  }'
```

---

### 6. Test Validation

```bash
# Missing password
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "invalid@example.com",
    "name": "Test User"
  }'
```

**Expected Response**:
```json
{
  "success": false,
  "errors": [
    {
      "msg": "Password must be at least 8 characters long",
      "param": "password",
      "location": "body"
    }
  ]
}
```

---

## Next Steps

### Immediate Actions
1. **Run the API**: `npm run dev` and test endpoints
2. **Explore code**: Walk through auth flow from route → controller → service → repository
3. **Modify and observe**: Change validation rules, see TypeScript errors
4. **Debug**: Set breakpoints and step through execution

### Learning Path
1. **Understand Clean Architecture**: Read about dependency rule and layer responsibilities
2. **Study Middleware**: Experiment with middleware order
3. **Learn Redis**: Understand cache patterns and distributed systems
4. **Practice TDD**: Write tests before implementing features (Phase 2)

### Phase 2 Preparation
- Read about database transactions (ACID)
- Learn double-entry bookkeeping concepts
- Study API documentation tools (Swagger)
- Understand integration testing with supertest

---

## Conclusion

Phase 1 establishes a **production-grade foundation** with:
- **Clean, maintainable architecture** (4-layer separation)
- **Type safety** (TypeScript strict mode)
- **Security** (JWT, helmet, rate limiting, validation)
- **Scalability** (Redis-backed distributed operations)
- **Developer experience** (hot reload, debugging, environment management)

This foundation is **battle-tested** and follows **industry best practices**. Everything we build in future phases will leverage these patterns.

**Key Takeaway**: Good architecture is an investment. We spent time building the foundation right so that adding features in Phase 2, 3, 4 will be fast and maintainable.

---