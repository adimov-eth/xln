import type { EntityTx, ServerState, ServerTx } from './server';
import { createStorage, initializeServer, loadSnapshot, processBlock, saveSnapshot } from './server';





type SimulationConfig = {
  readonly blocks: number;
  readonly tickMs: number;
  readonly snapshotInterval: number;
  readonly logInterval: number;
  readonly scenario: SimulationScenario;
};

type SimulationScenario = 
  | 'basic'           
  | 'stress_test'     
  | 'dao_governance'  
  | 'payment_hub'     
  | 'economic_model'  
  | 'mixed'           

type EntityProfile = {
  readonly id: string;
  readonly signer: number;
  readonly behavior: 'conservative' | 'active' | 'whale' | 'hub';
  readonly txFrequency: number;    
  readonly preferredOps: readonly string[];
};





const defaultConfig: SimulationConfig = {
  blocks: 50,
  tickMs: 100,
  snapshotInterval: 10,
  logInterval: 10,
  scenario: 'mixed'
};

const entityProfiles: readonly EntityProfile[] = [
  { id: 'alice', signer: 0, behavior: 'active', txFrequency: 30, preferredOps: ['mint', 'transfer'] },
  { id: 'bob', signer: 1, behavior: 'conservative', txFrequency: 15, preferredOps: ['mint'] },
  { id: 'carol', signer: 2, behavior: 'whale', txFrequency: 10, preferredOps: ['mint', 'burn'] },
  { id: 'hub', signer: 1, behavior: 'hub', txFrequency: 50, preferredOps: ['transfer', 'mint'] },
  { id: 'dao', signer: 0, behavior: 'conservative', txFrequency: 5, preferredOps: ['mint'] }
];





const generateMintTx = (amount: number): EntityTx => ({
  op: 'mint',
  data: { amount }
});

const generateBurnTx = (amount: number): EntityTx => ({
  op: 'burn', 
  data: { amount }
});

const generateTransferTx = (to: string, amount: number): EntityTx => ({
  op: 'transfer',
  data: { to, amount }
});

const getRandomAmount = (behavior: EntityProfile['behavior']): number => {
  const base = Math.random();
  switch (behavior) {
    case 'whale': return Math.floor(base * 1000000) + 100000;  
    case 'active': return Math.floor(base * 100000) + 10000;   
    case 'conservative': return Math.floor(base * 10000) + 1000; 
    case 'hub': return Math.floor(base * 50000) + 5000;        
    default: return Math.floor(base * 10000) + 1000;
  }
};

const selectRandomEntity = (exclude?: string): string => {
  const entities = entityProfiles
    .map(p => p.id)
    .filter(id => id !== exclude);
  return entities[Math.floor(Math.random() * entities.length)];
};





const generateBasicTransactions = (block: number): ServerTx[] => {
  const txs: ServerTx[] = [];
  
  
  if (block % 3 === 0) {
    txs.push({
      signer: 0,
      entityId: 'alice',
      input: { type: 'add_tx', tx: generateMintTx(getRandomAmount('active')) }
    });
  }
  
  if (block % 5 === 0) {
    txs.push({
      signer: 1, 
      entityId: 'bob',
      input: { type: 'add_tx', tx: generateMintTx(getRandomAmount('conservative')) }
    });
  }
  
  
  if (block % 7 === 0) {
    const to = selectRandomEntity('alice');
    txs.push({
      signer: 0,
      entityId: 'alice', 
      input: { type: 'add_tx', tx: generateTransferTx(to, getRandomAmount('active')) }
    });
  }
  
  return txs;
};

const generateStressTest = (block: number): ServerTx[] => {
  const txs: ServerTx[] = [];
  
  
  entityProfiles.forEach(profile => {
    const shouldTx = Math.random() < (profile.txFrequency / 100);
    if (!shouldTx) return;
    
    const opType = profile.preferredOps[Math.floor(Math.random() * profile.preferredOps.length)];
    let tx: EntityTx;
    
    switch (opType) {
      case 'mint':
        tx = generateMintTx(getRandomAmount(profile.behavior));
        break;
      case 'burn':
        tx = generateBurnTx(Math.min(getRandomAmount(profile.behavior), 50000));
        break;
      case 'transfer':
        const to = selectRandomEntity(profile.id);
        tx = generateTransferTx(to, getRandomAmount(profile.behavior));
        break;
      default:
        return;
    }
    
    txs.push({
      signer: profile.signer,
      entityId: profile.id,
      input: { type: 'add_tx', tx }
    });
  });
  
  return txs;
};

const generateDaoGovernance = (block: number, server?: ServerState): ServerTx[] => {
  const txs: ServerTx[] = [];
  
  // DAO proposal cycle every 20 blocks
  if (block % 20 === 0) {
    // Add transaction and propose
    txs.push({
      signer: 0,
      entityId: 'dao',
      input: { type: 'add_tx', tx: generateMintTx(getRandomAmount('whale')) }
    });
    txs.push({
      signer: 0,
      entityId: 'dao', 
      input: { type: 'propose_block' }
    });
  }
  
  // Voting phases - need to get the actual proposed hash
  if (server && (block % 20 === 1 || block % 20 === 2)) {
    const daoEntity = server.signers.get(0)?.get('dao');
    if (daoEntity?.proposed && daoEntity.status === 'proposed') {
      const actualHash = daoEntity.proposed.hash;
      
      // Signer 1 votes
      if (block % 20 === 1) {
        txs.push({
          signer: 1,
          entityId: 'dao',
          input: { type: 'commit_block', blockHash: actualHash }
        });
      }
      
      // Signer 2 votes  
      if (block % 20 === 2) {
        txs.push({
          signer: 2,
          entityId: 'dao',
          input: { type: 'commit_block', blockHash: actualHash }
        });
      }
    }
  }
  
  return txs;
};

