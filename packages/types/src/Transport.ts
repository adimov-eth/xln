/**
 * Message types for transport layer
 */
export enum MessageType {
  STATE_UPDATE = 'state_update',
  PAYMENT_REQUEST = 'PAYMENT_REQUEST',
  PAYMENT_RESPONSE = 'PAYMENT_RESPONSE',
  SWAP_REQUEST = 'swap_request',
  SWAP_RESPONSE = 'swap_response',
  DISPUTE_NOTIFICATION = 'dispute_notification',
  DISPUTE_CHALLENGE = 'dispute_challenge',
  DISPUTE_RESOLUTION = 'dispute_resolution',
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error',
}

/**
 * Base message interface
 */
export interface IMessage {
  type: MessageType;
  channelId: string;
  sender: string;
  recipient: string;
  timestamp: number;
}

/**
 * State update message
 */
export interface IStateUpdateMessage extends IMessage {
  type: MessageType.STATE_UPDATE;
  channelId: string;
  state: unknown;
  nonce: number;
}

/**
 * Payment request message
 */
export interface IPaymentRequestMessage extends IMessage {
  type: MessageType.PAYMENT_REQUEST;
  channelId: string;
  amount: string;
  tokenId: string;
  hashlock: string;
  timelock: number;
  encryptedData?: string;
}

/**
 * Payment response message
 */
export interface IPaymentResponseMessage extends IMessage {
  type: MessageType.PAYMENT_RESPONSE;
  channelId: string;
  paymentId: string;
  status: 'accepted' | 'rejected';
  reason?: string;
}

/**
 * Swap request message
 */
export interface ISwapRequestMessage extends IMessage {
  type: MessageType.SWAP_REQUEST;
  channelId: string;
  tokenIdA: string;
  tokenIdB: string;
  amountA: string;
  amountB: string;
  timelock: number;
}

/**
 * Swap response message
 */
export interface ISwapResponseMessage extends IMessage {
  type: MessageType.SWAP_RESPONSE;
  channelId: string;
  swapId: string;
  status: 'accepted' | 'rejected';
  reason?: string;
}

/**
 * Dispute notification message
 */
export interface IDisputeNotificationMessage extends IMessage {
  type: MessageType.DISPUTE_NOTIFICATION;
  channelId: string;
  disputeId: string;
  evidence?: string;
}

/**
 * Dispute challenge message
 */
export interface IDisputeChallengeMessage extends IMessage {
  type: MessageType.DISPUTE_CHALLENGE;
  channelId: string;
  disputeId: string;
  challengeState: unknown;
}

/**
 * Dispute resolution message
 */
export interface IDisputeResolutionMessage extends IMessage {
  type: MessageType.DISPUTE_RESOLUTION;
  channelId: string;
  disputeId: string;
  resolution: 'initiator_wins' | 'respondent_wins' | 'split';
  finalState: unknown;
}

/**
 * Error message interface
 */
export interface IErrorMessage extends IMessage {
  type: MessageType.ERROR;
  error: string;
}

/**
 * Transport options interface
 */
export interface ITransportOptions {
  host?: string;
  port?: number;
  ssl?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

/**
 * Transport event types
 */
export enum TransportEventType {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  MESSAGE = 'message',
  ERROR = 'error',
}

/**
 * Transport event interface
 */
export interface ITransportEvent {
  type: TransportEventType;
  data?: IMessage;
  error?: Error;
}

/**
 * Transport event handler type
 */
export type TransportEventHandler = (event: ITransportEvent) => void;

/**
 * Transport interface
 */
export interface ITransport {
  /**
   * Connects to the transport network
   */
  connect(): Promise<void>;

  /**
   * Disconnects from the transport network
   */
  disconnect(): Promise<void>;

  /**
   * Sends a message to a peer
   */
  send(message: IMessage): Promise<void>;

  /**
   * Subscribes to transport events
   */
  subscribe(handler: TransportEventHandler): void;

  /**
   * Unsubscribes from transport events
   */
  unsubscribe(handler: TransportEventHandler): void;

  /**
   * Gets the connection status
   */
  isConnected(): boolean;

  /**
   * Gets the local node address
   */
  getAddress(): string;
}

/**
 * Transport metrics interface
 */
export interface ITransportMetrics {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  compressionRatio: number;
  batchSize: number;
  latency: number;
  reconnectAttempts: number;
  lastPingTime?: number;
  lastPongTime?: number;
}
