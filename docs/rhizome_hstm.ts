import { createHash } from 'crypto';
import {
  TransactionType,
  ChannelStatus,
  MerkleTreeImpl,
  NodeStateEnum
} from './fractal_hstm.js';
import type {
  Transaction,
  TransferData,
  ChannelOpenData,
  ChannelCloseData,
  ChannelUpdateData,
  StateUpdateData,
  ChannelState,
  MerkleProof,
  NodeState
} from './fractal_hstm.js';

/**
 * Core node structure that can be infinitely nested
 */
export interface FractalNode<T> {
  id: string;                 // Unique identifier
  hash: string;              // Merkle hash of the node
  parent?: string;           // Parent node ID
  children: string[];        // Child node IDs
  siblings: string[];        // Sibling node IDs (same level)
  depth: number;             // Depth in the fractal tree
  scale: number;             // Current scale factor (powers of 2)
  timestamp: number;         // Creation/update timestamp
  data: T;                   // Actual node data
  metadata: NodeMetadata;    // Node metadata
  state: NodeState;          // Current state data
  status: NodeStateEnum;     // Current state enum
}

interface NodeMetadata {
  version: number;           // Node version
  type: NodeType;           // Type of node
  transitions: number;      // Number of state transitions
  lastTransition: number;   // Last transition timestamp
  metrics: NodeMetrics;     // Performance metrics
}

interface NodeMetrics {
  processedTx: number;      // Number of processed transactions
  childrenCount: number;    // Number of child nodes
  depth: number;            // Current depth
  maxDepth: number;         // Maximum depth reached
  avgProcessingTime: number;// Average processing time
  lastProcessed: number;    // Last processing timestamp
}

enum NodeType {
  ROOT = 'ROOT',           // Top-level node
  BRANCH = 'BRANCH',      // Intermediate node
  LEAF = 'LEAF',          // Bottom-level node
  BRIDGE = 'BRIDGE'       // Cross-reference node
}

interface ProcessingResult {
  success: boolean;
  error?: string;
  path: string[];  // Required and initialized as empty array
}

/**
 * RhizomeHSTM: Implementation of HSTM using fractal-rhizome patterns
 * for infinite scalability and self-similarity
 */
export class RhizomeHSTM {
  private nodes: Map<string, FractalNode<any>>;
  private connections: Map<string, Set<string>>;
  private merkleTree: MerkleTreeImpl;
  private metrics: HSTMMetrics;

  constructor() {
    this.nodes = new Map();
    this.connections = new Map();
    this.merkleTree = new MerkleTreeImpl();
    this.metrics = new HSTMMetrics();
  }

  /**
   * Creates a new node in the HSTM structure
   */
  createNode(data: any, type: NodeType, parentId?: string): string {
    const nodeId = this.generateNodeId();
    
    const node: FractalNode<any> = {
      id: nodeId,
      hash: '',
      parent: parentId,
      children: [],
      siblings: [],
      depth: parentId ? this.getNode(parentId).depth + 1 : 0,
      scale: 1,
      timestamp: Date.now(),
      data: data,
      metadata: {
        version: 1,
        type: type,
        transitions: 0,
        lastTransition: Date.now(),
        metrics: {
          processedTx: 0,
          childrenCount: 0,
          depth: parentId ? this.getNode(parentId).depth + 1 : 0,
          maxDepth: parentId ? this.getNode(parentId).depth + 1 : 0,
          avgProcessingTime: 0,
          lastProcessed: Date.now()
        }
      },
      state: {
        balances: new Map(),
        channels: new Map(),
        nonce: 0,
        lastUpdate: Date.now(),
        stateRoot: ''
      },
      status: NodeStateEnum.ACTIVE
    };

    // Calculate initial hash
    node.hash = this.calculateNodeHash(node);

    // Add to nodes map
    this.nodes.set(nodeId, node);

    // Update parent if exists
    if (parentId) {
      const parent = this.getNode(parentId);
      parent.children.push(nodeId);
      parent.metadata.metrics.childrenCount++;
      this.updateNodeHash(parentId);
    }

    // Add to Merkle tree
    this.merkleTree.addLeaf(node);

    // Update metrics
    this.metrics.totalNodes++;
    this.metrics.activeNodes++;

    return nodeId;
  }

