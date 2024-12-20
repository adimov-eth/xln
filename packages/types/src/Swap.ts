export interface ISwap {
  id: string;
  channelId: string;
  chainId: number;
  tokenIdA: string;
  tokenIdB: string;
  amountA: string;
  amountB: string;
  initiator: string;
  timelock: number;
  status: 'active' | 'settled' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}
