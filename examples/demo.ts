/**
 * Demo: XLN v2 Architecture Example
 * 
 * This example demonstrates the key improvements in the refactored architecture:
 * 1. Single entity ledger with O(1) lookups
 * 2. Strongly typed transactions
 * 3. Simplified pipeline processing
 * 4. Protocol-based transaction handling
 * 5. Two-phase command validation/application
 */

import {
    // Core server functions
    createServerState,
    createRegistry,
    registerEntity,
    createEntity,
    addEntityToServer,
    processBlock,
    
    // Type constructors (new ergonomic helpers!)
    entity,
    signer,
    height,
    
    // Storage
    createStorage,
    MemoryKV,
    
    // Types
    type ServerState,
    type EntityTx
} from '../src';

async function runDemo() {
    console.log('=== XLN v2 Architecture Demo ===\n');
    
    // 1. Initialize server with flat entity ledger
    console.log('1. Creating server with single-source-of-truth entity ledger...');
    let registry = createRegistry();
    
    // Register entities with ergonomic type constructors
    registry = registerEntity(registry, 'vault', [signer(0), signer(1)], 5000); // 5s timeout
    registry = registerEntity(registry, 'wallet', [signer(0)]); // Single signer
    
    let server = createServerState(height(0), registry);
    
    // 2. Add entities to the single ledger
    console.log('2. Adding entities to flat ledger (O(1) lookups!)...');
    const vaultEntity = createEntity(height(0), { balance: 10000n });
    const walletEntity = createEntity(height(0), { balance: 0n });
    
    server = addEntityToServer(server, entity('vault'), registry.get(entity('vault'))!, vaultEntity);
    server = addEntityToServer(server, entity('wallet'), registry.get(entity('wallet'))!, walletEntity);
    
    console.log(`  Entities: ${server.entities.size} (direct Map access)`);
    console.log(`  Vault balance: ${(server.entities.get(entity('vault')) as any).state.balance}`);
    console.log(`  Wallet balance: ${(server.entities.get(entity('wallet')) as any).state.balance}\n`);
    
    // 3. Create strongly typed transactions
    console.log('3. Creating strongly typed transactions...');
    const txs: EntityTx[] = [
        { op: 'burn', data: { amount: '1000' } },
        { op: 'transfer', data: { amount: '2000', to: 'wallet' } }
    ];
    
    // Add transactions to vault entity (they need to be added to entity mempool first)
    server = {
        ...server,
        mempool: [
            { signer: signer(0), entityId: entity('vault'), input: { type: 'add_tx', tx: txs[0] } },
            { signer: signer(0), entityId: entity('vault'), input: { type: 'add_tx', tx: txs[1] } }
        ]
    };
    
    console.log(`  Transaction types: ${txs.map(tx => tx.op).join(', ')}`);
    
    // 4. Process block to add transactions to entity mempools
    console.log('\n4. First block: Adding transactions to entity mempools...');
    let result = await processBlock(server);
    if (!result.ok) {
        console.error('Block processing failed:', result.error);
        return;
    }
    server = result.value;
    
    const vaultState = server.entities.get(entity('vault')) as any;
    console.log(`  Vault mempool: ${vaultState.mempool.length} transactions`);
    console.log(`  Vault balance: ${vaultState.state.balance} (unchanged)`);
    
    // Now propose a block for the vault
    server = {
        ...server,
        mempool: [{
            signer: signer(0), // First signer is the proposer at height 0
            entityId: entity('vault'),
            input: { type: 'propose_block', txs: vaultState.mempool }
        }]
    };
    
    // 5. Process block with proposal
    console.log('\n5. Second block: Processing vault proposal...');
    result = await processBlock(server);
    if (!result.ok) {
        console.error('Block processing failed:', result.error);
        return;
    }
    server = result.value;
    
    // Now we should have an approval request in the mempool
    console.log(`  Mempool after proposal: ${server.mempool.length} transactions`);
    console.log(`  Vault state: ${(server.entities.get(entity('vault')) as any).tag}`);
    
    // 6. Process approval
    console.log('\n6. Third block: Processing approval and commit...');
    result = await processBlock(server);
    if (!result.ok) {
        console.error('Block processing failed:', result.error);
        return;
    }
    server = result.value;
    
    // Check final state
    const finalVault = server.entities.get(entity('vault')) as any;
    const finalWallet = server.entities.get(entity('wallet')) as any;
    
    console.log(`  Vault balance: ${finalVault.state.balance} (was 10000)`);
    console.log(`  Wallet balance: ${finalWallet.state.balance} (was 0)`);
    console.log(`  Transfer message routed: ${server.mempool.some(tx => 
        tx.entityId === entity('wallet') && tx.input.type === 'add_tx'
    )}`);
    
    // 7. Auto-proposal for single-signer wallet
    console.log('\n7. Fourth block: Auto-proposal for single-signer wallet...');
    result = await processBlock(server);
    if (!result.ok) {
        console.error('Block processing failed:', result.error);
        return;
    }
    server = result.value;
    
    console.log(`  Wallet auto-proposed: ${server.mempool.some(tx => 
        tx.entityId === entity('wallet') && tx.input.type === 'commit_block'
    )}`);
    
    // 8. Final block to commit wallet changes
    console.log('\n8. Fifth block: Committing wallet changes...');
    result = await processBlock(server);
    if (!result.ok) {
        console.error('Block processing failed:', result.error);
        return;
    }
    server = result.value;
    
    const finalWallet2 = server.entities.get(entity('wallet')) as any;
    console.log(`  Final wallet balance: ${finalWallet2.state.balance}`);
    console.log(`  Final server height: ${server.height}`);
    
    // 9. Architecture benefits summary
    console.log('\n=== Architecture Benefits ===');
    console.log('✅ Single entity ledger: O(1) lookups, no duplication');
    console.log('✅ Type safety: EntityTx with discriminated unions');
    console.log('✅ Simplified pipeline: Just 3 clear phases');
    console.log('✅ Protocol system: Business logic separated from consensus');
    console.log('✅ Ergonomic APIs: entity(), signer(), height() helpers');
    console.log('✅ Auto-proposals: Optimized for single-signer entities');
    console.log('✅ Immutable patterns: Functional programming throughout');
}

// Run the demo
runDemo().catch(console.error);