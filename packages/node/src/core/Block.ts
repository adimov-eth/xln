import { ITransition } from './Transition';

/**
 * Interface representing a block of transitions in the payment channel.
 * Blocks are used to batch multiple transitions together for efficient processing
 * and synchronization between channel participants.
 */
export interface IBlock {
  /** Unique identifier for the block */
  blockId: number;
  /** Indicates whether the block was initiated by the left participant */
  isLeft: boolean;
  /** Unix timestamp when the block was created */
  timestamp: number;
  /** Array of transitions to be applied in sequence */
  transitions: ITransition[]; // Using proper type from Transition.ts
} 