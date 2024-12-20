import { z } from 'zod';

/**
 * Payment status enum
 */
export enum PaymentStatus {
  PENDING = 'pending',
  SETTLED = 'settled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/**
 * Base payment interface
 */
export interface IPayment {
  id: string;
  channelId: string;
  chainId: number;
  tokenId: string;
  amount: string;
  status: PaymentStatus;
  secret?: string;
  timelock: number;
  encryptedData?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payment request validation schema
 */
export const PaymentRequest = z.object({
  channelId: z.string(),
  chainId: z.number(),
  tokenId: z.string(),
  amount: z.string(),
  secret: z.string(),
  timelock: z.number(),
  encryptedData: z.string().optional(),
});

/**
 * Payment settlement validation schema
 */
export const PaymentSettlement = z.object({
  channelId: z.string(),
  chainId: z.number(),
  tokenId: z.string(),
  amount: z.string(),
  secret: z.string(),
});

/**
 * Payment cancellation validation schema
 */
export const PaymentCancellation = z.object({
  channelId: z.string(),
  chainId: z.number(),
  tokenId: z.string(),
  amount: z.string(),
  timelock: z.number(),
});

/**
 * Payment request type
 */
export type PaymentRequestType = z.infer<typeof PaymentRequest>;

/**
 * Payment settlement type
 */
export type PaymentSettlementType = z.infer<typeof PaymentSettlement>;

/**
 * Payment cancellation type
 */
export type PaymentCancellationType = z.infer<typeof PaymentCancellation>;
