import { RhizomeHSTM } from './rhizome_hstm.js';
import { 
  TransactionType, 
  NodeStateEnum, 
  ChannelType,
  ChannelStatus,
  type Transaction,
  type TransferData,
  type ChannelOpenData,
  type ChannelUpdateData,
  type ChannelCloseData
} from './fractal_hstm.js';

enum NodeType {
  ROOT = 'ROOT',
  BRANCH = 'BRANCH',
  LEAF = 'LEAF',
  BRIDGE = 'BRIDGE'
}

// Declare HSTMViz interface for browser environment
declare global {
  interface Window {
    HSTMViz?: {
      startMonitoring: (hstm: any) => void;
      updateVisualization: (data: any) => void;
    };
  }
}

/**
 * Example implementation of a payment network using HSTM
 */
class PaymentNetwork {
  private hstm: RhizomeHSTM;
  private rootNodeId: string;
  private processorIds: Map<string, string>;

  constructor() {
    this.hstm = new RhizomeHSTM();
    this.processorIds = new Map();
    
    // Create root node
    this.rootNodeId = this.hstm.createNode(
      { name: 'root', description: 'Root node of the payment network' },
      NodeType.ROOT
    );

    // Initialize the network structure
    this.setupNetworkStructure();
  }

  /**
   * Sets up the initial network structure with regions and processors
   */
  private setupNetworkStructure() {
    // Create regional branch nodes
    const asiaId = this.hstm.createNode(
      { name: 'asia', description: 'Asia region' },
      NodeType.BRANCH,
      this.rootNodeId
    );

    const europeId = this.hstm.createNode(
      { name: 'europe', description: 'Europe region' },
      NodeType.BRANCH,
      this.rootNodeId
    );

    const northAmericaId = this.hstm.createNode(
      { name: 'north-america', description: 'North America region' },
      NodeType.BRANCH,
      this.rootNodeId
    );

    // Create bridge nodes between regions
    const asiaToBridgeId = this.hstm.createNode(
      { name: 'asia-bridge', description: 'Asia bridge node' },
      NodeType.BRIDGE,
      asiaId
    );

    const europeToBridgeId = this.hstm.createNode(
      { name: 'europe-bridge', description: 'Europe bridge node' },
      NodeType.BRIDGE,
      europeId
    );

    const naToBridgeId = this.hstm.createNode(
      { name: 'na-bridge', description: 'North America bridge node' },
      NodeType.BRIDGE,
      northAmericaId
    );

    // Connect bridge nodes
    this.hstm.connect(asiaToBridgeId, europeToBridgeId, true);
    this.hstm.connect(europeToBridgeId, naToBridgeId, true);
    this.hstm.connect(naToBridgeId, asiaToBridgeId, true);

    // Create processor nodes for each region
    // Asia processors
    this.createProcessor('asia-east', 'East Asia processor', asiaId);
    this.createProcessor('asia-south', 'South Asia processor', asiaId);
    this.createProcessor('asia-central', 'Central Asia processor', asiaId);

    // Europe processors
    this.createProcessor('europe-north', 'Northern Europe processor', europeId);
    this.createProcessor('europe-south', 'Southern Europe processor', europeId);
    this.createProcessor('europe-central', 'Central Europe processor', europeId);

    // North America processors
    this.createProcessor('north-america-east', 'Eastern NA processor', northAmericaId);
    this.createProcessor('north-america-west', 'Western NA processor', northAmericaId);
    this.createProcessor('north-america-central', 'Central NA processor', northAmericaId);

    // Initialize balances for all processors
    this.initializeBalances();

    console.log('Network structure initialized with:', {
      processors: this.processorIds.size,
      regions: 3,
      bridges: 3
    });
  }

  /**
   * Creates a processor node and stores its ID
   */
  private createProcessor(name: string, description: string, parentId: string): string {
    const nodeId = this.hstm.createNode(
      { name, description },
      NodeType.LEAF,
      parentId
    );
    this.processorIds.set(name, nodeId);
    return nodeId;
  }