const generatePaymentHub = (block: number): ServerTx[] => {
  const txs: ServerTx[] = [];
  
  
  if (block % 8 === 0) {
    const users = ['alice', 'bob', 'carol'];
    const sender = users[Math.floor(Math.random() * users.length)];
    const recipient = users.filter(u => u !== sender)[Math.floor(Math.random() * 2)];
    
    
    txs.push({
      signer: entityProfiles.find(p => p.id === sender)!.signer,
      entityId: sender,
      input: { type: 'add_tx', tx: generateTransferTx('hub', getRandomAmount('active')) }
    });
    
    
    if (block % 8 === 6) {
      txs.push({
        signer: 1,
        entityId: 'hub',
        input: { type: 'add_tx', tx: generateTransferTx(recipient, getRandomAmount('hub')) }
      });
    }
  }
  
  return txs;
};

const generateEconomicModel = (block: number): ServerTx[] => {
  const txs: ServerTx[] = [];
  
  
  const cycle = Math.floor(block / 30) % 4;
  const activity = cycle < 2 ? 'boom' : 'bust';
  
  entityProfiles.forEach(profile => {
    const baseFreq = profile.txFrequency;
    const adjustedFreq = activity === 'boom' ? baseFreq * 1.5 : baseFreq * 0.7;
    
    if (Math.random() < adjustedFreq / 100) {
      const amount = activity === 'boom' 
        ? getRandomAmount(profile.behavior) * 1.2
        : getRandomAmount(profile.behavior) * 0.8;
      
      txs.push({
        signer: profile.signer,
        entityId: profile.id,
        input: { type: 'add_tx', tx: generateMintTx(Math.floor(amount)) }
      });
    }
  });
  
  return txs;
};





const generateTransactions = (block: number, scenario: SimulationScenario, server?: ServerState): ServerTx[] => {
  switch (scenario) {
    case 'basic': return generateBasicTransactions(block);
    case 'stress_test': return generateStressTest(block);
    case 'dao_governance': return generateDaoGovernance(block, server);
    case 'payment_hub': return generatePaymentHub(block);
    case 'economic_model': return generateEconomicModel(block);
    case 'mixed': return [
      ...generateBasicTransactions(block),
      ...generateDaoGovernance(block, server),
      ...generatePaymentHub(block)
    ];
    default: return [];
  }
};

const logSimulationState = (server: ServerState, block: number, config: SimulationConfig): void => {
  console.log(`\n📊 Block ${server.height} [${config.scenario}]:`);
  
  let totalBalance = 0n;
  let totalEntities = 0;
  
  for (const [signer, entities] of server.signers) {
    for (const [id, entity] of entities) {
      if (entity.state.balance > 0n || id === 'dao') {
        let status = '';
        if (entity.status === 'proposed') {
          const votes = entity.proposed?.votes?.length || 0;
          const required = Math.ceil(entity.quorum.length * 2 / 3);
          status = ` 🗳️ [PROPOSED: ${entity.proposed?.hash.slice(0, 8)}, votes: ${votes}/${required}]`;
        }
        
        console.log(`  💰 ${id}[${signer}]: ${entity.state.balance.toLocaleString()} (h:${entity.height})${status}`);
        totalBalance += entity.state.balance;
        totalEntities++;
      }
    }
  }
  
  console.log(`  📈 Total: ${totalBalance.toLocaleString()} across ${totalEntities} entities`);
  console.log(`  📋 Mempool: ${server.mempool.length} pending`);
};

export const runSimulation = async (config: SimulationConfig = defaultConfig): Promise<void> => {
  const storage = createStorage();
  
  let server = await loadSnapshot(storage) || initializeServer();
  
  console.log(`🚀 Starting ${config.scenario} simulation from height ${server.height}...`);
  console.log(`📝 Config: ${config.blocks} blocks, ${config.tickMs}ms ticks`);
  
  const startTime = Date.now();
  const finalHeight = server.height + config.blocks;
  
  for (let i = 0; i < config.blocks; i++) {
    const currentBlock = server.height;
    
    
    const newTxs = generateTransactions(currentBlock, config.scenario, server);
    server.mempool.push(...newTxs);
    
    
    server = await processBlock(server, storage);
    
    
    if (server.height % config.logInterval === 0) {
      logSimulationState(server, currentBlock, config);
    }
    
    
    if (server.height % config.snapshotInterval === 0) {
      await saveSnapshot(server, storage);
    }
    
    
    await new Promise(resolve => setTimeout(resolve, config.tickMs));
  }
  
  
  await saveSnapshot(server, storage);
  
  const duration = Date.now() - startTime;
  const tps = (config.blocks * 1000) / duration;
  
  console.log(`\n✅ Simulation complete!`);
  console.log(`📊 Processed ${config.blocks} blocks in ${duration}ms (${tps.toFixed(1)} blocks/s)`);
  console.log(`🎯 Final height: ${server.height}`);
  
  await storage.state.close();
  await storage.wal.close();
  await storage.blocks.close();
};





export const presets = {
  quick: { ...defaultConfig, blocks: 10, scenario: 'basic' as const },
  stress: { ...defaultConfig, blocks: 100, scenario: 'stress_test' as const },
  governance: { ...defaultConfig, blocks: 60, scenario: 'dao_governance' as const },
  hub: { ...defaultConfig, blocks: 40, scenario: 'payment_hub' as const },
  economy: { ...defaultConfig, blocks: 120, scenario: 'economic_model' as const }
}; 