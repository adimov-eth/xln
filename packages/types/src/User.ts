import { z } from 'zod';

/**
 * User role enum
 */
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

/**
 * User status enum
 */
export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

/**
 * Base user interface
 */
export interface IUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  profile: IUserProfile;
  settings: IUserSettings;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
}

/**
 * User profile interface
 */
export interface IUserProfile {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  bio?: string;
}

/**
 * User settings interface
 */
export interface IUserSettings {
  twoFactorEnabled: boolean;
  emailNotifications: boolean;
  theme: 'light' | 'dark';
  timezone: string;
}

/**
 * User registration validation schema
 */
export const UserRegistrationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  profile: z.object({
    displayName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }).optional(),
  settings: z.object({
    emailNotifications: z.boolean().optional(),
    theme: z.enum(['light', 'dark']).optional(),
    timezone: z.string().optional(),
  }).optional(),
});

/**
 * User login validation schema
 */
export const UserLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  twoFactorCode: z.string().optional(),
});

/**
 * User profile update validation schema
 */
export const UserProfileUpdateSchema = z.object({
  displayName: z.string().min(3).optional(),
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  avatar: z.string().url().optional(),
  bio: z.string().max(500).optional(),
});

/**
 * User settings update validation schema
 */
export const UserSettingsUpdateSchema = z.object({
  twoFactorEnabled: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  timezone: z.string().optional(),
});

/**
 * Password change validation schema
 */
export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/),
});

/**
 * Password reset request validation schema
 */
export const PasswordResetRequestSchema = z.object({
  email: z.string().email(),
});

/**
 * Password reset validation schema
 */
export const PasswordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/),
});

/**
 * User registration type
 */
export type UserRegistrationType = z.infer<typeof UserRegistrationSchema>;

/**
 * User login type
 */
export type UserLoginType = z.infer<typeof UserLoginSchema>;

/**
 * User profile update type
 */
export type UserProfileUpdateType = z.infer<typeof UserProfileUpdateSchema>;

/**
 * User settings update type
 */
export type UserSettingsUpdateType = z.infer<typeof UserSettingsUpdateSchema>;

/**
 * Password change type
 */
export type PasswordChangeType = z.infer<typeof PasswordChangeSchema>;

/**
 * Password reset request type
 */
export type PasswordResetRequestType = z.infer<typeof PasswordResetRequestSchema>;

/**
 * Password reset type
 */
export type PasswordResetType = z.infer<typeof PasswordResetSchema>;
