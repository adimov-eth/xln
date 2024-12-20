import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './BaseService';
import { StorageService } from './StorageService';
import { Logger } from '../utils/Logger';
import {
  IUser,
  UserRole,
  UserStatus,
  UserRegistrationType,
  UserLoginType,
  UserProfileUpdateType,
  UserSettingsUpdateType,
  PasswordChangeType,
  PasswordResetRequestType,
  PasswordResetType,
} from '@xln/types';

/**
 * User service configuration
 */
interface IUserServiceConfig {
  dbPath: string;
  logger?: Logger;
  jwtSecret: string;
  jwtExpiresIn?: string;
  bcryptRounds?: number;
}

/**
 * Reset token data interface
 */
interface IResetTokenData {
  userId: string;
  expiresAt: number;
}

/**
 * User service for managing users
 */
export class UserService extends BaseService {
  protected readonly storage: StorageService;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly bcryptRounds: number;

  constructor(config: IUserServiceConfig) {
    super(config);
    this.storage = new StorageService({
      dbPath: config.dbPath,
      logger: this.logger,
    });
    this.jwtSecret = config.jwtSecret;
    this.jwtExpiresIn = config.jwtExpiresIn || '1d';
    this.bcryptRounds = config.bcryptRounds || 10;
  }

  /**
   * Initialize the service
   */
  public async initialize(): Promise<void> {
    await this.storage.open();
  }

  /**
   * Close the service
   */
  public async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * Register a new user
   */
  public async register(data: UserRegistrationType): Promise<IUser> {
    // Check if email already exists
    const existingUser = await this.storage.get<string>(`user:email:${data.email}`);
    if (existingUser?.data) {
      throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, this.bcryptRounds);

    // Create user
    const user: IUser = {
      id: uuidv4(),
      email: data.email,
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.PENDING,
      profile: {
        displayName: data.profile?.displayName,
        firstName: data.profile?.firstName,
        lastName: data.profile?.lastName,
      },
      settings: {
        twoFactorEnabled: false,
        emailNotifications: data.settings?.emailNotifications || true,
        theme: data.settings?.theme || 'light' as const,
        timezone: data.settings?.timezone || 'UTC',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Store user
    await this.storage.put(`user:${user.id}`, user);
    await this.storage.put(`user:email:${user.email}`, user.id);

    return user;
  }

  /**
   * Login user
   */
  public async login(data: UserLoginType): Promise<{ user: IUser; token: string }> {
    // Get user by email
    const userIdWrapper = await this.storage.get<string>(`user:email:${data.email}`);
    if (!userIdWrapper?.data) {
      throw new Error('Invalid credentials');
    }

    const userWrapper = await this.storage.get<IUser>(`user:${userIdWrapper.data}`);
    if (!userWrapper?.data) {
      throw new Error('User not found');
    }

    const user = userWrapper.data;

    // Check password
    const isValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Check 2FA if enabled
    if (user.settings.twoFactorEnabled && !data.twoFactorCode) {
      throw new Error('Two-factor authentication required');
    }

    // Update last login
    user.lastLoginAt = Date.now();
    await this.storage.put(`user:${user.id}`, user);

    // Generate token
    const token = jwt.sign({ userId: user.id }, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
    });

    return { user, token };
  }

  /**
   * Get user by ID
   */
  public async getUser(userId: string): Promise<IUser | null> {
    const userWrapper = await this.storage.get<IUser>(`user:${userId}`);
    return userWrapper?.data || null;
  }

  /**
   * Update user profile
   */
  public async updateProfile(userId: string, data: UserProfileUpdateType): Promise<IUser> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.profile = {
      ...user.profile,
      ...data,
    };
    user.updatedAt = Date.now();

    await this.storage.put(`user:${user.id}`, user);
    return user;
  }

  /**
   * Update user settings
   */
  public async updateSettings(userId: string, data: UserSettingsUpdateType): Promise<IUser> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.settings = {
      ...user.settings,
      ...data,
    };
    user.updatedAt = Date.now();

    await this.storage.put(`user:${user.id}`, user);
    return user;
  }

  /**
   * Change password
   */
  public async changePassword(userId: string, data: PasswordChangeType): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid current password');
    }

    // Hash new password
    user.passwordHash = await bcrypt.hash(data.newPassword, this.bcryptRounds);
    user.updatedAt = Date.now();

    await this.storage.put(`user:${user.id}`, user);
  }

  /**
   * Request password reset
   */
  public async requestPasswordReset(data: PasswordResetRequestType): Promise<string> {
    const userIdWrapper = await this.storage.get<string>(`user:email:${data.email}`);
    if (!userIdWrapper?.data) {
      throw new Error('User not found');
    }

    // Generate reset token
    const resetToken = uuidv4();
    const resetData: IResetTokenData = {
      userId: userIdWrapper.data,
      expiresAt: Date.now() + 3600000, // 1 hour
    };

    // Store reset token
    await this.storage.put(`reset:${resetToken}`, resetData);

    return resetToken;
  }

  /**
   * Reset password
   */
  public async resetPassword(data: PasswordResetType): Promise<void> {
    // Get reset token data
    const resetDataWrapper = await this.storage.get<IResetTokenData>(`reset:${data.token}`);
    if (!resetDataWrapper?.data) {
      throw new Error('Invalid reset token');
    }

    const resetData = resetDataWrapper.data;

    // Check expiration
    if (resetData.expiresAt < Date.now()) {
      throw new Error('Reset token expired');
    }

    const user = await this.getUser(resetData.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Hash new password
    user.passwordHash = await bcrypt.hash(data.newPassword, this.bcryptRounds);
    user.updatedAt = Date.now();

    // Update user and remove reset token
    await this.storage.put(`user:${user.id}`, user);
    await this.storage.del(`reset:${data.token}`);
  }

  /**
   * Verify JWT token
   */
  public verifyToken(token: string): { userId: string } {
    try {
      return jwt.verify(token, this.jwtSecret) as { userId: string };
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
} 