  /**
   * Initializes balances for the payment processors
   */
  private initializeBalances() {
    const initialBalance = '1000000000000000000'; // 1 token with 18 decimals
    const token = 'XLN';

    // First, initialize root node balance
    const rootState = this.hstm.getNodeState(this.rootNodeId);
    rootState.balances.set(token, '10000000000000000000'); // 10 tokens for distribution

    // Then initialize processor balances through transfers
    for (const [processorName, processorId] of this.processorIds) {
      const transferTx: Transaction = {
        type: TransactionType.TRANSFER,
        data: {
          from: this.rootNodeId,
          to: processorId,
          token,
          amount: initialBalance
        } as TransferData,
        timestamp: Date.now(),
        nonce: 1,
        hash: ''
      };

      // Calculate transaction hash
      transferTx.hash = this.calculateTxHash(transferTx);

      // Process the transaction
      const result = this.hstm.processTransaction(transferTx);
      console.log(`Initialized processor ${processorName} (${processorId}): ${result.success ? 'success' : 'failed'}`);
      if (result.error) {
        console.error(`Error: ${result.error}`);
      }
    }
  }

  /**
   * Calculates a transaction hash using Web Crypto API
   */
  private async calculateTxHash(tx: Transaction): Promise<string> {
    const { hash, ...txWithoutHash } = tx;
    const msgBuffer = new TextEncoder().encode(JSON.stringify(txWithoutHash));
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Processes a transfer between two processors
   */
  async processTransfer(
    fromProcessorName: string,
    toProcessorName: string,
    amount: string,
    token: string = 'XLN'
  ): Promise<boolean> {
    const fromId = this.processorIds.get(fromProcessorName);
    const toId = this.processorIds.get(toProcessorName);

    if (!fromId || !toId) {
      console.error('Processor not found');
      return false;
    }

    const transferTx: Transaction = {
      type: TransactionType.TRANSFER,
      data: {
        from: fromId,
        to: toId,
        token,
        amount
      } as TransferData,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    };

    // Calculate transaction hash
    transferTx.hash = await this.calculateTxHash(transferTx);

    // Process the transaction
    const result = this.hstm.processTransaction(transferTx);
    console.log(`Transfer from ${fromProcessorName} to ${toProcessorName}: ${result.success ? 'success' : 'failed'}`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
    }
    console.log(`Transaction path: ${result.path.join(' -> ')}`);

    return result.success;
  }

  /**
   * Opens a payment channel between two processors
   */
  async openChannel(
    processor1Name: string,
    processor2Name: string,
    initialBalance1: string,
    initialBalance2: string,
    token: string = 'XLN'
  ): Promise<string | null> {
    const processor1Id = this.processorIds.get(processor1Name);
    const processor2Id = this.processorIds.get(processor2Name);

    if (!processor1Id || !processor2Id) {
      console.error('Processor not found');
      return null;
    }

    const channelOpenTx: Transaction = {
      type: TransactionType.CHANNEL_OPEN,
      data: {
        participants: [processor1Id, processor2Id],
        initialBalances: new Map([
          [token, new Map([
            [processor1Id, initialBalance1],
            [processor2Id, initialBalance2]
          ])]
        ]),
        disputePeriod: 86400,
        channelType: ChannelType.BILATERAL
      } as ChannelOpenData,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    };

    // Calculate transaction hash
    channelOpenTx.hash = await this.calculateTxHash(channelOpenTx);

    // Process the transaction
    const result = this.hstm.processTransaction(channelOpenTx);
    console.log(`Channel opened between ${processor1Name} and ${processor2Name}: ${result.success ? 'success' : 'failed'}`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
      return null;
    }

    // Return the channel ID
    return this.hstm.generateChannelId([processor1Id, processor2Id]);
  }

  /**
   * Updates a payment channel's balances
   */
  async updateChannel(
    channelId: string,
    processor1Name: string,
    processor2Name: string,
    processor1Amount: string,
    processor2Amount: string,
    nonce: number,
    token: string = 'XLN'
  ): Promise<boolean> {
    const processor1Id = this.processorIds.get(processor1Name);
    const processor2Id = this.processorIds.get(processor2Name);

    if (!processor1Id || !processor2Id) {
      console.error('Processor not found');
      return false;
    }

    const updates = new Map([
      [token, new Map([
        [processor1Id, processor1Amount],
        [processor2Id, processor2Amount]
      ])]
    ]);

    const channelUpdateTx: Transaction = {
      type: TransactionType.CHANNEL_UPDATE,
      data: {
        channelId,
        balanceUpdates: updates,
        nonce
      } as ChannelUpdateData,
      timestamp: Date.now(),
      nonce,
      hash: ''
    };

    // Calculate transaction hash
    channelUpdateTx.hash = await this.calculateTxHash(channelUpdateTx);

    // Process the transaction
    const result = this.hstm.processTransaction(channelUpdateTx);
    console.log(`Channel ${channelId} updated: ${result.success ? 'success' : 'failed'}`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
    }

    return result.success;
  }

  /**
   * Closes a payment channel
   */
  async closeChannel(
    channelId: string,
    processor1Name: string,
    processor2Name: string,
    processor1Amount: string,
    processor2Amount: string,
    token: string = 'XLN'
  ): Promise<boolean> {
    const processor1Id = this.processorIds.get(processor1Name);
    const processor2Id = this.processorIds.get(processor2Name);

    if (!processor1Id || !processor2Id) {
      console.error('Processor not found');
      return false;
    }

    const finalBalances = new Map([
      [token, new Map([
        [processor1Id, processor1Amount],
        [processor2Id, processor2Amount]
      ])]
    ]);

    const signatures = new Map([
      [processor1Id, `${processor1Id}_signature`],
      [processor2Id, `${processor2Id}_signature`]
    ]);

    const channelCloseTx: Transaction = {
      type: TransactionType.CHANNEL_CLOSE,
      data: {
        channelId,
        finalBalances,
        signatures
      } as ChannelCloseData,
      timestamp: Date.now(),
      nonce: 1,
      hash: ''
    };

    // Calculate transaction hash
    channelCloseTx.hash = await this.calculateTxHash(channelCloseTx);

    // Process the transaction
    const result = this.hstm.processTransaction(channelCloseTx);
    console.log(`Channel ${channelId} closing: ${result.success ? 'success' : 'failed'}`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
    }

    return result.success;
  }

  // Make HSTM accessible for visualization
  getHSTM(): RhizomeHSTM {
    return this.hstm;
  }
}

// Example usage
async function runExample() {
  console.log('Starting example...');
  const network = new PaymentNetwork();

  // Connect to visualization if running in browser
  if (typeof window !== 'undefined' && window.HSTMViz) {
    console.log('Connecting to visualization...');
    window.HSTMViz.startMonitoring(network.getHSTM());
  }

  // Wait for initial network setup
  console.log('Waiting for initial setup...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('Network initialized');

  // Perform transfers with delays between them
  console.log('Processing first transfer...');
  const transfer1Result = await network.processTransfer(
    'asia-east',
    'europe-north',
    '1000000000000000' // 0.001 tokens
  );
  console.log('First transfer completed:', { success: transfer1Result });
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Processing second transfer...');
  const transfer2Result = await network.processTransfer(
    'north-america',
    'asia-south',
    '2000000000000000' // 0.002 tokens
  );
  console.log('Second transfer completed:', { success: transfer2Result });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Open a channel
  console.log('Opening channel...');
  const channelId = await network.openChannel(
    'europe-north',
    'europe-south',
    '5000000000000000', // 0.005 tokens
    '5000000000000000'  // 0.005 tokens
  );
  console.log('Channel opened:', { channelId });
  await new Promise(resolve => setTimeout(resolve, 2000));

  if (channelId) {
    // Update channel balances
    console.log('Updating channel...');
    const updateResult = await network.updateChannel(
      channelId,
      'europe-north',
      'europe-south',
      '6000000000000000',  // 0.006 tokens
      '4000000000000000',  // 0.004 tokens
      2
    );
    console.log('Channel updated:', { success: updateResult });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Close channel
    console.log('Closing channel...');
    const closeResult = await network.closeChannel(
      channelId,
      'europe-north',
      'europe-south',
      '6000000000000000',  // 0.006 tokens
      '4000000000000000'   // 0.004 tokens
    );
    console.log('Channel closed:', { success: closeResult });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('Example completed');
}

// Run the example
runExample().catch(error => {
  console.error('Error running example:', error);
}); 