  /**
   * Connects two nodes in the HSTM structure
   */
  connect(nodeId1: string, nodeId2: string, isBidirectional: boolean = false): void {
    // Get nodes
    const node1 = this.getNode(nodeId1);
    const node2 = this.getNode(nodeId2);

    // Create or get connection sets
    let connections1 = this.connections.get(nodeId1);
    if (!connections1) {
      connections1 = new Set();
      this.connections.set(nodeId1, connections1);
    }

    // Add connection
    connections1.add(nodeId2);
    node1.siblings.push(nodeId2);

    if (isBidirectional) {
      let connections2 = this.connections.get(nodeId2);
      if (!connections2) {
        connections2 = new Set();
        this.connections.set(nodeId2, connections2);
      }
      connections2.add(nodeId1);
      node2.siblings.push(nodeId1);
    }

    // Update hashes
    this.updateNodeHash(nodeId1);
    this.updateNodeHash(nodeId2);

    // Update metrics
    this.metrics.totalConnections++;
  }

  /**
   * Processes a transaction through the HSTM structure
   */
  processTransaction(transaction: Transaction): ProcessingResult {
    console.log(`Processing transaction: ${transaction.type}`);

    // Validate transaction
    if (!this.validateTransaction(transaction)) {
      return {
        success: false,
        error: 'Invalid transaction',
        path: []
      };
    }

    // Verify signature
    if (!this.verifySignature(transaction)) {
      return {
        success: false,
        error: 'Invalid signature',
        path: []
      };
    }

    // Start from root nodes (nodes without parents)
    const rootNodes = Array.from(this.nodes.values())
      .filter(node => !node.parent);

    // Try processing at each root node
    for (const rootNode of rootNodes) {
      const result = this.processAtNode(rootNode, transaction);
      if (result.success) {
        // Update metrics
        this.metrics.totalTransactions++;
        return result;
      }
    }

    return {
      success: false,
      error: 'No suitable processing path found',
      path: []
    };
  }

  /**
   * Checks if a node is suitable for processing a transaction
   */
  private isNodeSuitable(node: FractalNode<any>, transaction: Transaction): boolean {
    if (!node || node.status !== NodeStateEnum.ACTIVE) {
      return false;
    }

    // Check node type compatibility
    switch (node.metadata.type) {
      case NodeType.ROOT:
        return true; // Root nodes can process all transactions
      case NodeType.BRANCH:
        return transaction.type === TransactionType.TRANSFER ||
               transaction.type === TransactionType.CHANNEL_UPDATE;
      case NodeType.LEAF:
        return transaction.type === TransactionType.TRANSFER ||
               transaction.type === TransactionType.CHANNEL_OPEN ||
               transaction.type === TransactionType.CHANNEL_CLOSE;
      case NodeType.BRIDGE:
        return transaction.type === TransactionType.TRANSFER ||
               transaction.type === TransactionType.CHANNEL_UPDATE;
      default:
        return false;
    }
  }

  private findNextNode(node: FractalNode<any>, transaction: Transaction): FractalNode<any> | null {
    // Implementation of node finding logic
    return null;
  }

  private routeTransaction(node: FractalNode<any>, transaction: Transaction): boolean {
    try {
      const nextNode = this.findNextNode(node, transaction);
      if (!nextNode) {
        return false;
      }
      return true;
    } catch (err: any) {
      console.error('Routing error:', err?.message);
      return false;
    }
  }

  private routeTransfer(node: FractalNode<any>, data: TransferData): boolean {
    return this.routeTransaction(node, {
      type: TransactionType.TRANSFER,
      data,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    });
  }

  private routeChannelOpen(node: FractalNode<any>, data: ChannelOpenData): boolean {
    return this.routeTransaction(node, {
      type: TransactionType.CHANNEL_OPEN,
      data,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    });
  }

  private routeChannelUpdate(node: FractalNode<any>, data: ChannelUpdateData): boolean {
    return this.routeTransaction(node, {
      type: TransactionType.CHANNEL_UPDATE,
      data,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    });
  }

