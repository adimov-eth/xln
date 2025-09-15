/**
 * P2P Networking Layer for XLN
 *
 * Implements efficient gossip protocol for bilateral sovereignty:
 * - Direct peer connections (no DHT needed)
 * - Channel state gossip
 * - Dispute propagation
 * - Network discovery
 * - NAT traversal
 */

import { WebSocket, WebSocketServer } from 'ws';
import { createHash, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import dgram from 'dgram';

export interface P2PConfig {
  nodeId: string;
  listenPort: number;
  bootstrapPeers: string[];
  maxPeers: number;
  gossipInterval: number; // ms
  heartbeatInterval: number; // ms
  natTraversal: boolean;
  encryption: boolean;
}

export interface Peer {
  nodeId: string;
  endpoint: string;
  ws?: WebSocket;
  lastSeen: number;
  reputation: number;
  channels: Set<string>;
  latency: number;
  version: string;
}

export interface GossipMessage {
  type: 'channel_update' | 'dispute' | 'peer_announce' | 'heartbeat';
  sender: string;
  timestamp: number;
  data: any;
  signature?: string;
  ttl: number;
}

export interface ChannelGossip {
  channelKey: string;
  leftEntity: string;
  rightEntity: string;
  status: string;
  lastUpdate: number;
  proofHash?: string;
}

export class P2PNetwork extends EventEmitter {
  private config: P2PConfig;
  private peers: Map<string, Peer> = new Map();
  private seenMessages: Map<string, number> = new Map();
  private server?: WebSocketServer;
  private udpSocket?: dgram.Socket;
  private gossipTimer?: NodeJS.Timer;
  private heartbeatTimer?: NodeJS.Timer;

  // Network metrics
  private metrics = {
    messagesReceived: 0,
    messagesSent: 0,
    bytesReceived: 0n,
    bytesSent: 0n,
    peersConnected: 0,
    peersDiscovered: 0
  };

  constructor(config: P2PConfig) {
    super();
    this.config = config;
  }

  /**
   * Start P2P network
   */
  async start(): Promise<void> {
    console.log(`🌐 Starting P2P node ${this.config.nodeId}`);

    // Start WebSocket server
    await this.startServer();

    // Start UDP socket for NAT traversal
    if (this.config.natTraversal) {
      await this.startUDPSocket();
    }

    // Connect to bootstrap peers
    await this.connectToBootstrap();

    // Start gossip protocol
    this.startGossip();

    // Start heartbeat
    this.startHeartbeat();

    console.log(`✅ P2P network started on port ${this.config.listenPort}`);
  }

  /**
   * Connect to peer
   */
  async connectToPeer(endpoint: string): Promise<void> {
    if (this.peers.size >= this.config.maxPeers) {
      return;
    }

    try {
      const ws = new WebSocket(endpoint);

      ws.on('open', () => {
        // Send handshake
        this.sendHandshake(ws);
      });

      ws.on('message', (data) => {
        this.handleMessage(ws, data);
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error(`Peer connection error: ${error.message}`);
      });

    } catch (error) {
      console.error(`Failed to connect to ${endpoint}: ${error.message}`);
    }
  }

  /**
   * Broadcast message to all peers
   */
  broadcast(message: GossipMessage): void {
    const messageId = this.getMessageId(message);

    // Check if we've seen this message
    if (this.seenMessages.has(messageId)) {
      return;
    }

    // Mark as seen
    this.seenMessages.set(messageId, Date.now());

    // Clean old messages
    this.cleanSeenMessages();

    // Broadcast to all connected peers
    const serialized = JSON.stringify(message);
    const buffer = Buffer.from(serialized);

    for (const peer of this.peers.values()) {
      if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(buffer);
        this.metrics.messagesSent++;
        this.metrics.bytesSent += BigInt(buffer.length);
      }
    }
  }

  /**
   * Gossip channel update
   */
  gossipChannelUpdate(channel: ChannelGossip): void {
    const message: GossipMessage = {
      type: 'channel_update',
      sender: this.config.nodeId,
      timestamp: Date.now(),
      data: channel,
      ttl: 3
    };

    if (this.config.encryption) {
      message.signature = this.signMessage(message);
    }

    this.broadcast(message);
  }

  /**
   * Gossip dispute
   */
  gossipDispute(dispute: any): void {
    const message: GossipMessage = {
      type: 'dispute',
      sender: this.config.nodeId,
      timestamp: Date.now(),
      data: dispute,
      ttl: 5 // Higher TTL for disputes
    };

    if (this.config.encryption) {
      message.signature = this.signMessage(message);
    }

    this.broadcast(message);
    this.emit('dispute', dispute);
  }

  /**
   * Find peers for channel
   */
  findChannelPeers(channelKey: string): Peer[] {
    const peers: Peer[] = [];

    for (const peer of this.peers.values()) {
      if (peer.channels.has(channelKey)) {
        peers.push(peer);
      }
    }

    return peers;
  }

  /**
   * Get network stats
   */
  getStats(): any {
    return {
      nodeId: this.config.nodeId,
      peers: this.peers.size,
      maxPeers: this.config.maxPeers,
      ...this.metrics,
      avgLatency: this.calculateAverageLatency(),
      topology: this.getNetworkTopology()
    };
  }

  // Private methods

  private async startServer(): Promise<void> {
    this.server = new WebSocketServer({
      port: this.config.listenPort,
      perMessageDeflate: true
    });

    this.server.on('connection', (ws, req) => {
      const endpoint = `${req.socket.remoteAddress}:${req.socket.remotePort}`;

      ws.on('message', (data) => {
        this.handleMessage(ws, data);
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error(`Server connection error: ${error.message}`);
      });
    });
  }

  private async startUDPSocket(): Promise<void> {
    this.udpSocket = dgram.createSocket('udp4');

    this.udpSocket.on('message', (msg, rinfo) => {
      this.handleUDPMessage(msg, rinfo);
    });

    this.udpSocket.bind(this.config.listenPort);
  }

  private async connectToBootstrap(): Promise<void> {
    for (const endpoint of this.config.bootstrapPeers) {
      await this.connectToPeer(endpoint);
    }
  }

  private startGossip(): void {
    this.gossipTimer = setInterval(() => {
      this.performGossipRound();
    }, this.config.gossipInterval);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  private performGossipRound(): void {
    // Select random subset of peers
    const peers = Array.from(this.peers.values());
    const selectedPeers = this.selectRandomPeers(peers, 3);

    // Send peer announcements
    for (const peer of selectedPeers) {
      this.sendPeerAnnouncement(peer);
    }

    // Emit gossip event
    this.emit('gossip_round', selectedPeers.length);
  }

  private sendHeartbeat(): void {
    const message: GossipMessage = {
      type: 'heartbeat',
      sender: this.config.nodeId,
      timestamp: Date.now(),
      data: {
        peers: this.peers.size,
        channels: this.getKnownChannels().size
      },
      ttl: 1
    };

    this.broadcast(message);
  }

  private sendHandshake(ws: WebSocket): void {
    const handshake = {
      type: 'handshake',
      nodeId: this.config.nodeId,
      version: '1.0.0',
      timestamp: Date.now(),
      channels: Array.from(this.getKnownChannels())
    };

    ws.send(JSON.stringify(handshake));
  }

  private handleMessage(ws: WebSocket, data: any): void {
    try {
      const message = JSON.parse(data.toString());
      this.metrics.messagesReceived++;
      this.metrics.bytesReceived += BigInt(data.length);

      // Handle handshake
      if (message.type === 'handshake') {
        this.handleHandshake(ws, message);
        return;
      }

      // Handle gossip message
      if (message.type && message.sender) {
        this.handleGossipMessage(message as GossipMessage);
      }

    } catch (error) {
      console.error(`Invalid message: ${error.message}`);
    }
  }

  private handleHandshake(ws: WebSocket, handshake: any): void {
    const peer: Peer = {
      nodeId: handshake.nodeId,
      endpoint: ws.url || '',
      ws,
      lastSeen: Date.now(),
      reputation: 100,
      channels: new Set(handshake.channels || []),
      latency: 0,
      version: handshake.version
    };

    this.peers.set(handshake.nodeId, peer);
    this.metrics.peersConnected++;

    console.log(`👋 Peer connected: ${handshake.nodeId}`);
    this.emit('peer_connected', peer);
  }

  private handleGossipMessage(message: GossipMessage): void {
    // Check message ID
    const messageId = this.getMessageId(message);
    if (this.seenMessages.has(messageId)) {
      return;
    }

    // Mark as seen
    this.seenMessages.set(messageId, Date.now());

    // Verify signature if encrypted
    if (this.config.encryption && message.signature) {
      if (!this.verifyMessage(message)) {
        console.warn(`Invalid signature from ${message.sender}`);
        return;
      }
    }

    // Handle by type
    switch (message.type) {
      case 'channel_update':
        this.handleChannelUpdate(message.data);
        break;

      case 'dispute':
        this.handleDispute(message.data);
        break;

      case 'peer_announce':
        this.handlePeerAnnouncement(message.data);
        break;

      case 'heartbeat':
        this.handleHeartbeat(message.sender, message.data);
        break;
    }

    // Propagate if TTL > 0
    if (message.ttl > 0) {
      message.ttl--;
      this.broadcast(message);
    }
  }

  private handleChannelUpdate(channel: ChannelGossip): void {
    // Update known channels
    const peer = this.peers.get(channel.leftEntity) ||
                 this.peers.get(channel.rightEntity);

    if (peer) {
      peer.channels.add(channel.channelKey);
    }

    this.emit('channel_update', channel);
  }

  private handleDispute(dispute: any): void {
    // High priority propagation
    this.emit('dispute', dispute);
  }

  private handlePeerAnnouncement(announcement: any): void {
    // Discover new peers
    if (!this.peers.has(announcement.nodeId)) {
      this.metrics.peersDiscovered++;

      if (this.peers.size < this.config.maxPeers) {
        this.connectToPeer(announcement.endpoint);
      }
    }
  }

  private handleHeartbeat(sender: string, data: any): void {
    const peer = this.peers.get(sender);
    if (peer) {
      peer.lastSeen = Date.now();

      // Calculate latency
      if (data.timestamp) {
        peer.latency = Date.now() - data.timestamp;
      }
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    // Find and remove peer
    for (const [nodeId, peer] of this.peers) {
      if (peer.ws === ws) {
        this.peers.delete(nodeId);
        this.metrics.peersConnected--;
        console.log(`👋 Peer disconnected: ${nodeId}`);
        this.emit('peer_disconnected', peer);
        break;
      }
    }
  }

  private handleUDPMessage(msg: Buffer, rinfo: any): void {
    // Handle NAT traversal
    try {
      const message = JSON.parse(msg.toString());

      if (message.type === 'nat_punch') {
        // Establish direct connection
        const endpoint = `ws://${rinfo.address}:${message.port}`;
        this.connectToPeer(endpoint);
      }
    } catch (error) {
      // Invalid UDP message
    }
  }

  private sendPeerAnnouncement(peer: Peer): void {
    const announcement = {
      type: 'peer_announce',
      sender: this.config.nodeId,
      timestamp: Date.now(),
      data: {
        nodeId: peer.nodeId,
        endpoint: peer.endpoint,
        channels: Array.from(peer.channels).slice(0, 10) // Limit size
      },
      ttl: 2
    };

    this.broadcast(announcement as GossipMessage);
  }

  private getMessageId(message: GossipMessage): string {
    const hash = createHash('sha256');
    hash.update(message.type);
    hash.update(message.sender);
    hash.update(message.timestamp.toString());
    hash.update(JSON.stringify(message.data));
    return hash.digest('hex').slice(0, 16);
  }

  private signMessage(message: GossipMessage): string {
    // Simplified - would use actual crypto
    const hash = createHash('sha256');
    hash.update(JSON.stringify(message));
    return hash.digest('hex');
  }

  private verifyMessage(message: GossipMessage): boolean {
    // Simplified - would verify actual signature
    return true;
  }

  private selectRandomPeers(peers: Peer[], count: number): Peer[] {
    const shuffled = peers.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  private getKnownChannels(): Set<string> {
    const channels = new Set<string>();

    for (const peer of this.peers.values()) {
      for (const channel of peer.channels) {
        channels.add(channel);
      }
    }

    return channels;
  }

  private calculateAverageLatency(): number {
    if (this.peers.size === 0) return 0;

    let totalLatency = 0;
    let count = 0;

    for (const peer of this.peers.values()) {
      if (peer.latency > 0) {
        totalLatency += peer.latency;
        count++;
      }
    }

    return count > 0 ? totalLatency / count : 0;
  }

  private getNetworkTopology(): any {
    const nodes = [this.config.nodeId, ...Array.from(this.peers.keys())];
    const edges: any[] = [];

    // Create edges from connections
    for (const peer of this.peers.values()) {
      edges.push({
        from: this.config.nodeId,
        to: peer.nodeId,
        latency: peer.latency
      });
    }

    return { nodes, edges };
  }

  private cleanSeenMessages(): void {
    const now = Date.now();
    const maxAge = 60000; // 1 minute

    for (const [id, timestamp] of this.seenMessages) {
      if (now - timestamp > maxAge) {
        this.seenMessages.delete(id);
      }
    }
  }

  /**
   * Stop P2P network
   */
  async stop(): Promise<void> {
    // Clear timers
    if (this.gossipTimer) clearInterval(this.gossipTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Close connections
    for (const peer of this.peers.values()) {
      if (peer.ws) {
        peer.ws.close();
      }
    }

    // Close server
    if (this.server) {
      this.server.close();
    }

    // Close UDP socket
    if (this.udpSocket) {
      this.udpSocket.close();
    }

    console.log('🛑 P2P network stopped');
  }
}