import { type OutboxMessage, type ServerTx } from './types';

export interface RouterConfig {
    localSigners: Set<number>;
    remoteEndpoints: Map<number, string>; // signerIndex -> websocket URL
  }
  
  export class MessageRouter {
    private config: RouterConfig;
    private localDelivery: (tx: ServerTx) => void;
    
    constructor(config: RouterConfig, localDelivery: (tx: ServerTx) => void) {
      this.config = config;
      this.localDelivery = localDelivery;
    }
    
    async route(messages: OutboxMessage[]): Promise<void> {
      const localMessages: ServerTx[] = [];
      const remoteMessages = new Map<number, OutboxMessage[]>();
      
      // Sort messages by destination
      for (const msg of messages) {
        if (this.config.localSigners.has(msg.toSigner)) {
          // Local delivery
          localMessages.push({
            signerIndex: msg.toSigner,
            entityId: msg.toEntity,
            input: msg.payload
          });
        } else {
          // Remote delivery
          const signerMessages = remoteMessages.get(msg.toSigner) || [];
          signerMessages.push(msg);
          remoteMessages.set(msg.toSigner, signerMessages);
        }
      }
      
      // Deliver local messages immediately
      for (const tx of localMessages) {
        this.localDelivery(tx);
      }
      
      // Queue remote messages (would implement WebSocket delivery)
      for (const [signer, msgs] of remoteMessages) {
        const endpoint = this.config.remoteEndpoints.get(signer);
        if (endpoint) {
          // In production: await this.sendViaWebSocket(endpoint, msgs);
          console.log(`Would send ${msgs.length} messages to signer ${signer} at ${endpoint}`);
        }
      }
    }
  }