  private routeChannelClose(node: FractalNode<any>, data: ChannelCloseData): boolean {
    return this.routeTransaction(node, {
      type: TransactionType.CHANNEL_CLOSE,
      data,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    });
  }

  private applyStateUpdate(node: FractalNode<any>, key: string, value: any): void {
    const path = key.split('.');
    let current: any = node.state;

    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {};
      }
      current = current[path[i]];
    }

    current[path[path.length - 1]] = value;
  }

  private findEntryNode(transaction: Transaction): FractalNode<any> | null {
    let bestNode: FractalNode<any> | null = null;
    let bestScore = -1;

    for (const [_, node] of this.nodes) {
      if (node.status !== NodeStateEnum.ACTIVE) continue;

      const score = this.calculateNodeScore(node, transaction);
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }

  private calculateNodeScore(node: FractalNode<any>, transaction: Transaction): number {
    let score = 0;

    score += node.metadata.metrics.avgProcessingTime < 100 ? 10 : 0;
    score += node.metadata.metrics.processedTx < 1000 ? 5 : 0;
    score += node.depth < 5 ? 8 : 0;

    const nodeTypeToTxType: Record<NodeType, TransactionType> = {
      [NodeType.ROOT]: TransactionType.STATE_UPDATE,
      [NodeType.BRANCH]: TransactionType.TRANSFER,
      [NodeType.LEAF]: TransactionType.TRANSFER,
      [NodeType.BRIDGE]: TransactionType.CHANNEL_UPDATE
    };

    if (transaction.type === nodeTypeToTxType[node.metadata.type]) {
      score += 15;
    }

    score *= (1 / node.scale);

    return score;
  }

  private updateNodeHash(nodeId: string): void {
    const node = this.getNode(nodeId);
    const oldHash = node.hash;
    
    const newHash = this.calculateNodeHash(node);
    
    if (oldHash !== newHash) {
      node.hash = newHash;
      
      if (node.parent) {
        this.updateNodeHash(node.parent);
      }
      
      this.merkleTree.updateNode(nodeId, newHash);
    }
  }

  private calculateNodeHash(node: FractalNode<any>): string {
    const elements = [
      node.id,
      node.parent || '',
      ...node.children,
      ...node.siblings,
      node.depth.toString(),
      node.scale.toString(),
      node.timestamp.toString(),
      JSON.stringify(node.data),
      JSON.stringify(node.metadata),
      JSON.stringify(node.state),
      node.status
    ];

    return createHash('sha256')
      .update(elements.join('|'))
      .digest('hex');
  }

  private getNode(nodeId: string): FractalNode<any> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    return node;
  }

  private generateNodeId(): string {
    return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private validateTransaction(transaction: Transaction): ProcessingResult {
    if (!transaction || !transaction.type || !transaction.data) {
      return { success: false, error: 'Invalid transaction', path: [] };
    }

    try {
      let isValid = false;
      switch (transaction.type) {
        case TransactionType.TRANSFER:
          isValid = this.validateTransfer(transaction.data as TransferData);
          break;
        case TransactionType.CHANNEL_OPEN:
          isValid = this.validateChannelOpen(transaction.data as ChannelOpenData);
          break;
        case TransactionType.CHANNEL_UPDATE:
          isValid = this.validateChannelUpdate(transaction.data as ChannelUpdateData);
          break;
        case TransactionType.CHANNEL_CLOSE:
          isValid = this.validateChannelClose(transaction.data as ChannelCloseData);
          break;
        case TransactionType.STATE_UPDATE:
          isValid = this.validateStateUpdate(transaction.data as unknown as StateUpdateData);
          break;
        default:
          isValid = false;
      }
      return {
        success: isValid,
        error: isValid ? undefined : 'Validation failed',
        path: []
      };
    } catch (err: any) {
      console.error('Validation error:', err?.message);
      return { success: false, error: err?.message || 'Validation failed', path: [] };
    }
  }

  private validateTransfer(data: TransferData): boolean {
    return !!(
      data &&
      data.from &&
      data.to &&
      data.token &&
      data.amount &&
      BigInt(data.amount) > 0n
    );
  }

  private validateChannelOpen(data: ChannelOpenData): boolean {
    return !!(
      data &&
      data.participants &&
      data.participants.length > 0 &&
      data.initialBalances &&
      data.initialBalances.size > 0 &&
      data.disputePeriod > 0 &&
      data.channelType
    );
  }

  private validateChannelUpdate(data: ChannelUpdateData): boolean {
    return !!(
      data &&
      data.channelId &&
      data.balanceUpdates &&
      data.balanceUpdates.size > 0 &&
      data.nonce > 0
    );
  }

  private validateChannelClose(data: ChannelCloseData): boolean {
    return !!(
      data &&
      data.channelId &&
      data.finalBalances &&
      data.finalBalances.size > 0 &&
      data.signatures &&
      data.signatures.size > 0
    );
  }

  private validateStateUpdate(data: StateUpdateData): boolean {
    return !!(
      data &&
      data.stateRoot &&
      data.proof &&
      data.updates &&
      data.updates.size > 0
    );
  }

  private validateNonce(node: FractalNode<any>, transaction: Transaction): boolean {
    return transaction.nonce > node.state.nonce;
  }

  private verifySignature(transaction: Transaction): boolean {
    // TODO: Implement signature verification logic
    return true;
  }

  private processAtNode(node: FractalNode<any>, transaction: Transaction): ProcessingResult {
    const result: ProcessingResult = {
      success: false,
      path: [],
      error: undefined
    };

    try {
      console.log(`Processing transaction ${transaction.type} at node ${node.id} (${node.metadata.type})`);

      if (!this.validateTransaction(transaction)) {
        throw new Error(`Invalid transaction: ${JSON.stringify(transaction.data)}`);
      }

      let success = false;
      switch (node.metadata.type) {
        case NodeType.ROOT:
          success = this.processAtRootNode(node, transaction);
          break;
        case NodeType.BRANCH:
          success = this.processAtBranchNode(node, transaction);
          break;
        case NodeType.LEAF:
          success = this.processAtLeafNode(node, transaction);
          break;
        case NodeType.BRIDGE:
          success = this.processAtBridgeNode(node, transaction);
          break;
        default:
          throw new Error(`Unknown node type: ${node.metadata.type}`);
      }

      if (!success) {
        throw new Error(`Transaction processing failed at node ${node.id} (${node.metadata.type})`);
      }

      result.success = true;
      this.updateNodeHash(node.id);

    } catch (error) {
      if (error instanceof Error) {
        result.error = error.message;
        console.error(`Error processing transaction: ${error.message}`);
      } else {
        result.error = 'An unknown error occurred';
        console.error('Unknown error processing transaction');
      }
      result.success = false;
    }

    return result;
  }

  private processAtRootNode(node: FractalNode<any>, transaction: Transaction): boolean {
    console.log(`Processing at root node: ${transaction.type}`);
    
    // Root node processes all transaction types
    switch (transaction.type) {
      case TransactionType.STATE_UPDATE:
        return this.processStateUpdate(node, transaction.data as StateUpdateData);
      case TransactionType.CHANNEL_OPEN:
        return this.processChannelOpen(node, transaction.data as ChannelOpenData);
      case TransactionType.CHANNEL_CLOSE:
        return this.executeChannelClose(node, transaction.data as ChannelCloseData);
      case TransactionType.CHANNEL_UPDATE:
        return this.executeChannelUpdate(node, transaction.data as ChannelUpdateData);
      case TransactionType.TRANSFER:
        return this.executeTransfer(node, transaction.data as TransferData);
      default:
        console.error(`Unsupported transaction type at root: ${transaction.type}`);
        return false;
    }
  }

  private processAtBranchNode(node: FractalNode<any>, transaction: Transaction): boolean {
    console.log(`Processing at branch node: ${transaction.type}`);
    
    // Branch nodes route transactions to appropriate children
    switch (transaction.type) {
      case TransactionType.TRANSFER:
        return this.routeTransfer(node, transaction.data as TransferData);
      case TransactionType.CHANNEL_UPDATE:
        return this.routeChannelUpdate(node, transaction.data as ChannelUpdateData);
      default:
        // Pass through other transaction types
        console.log(`Passing through transaction at branch: ${transaction.type}`);
        return true;
    }
  }

  private processAtLeafNode(node: FractalNode<any>, transaction: Transaction): boolean {
    console.log(`Processing at leaf node: ${transaction.type}`);
    
    // Leaf nodes process transfers and channel operations
    switch (transaction.type) {
      case TransactionType.TRANSFER:
        return this.executeTransfer(node, transaction.data as TransferData);
      case TransactionType.CHANNEL_CLOSE:
        return this.executeChannelClose(node, transaction.data as ChannelCloseData);
      case TransactionType.CHANNEL_OPEN:
        return this.processChannelOpen(node, transaction.data as ChannelOpenData);
      case TransactionType.CHANNEL_UPDATE:
        return this.executeChannelUpdate(node, transaction.data as ChannelUpdateData);
      default:
        console.error(`Unsupported transaction type at leaf: ${transaction.type}`);
        return false;
    }
  }

  private processAtBridgeNode(node: FractalNode<any>, transaction: Transaction): boolean {
    console.log(`Processing at bridge node: ${transaction.type}`);
    
    // Bridge nodes handle cross-region transactions
    switch (transaction.type) {
      case TransactionType.CHANNEL_UPDATE:
        return this.executeChannelUpdate(node, transaction.data as ChannelUpdateData);
      case TransactionType.TRANSFER:
        return this.routeTransfer(node, transaction.data as TransferData);
      default:
        console.error(`Unsupported transaction type at bridge: ${transaction.type}`);
        return false;
    }
  }

  private processStateUpdate(node: FractalNode<any>, data: StateUpdateData): boolean {
    try {
      // Implementation of state update processing
      return true;
    } catch (err: any) {
      console.error('State update error:', err?.message);
      return false;
    }
  }

  private processChannelOpen(node: FractalNode<any>, data: ChannelOpenData): boolean {
    console.log(`Opening channel for participants: ${data.participants.join(', ')}`);
    
    try {
      const channelId = this.generateChannelId(data.participants);
      
      // Verify participants have sufficient balance
      for (const [token, balances] of data.initialBalances) {
        for (const [participant, amount] of balances) {
          const balance = BigInt(node.state.balances.get(token) || '0');
          if (balance < BigInt(amount)) {
            console.error(`Insufficient balance for participant ${participant}: ${balance} < ${amount}`);
            return false;
          }
        }
      }

      // Create channel state
      const channelState: ChannelState = {
        participants: data.participants,
        balances: data.initialBalances,
        nonce: 0,
        status: ChannelStatus.ACTIVE,
        disputePeriod: data.disputePeriod,
        channelType: data.channelType,
        lastUpdate: Date.now()
      };

      // Update node state
      node.state.channels.set(channelId, channelState);
      console.log(`Channel ${channelId} opened successfully`);
      
      return true;
    } catch (error) {
      console.error(`Error opening channel: ${error}`);
      return false;
    }
  }

  private executeTransfer(node: FractalNode<any>, data: TransferData): boolean {
    console.log(`Executing transfer: ${data.from} -> ${data.to} (${data.amount} ${data.token})`);
    
    try {
      const amount = BigInt(data.amount);
      const fromBalance = BigInt(node.state.balances.get(data.token) || '0');
      
      if (fromBalance < amount) {
        console.error(`Insufficient balance: ${fromBalance} < ${amount}`);
        return false;
      }

      // Update balances
      node.state.balances.set(
        data.token,
        (fromBalance - amount).toString()
      );

      const toBalance = BigInt(node.state.balances.get(data.token) || '0');
      node.state.balances.set(
        data.token,
        (toBalance + amount).toString()
      );

      console.log(`Transfer successful. New balances: ${data.from}=${fromBalance - amount}, ${data.to}=${toBalance + amount}`);
      return true;
    } catch (error) {
      console.error(`Error executing transfer: ${error}`);
      return false;
    }
  }

  private executeChannelUpdate(node: FractalNode<any>, data: ChannelUpdateData): boolean {
    console.log(`Updating channel ${data.channelId}`);
    
    try {
      const channel = node.state.channels.get(data.channelId);
      if (!channel) {
        console.error(`Channel ${data.channelId} not found`);
        return false;
      }
      
      if (channel.status !== ChannelStatus.ACTIVE) {
        console.error(`Channel ${data.channelId} is not active (status: ${channel.status})`);
        return false;
      }

      // Verify nonce
      if (data.nonce <= channel.nonce) {
        console.error(`Invalid nonce: ${data.nonce} <= ${channel.nonce}`);
        return false;
      }

      // Verify balance updates
      for (const [token, updates] of data.balanceUpdates) {
        const channelBalances = channel.balances.get(token);
        if (!channelBalances) {
          console.error(`Token ${token} not found in channel ${data.channelId}`);
          return false;
        }

        // Calculate total balance before and after update
        let totalBefore = 0n;
        let totalAfter = 0n;
        
        for (const [participant, _] of channelBalances) {
          totalBefore += BigInt(channelBalances.get(participant) || '0');
        }
        
        for (const [participant, amount] of updates) {
          if (!channel.participants.includes(participant)) {
            console.error(`Invalid participant ${participant} in update`);
            return false;
          }
          totalAfter += BigInt(amount);
        }

        // Verify conservation of funds
        if (totalBefore !== totalAfter) {
          console.error(`Balance mismatch: ${totalBefore} !== ${totalAfter}`);
          return false;
        }
      }

      // Apply balance updates
      for (const [token, updates] of data.balanceUpdates) {
        const channelBalances = channel.balances.get(token) || new Map();
        for (const [participant, amount] of updates) {
          channelBalances.set(participant, amount);
        }
        channel.balances.set(token, channelBalances);
      }

      channel.nonce = data.nonce;
      channel.lastUpdate = Date.now();
      console.log(`Channel ${data.channelId} updated successfully`);

      return true;
    } catch (error) {
      console.error(`Error updating channel: ${error}`);
      return false;
    }
  }

  private executeChannelClose(node: FractalNode<any>, data: ChannelCloseData): boolean {
    console.log(`Closing channel ${data.channelId}`);
    
    try {
      const channel = node.state.channels.get(data.channelId);
      if (!channel) {
        console.error(`Channel ${data.channelId} not found`);
        return false;
      }
      
      if (channel.status !== ChannelStatus.ACTIVE) {
        console.error(`Channel ${data.channelId} is not active (status: ${channel.status})`);
        return false;
      }

      // Verify all participants have signed
      for (const participant of channel.participants) {
        if (!data.signatures.has(participant)) {
          console.error(`Missing signature from participant ${participant}`);
          return false;
        }
      }

      // Verify final balances
      for (const [token, finalBalances] of data.finalBalances) {
        const channelBalances = channel.balances.get(token);
        if (!channelBalances) {
          console.error(`Token ${token} not found in channel ${data.channelId}`);
          return false;
        }

        // Calculate total balance before and after closing
        let totalBefore = 0n;
        let totalAfter = 0n;
        
        for (const [participant, _] of channelBalances) {
          totalBefore += BigInt(channelBalances.get(participant) || '0');
        }
        
        for (const [participant, amount] of finalBalances) {
          if (!channel.participants.includes(participant)) {
            console.error(`Invalid participant ${participant} in final balances`);
            return false;
          }
          totalAfter += BigInt(amount);
        }

        // Verify conservation of funds
        if (totalBefore !== totalAfter) {
          console.error(`Balance mismatch: ${totalBefore} !== ${totalAfter}`);
          return false;
        }
      }

      // Update channel status
      channel.status = ChannelStatus.CLOSING;
      channel.lastUpdate = Date.now();

      // Schedule final settlement after dispute period
      setTimeout(() => {
        this.settleChannel(node, data.channelId, data.finalBalances);
      }, channel.disputePeriod);

      console.log(`Channel ${data.channelId} closing initiated`);
      return true;
    } catch (error) {
      console.error(`Error closing channel: ${error}`);
      return false;
    }
  }

  private settleChannel(
    node: FractalNode<any>, 
    channelId: string, 
    finalBalances: Map<string, Map<string, string>>
  ): void {
    const channel = node.state.channels.get(channelId);
    if (!channel || channel.status !== ChannelStatus.CLOSING) {
      console.error(`Cannot settle channel ${channelId}: invalid state`);
      return;
    }

    try {
      // Apply final balances
      for (const [token, balances] of finalBalances) {
        for (const [participant, amount] of balances) {
          const currentBalance = BigInt(node.state.balances.get(token) || '0');
          node.state.balances.set(token, (currentBalance + BigInt(amount)).toString());
        }
      }

      // Close channel
      channel.status = ChannelStatus.CLOSED;
      channel.lastUpdate = Date.now();
      console.log(`Channel ${channelId} settled successfully`);
    } catch (error) {
      console.error(`Error settling channel ${channelId}: ${error}`);
      channel.status = ChannelStatus.DISPUTED;
    }
  }

  /**
   * Generates a unique channel ID from participant IDs
   */
  generateChannelId(participants: string[]): string {
    return createHash('sha256')
      .update(participants.sort().join('|'))
      .digest('hex');
  }

  /**
   * Updates node state and propagates changes through the structure
   */
  updateNodeState(nodeId: string, newStatus: NodeStateEnum): void {
    const node = this.getNode(nodeId);
    const oldStatus = node.status;

    node.status = newStatus;
    node.metadata.transitions++;
    node.metadata.lastTransition = Date.now();

    if (this.shouldPropagateState(oldStatus, newStatus)) {
      node.children.forEach(childId => {
        this.updateNodeState(childId, newStatus);
      });
    }

    this.updateNodeHash(nodeId);
    if (node.parent) {
      this.updateNodeHash(node.parent);
    }
  }

  private shouldPropagateState(oldStatus: NodeStateEnum, newStatus: NodeStateEnum): boolean {
    return newStatus === NodeStateEnum.FROZEN || newStatus === NodeStateEnum.PRUNED;
  }

  /**
   * Gets the state of a node
   */
  getNodeState(nodeId: string): NodeState {
    const node = this.getNode(nodeId);
    return node.state;
  }

  private processTransactionAtNode(node: FractalNode<any>, transaction: Transaction): ProcessingResult {
    if (!transaction || !transaction.type || !transaction.data) {
      return { success: false, error: 'Invalid transaction', path: [] };
    }

    try {
      const validationResult = this.validateTransaction(transaction);
      if (!validationResult.success) {
        return validationResult;
      }

      let routingResult = false;
      switch (transaction.type) {
        case TransactionType.TRANSFER:
          routingResult = this.routeTransfer(node, transaction.data as TransferData);
          break;
        case TransactionType.CHANNEL_OPEN:
          routingResult = this.routeChannelOpen(node, transaction.data as ChannelOpenData);
          break;
        case TransactionType.CHANNEL_UPDATE:
          routingResult = this.routeChannelUpdate(node, transaction.data as ChannelUpdateData);
          break;
        case TransactionType.CHANNEL_CLOSE:
          routingResult = this.routeChannelClose(node, transaction.data as ChannelCloseData);
          break;
        case TransactionType.STATE_UPDATE:
          const stateUpdateResult = this.processStateUpdate(node, transaction.data as unknown as StateUpdateData);
          return {
            success: stateUpdateResult,
            error: stateUpdateResult ? undefined : 'State update failed',
            path: [node.id]
          };
        default:
          return { success: false, error: 'Invalid transaction type', path: [] };
      }

      return {
        success: routingResult,
        error: routingResult ? undefined : 'Transaction routing failed',
        path: routingResult ? [node.id] : []
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Transaction processing failed', path: [] };
    }
  }
}

/**
 * Helper class for tracking HSTM metrics
 */
class HSTMMetrics {
  totalNodes: number = 0;
  activeNodes: number = 0;
  totalTransactions: number = 0;
  avgProcessingTime: number = 0;
  maxDepth: number = 0;
  totalConnections: number = 0;
} 