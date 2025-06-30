import { createHash } from 'crypto';


interface Signer {
    privateKey: string;
    publicKey: string;
    address: string;
}

// Simple deterministic key generation from a server secret
function createSigners(secret: string, count: number): Signer[] {
    const signers: Signer[] = [];
    for (let i = 0; i < count; i++) {
        const privateKey = createHash('sha256').update(`${secret}:${i}`).digest('hex');
        const publicKey = `pub_${privateKey}`; // Stub
        const address = `0x${createHash('sha256').update(publicKey).digest('hex').slice(0, 40)}`;
        signers.push({ privateKey, publicKey, address });
    }
    return signers;
}


function sign(data: any, privateKey: string): string {
    const dataHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    // TODO: cryptographic signature
    return `sig(${dataHash}):signed_by(${privateKey.slice(0, 10)})`;
}

function verify(data: any, signature: string, publicKey: string): boolean {
    // TODO: verify the signature against the public key.
    return signature.startsWith(`sig(${createHash('sha256').update(JSON.stringify(data)).digest('hex')})`);
}

function getAddressFromSignature(data: any, signature: string, signers: Signer[]): string | undefined {
    // TODO: recover the public key from the signature.
    const signer = signers.find(s => signature.includes(s.privateKey.slice(0, 10)));
    return signer?.address;
}


interface Quorum {
    threshold: number; // e.g., 600 out of 1000 total shares
    signers: { address: string; shares: number }[];
}

interface Transaction {
    type: 'chat'; // Expandable to other types like 'transfer', 'createSubContract' etc.
    data: { message: string };
    nonce: number;
    signature: string; // Signature of {type, data, nonce} by the sender
}

interface EntityState {
    quorum: Quorum;
    nonces: { [signerAddress: string]: number };
    chat: { from: string; message: string; timestamp: number }[];
}

interface Frame {
    height: number;
    timestamp: number;
    transactions: Transaction[];
    state: EntityState; // The complete state *after* transactions are applied
}

interface FrameProposal {
    height: number;
    timestamp: number;
    transactions: Transaction[];
    signatures: { [signerAddress: string]: string }; // Collected signatures for this proposal
}

interface EntityReplica {
    id: string; // e.g., "my-dao"
    address: string; // e.g., "my-dao@provider.eth"
    blockProposer: string; // Address of the current proposer
    stage: 'ready' | 'awaitingSignatures'; // State of the consensus process
    mempool: Transaction[];
    lastFrame: Frame;
    nextFrameProposal: FrameProposal | null;
}

type Command =
    | { type: 'importEntity'; data: { replica: EntityReplica } }
    | { type: 'addTransaction'; data: { entityId: string; tx: Transaction } }
    | { type: 'proposeFrame'; data: { entityId: string; } } // Triggered by a timer/event
    // Internal commands for consensus, not initiated externally
    | { type: '_signFrame'; data: { entityId: string; proposal: FrameProposal; signature: string } }
    | { type: '_commitFrame'; data: { entityId: string; proposal: FrameProposal } };


interface Input {
    timestamp: number;
    commands: Command[];
}

interface ServerState {
    secret: string;
    signers: Signer[];
    replicas: { [entityId: string]: EntityReplica };
    commandQueue: Command[]; // Simulates a network message queue
}



function computeNextState(prevState: EntityState, transactions: Transaction[], timestamp: number, signers: Signer[]): EntityState {
    const nextState = JSON.parse(JSON.stringify(prevState)); // Deep copy

    for (const tx of transactions) {
        const fromAddress = getAddressFromSignature({ type: tx.type, data: tx.data, nonce: tx.nonce }, tx.signature, signers)!;
        
        // 1. Update nonce
        nextState.nonces[fromAddress]++;

        // 2. Apply transaction-specific logic
        if (tx.type === 'chat') {
            nextState.chat.push({ from: fromAddress, message: tx.data.message, timestamp });
        }
        // ... handle other transaction types here
    }
    return nextState;
}


function applyEntityCommand(replica: EntityReplica, command: Command, timestamp: number, serverSigners: Signer[]): { updatedReplica: EntityReplica, outbox: Command[] } {
    const newReplica = JSON.parse(JSON.stringify(replica)); // Deep copy
    const outbox: Command[] = [];

    switch (command.type) {
        case 'addTransaction': {
            const tx = command.data.tx;
            const fromAddress = getAddressFromSignature({ type: tx.type, data: tx.data, nonce: tx.nonce }, tx.signature, serverSigners);
            
            if (!fromAddress) {
                console.error(`[${replica.id}] Invalid signature, transaction rejected.`);
                break;
            }
            
            const expectedNonce = replica.lastFrame.state.nonces[fromAddress] || 0;
            if (tx.nonce !== expectedNonce) {
                console.error(`[${replica.id}] Invalid nonce for ${fromAddress}. Expected ${expectedNonce}, got ${tx.nonce}.`);
                break;
            }

            newReplica.mempool.push(tx);
            console.log(`[${replica.id}] Added transaction to mempool: "${tx.data.message}"`);
            break;
        }

        case 'proposeFrame': {
            if (newReplica.stage !== 'ready' || newReplica.mempool.length === 0) break;

            const proposer = serverSigners.find(s => s.address === newReplica.blockProposer)!;
            const proposal: FrameProposal = {
                height: newReplica.lastFrame.height + 1,
                timestamp: timestamp,
                transactions: [...newReplica.mempool],
                signatures: {},
            };
            
            // Proposer self-signs immediately
            const proposerSignature = sign(proposal, proposer.privateKey);
            proposal.signatures[proposer.address] = proposerSignature;
            
            newReplica.nextFrameProposal = proposal;
            newReplica.mempool = [];
            newReplica.stage = 'awaitingSignatures';
            console.log(`\n[${replica.id}] Proposer ${proposer.address} created Frame Proposal #${proposal.height}. Awaiting signatures...`);

            // Create commands for other signers to sign this proposal
            const quorumSigners = newReplica.lastFrame.state.quorum.signers;
            for (const member of quorumSigners) {
                if (member.address !== newReplica.blockProposer) {
                    const memberSigner = serverSigners.find(s => s.address === member.address)!;
                    const signature = sign(proposal, memberSigner.privateKey);
                    outbox.push({ type: '_signFrame', data: { entityId: replica.id, proposal, signature } });
                }
            }
            break;
        }

        case '_signFrame': {
            if (newReplica.stage !== 'awaitingSignatures' || !newReplica.nextFrameProposal) break;

            const signerAddress = getAddressFromSignature(command.data.proposal, command.data.signature, serverSigners)!;
            newReplica.nextFrameProposal.signatures[signerAddress] = command.data.signature;
            console.log(`[${replica.id}] Received signature from ${signerAddress}`);

            // Check if threshold is met
            const quorum = newReplica.lastFrame.state.quorum;
            let totalShares = 0;
            for (const address of Object.keys(newReplica.nextFrameProposal.signatures)) {
                const signerShare = quorum.signers.find(s => s.address === address)?.shares || 0;
                totalShares += signerShare;
            }

            if (totalShares >= quorum.threshold) {
                console.log(`[${replica.id}] Quorum threshold reached (${totalShares}/${quorum.threshold}). Committing frame.`);
                outbox.push({ type: '_commitFrame', data: { entityId: replica.id, proposal: newReplica.nextFrameProposal } });
            }
            break;
        }

        case '_commitFrame': {
            if (newReplica.stage !== 'awaitingSignatures' || !newReplica.nextFrameProposal) break;
            
            const proposal = newReplica.nextFrameProposal;
            const newEntityState = computeNextState(newReplica.lastFrame.state, proposal.transactions, proposal.timestamp, serverSigners);

            newReplica.lastFrame = {
                height: proposal.height,
                timestamp: proposal.timestamp,
                transactions: proposal.transactions,
                state: newEntityState,
            };
            newReplica.nextFrameProposal = null;
            newReplica.stage = 'ready';
            console.log(`\n[${replica.id}] Frame #${newReplica.lastFrame.height} COMMITTED.`);
            console.log(`[${replica.id}] New State: Chat length is ${newReplica.lastFrame.state.chat.length}`);
            break;
        }
    }

    return { updatedReplica: newReplica, outbox };
}


function applyServerInput(server: ServerState, input: Input): ServerState {
    const newServer: ServerState = JSON.parse(JSON.stringify(server));
    newServer.commandQueue.push(...input.commands);

    // Process the queue until it's empty (simulates message passing within a tick)
    while (newServer.commandQueue.length > 0) {
        const command = newServer.commandQueue.shift()!;
        
        if (command.type === 'importEntity') {
            const replica = command.data.replica;
            newServer.replicas[replica.id] = replica;
            console.log(`[Server] Imported new entity replica: ${replica.id}`);
        } else {
            const entityId = command.data.entityId;
            const currentReplica = newServer.replicas[entityId];
            if (currentReplica) {
                const { updatedReplica, outbox } = applyEntityCommand(currentReplica, command, input.timestamp, newServer.signers);
                newServer.replicas[entityId] = updatedReplica;
                // Add new commands to the front of the queue to be processed in the same tick
                newServer.commandQueue.unshift(...outbox);
            }
        }
    }

    return newServer;
}


function runSimulation() {
    console.log("--- XLN Core Simulation Start ---\n");

    // 1. Initialize Server
    let server: ServerState = {
        secret: randomBytes(32).toString('hex'),
        signers: createSigners('my-server-secret', 3),
        replicas: {},
        commandQueue: [],
    };
    const [signerA, signerB, signerC] = server.signers;
    console.log("Server initialized with 3 signers:", signerA.address, signerB.address, signerC.address);

    // 2. Define the Genesis Entity
    const genesisQuorum: Quorum = {
        threshold: 600,
        signers: [
            { address: signerA.address, shares: 300 },
            { address: signerB.address, shares: 300 },
            { address: signerC.address, shares: 400 },
        ],
    };
    const genesisEntity: EntityReplica = {
        id: 'dao-chat',
        address: 'dao-chat@xln.org',
        blockProposer: signerA.address,
        stage: 'ready',
        mempool: [],
        lastFrame: {
            height: 0,
            timestamp: 1000,
            transactions: [],
            state: {
                quorum: genesisQuorum,
                nonces: { [signerA.address]: 0, [signerB.address]: 0, [signerC.address]: 0 },
                chat: [],
            },
        },
        nextFrameProposal: null,
    };

    // 3. Create a scenario of inputs
    const scenario: Input[] = [
        // Tick 1: Import the entity
        {
            timestamp: 1001,
            commands: [{ type: 'importEntity', data: { replica: genesisEntity } }],
        },
        // Tick 2: Users send chat messages
        {
            timestamp: 1002,
            commands: [
                {
                    type: 'addTransaction',
                    data: {
                        entityId: 'dao-chat',
                        tx: {
                            type: 'chat',
                            data: { message: 'Hello from Signer B!' },
                            nonce: 0,
                            signature: sign({ type: 'chat', data: { message: 'Hello from Signer B!' }, nonce: 0 }, signerB.privateKey),
                        },
                    },
                },
                {
                    type: 'addTransaction',
                    data: {
                        entityId: 'dao-chat',
                        tx: {
                            type: 'chat',
                            data: { message: 'Hello from Signer C!' },
                            nonce: 0,
                            signature: sign({ type: 'chat', data: { message: 'Hello from Signer C!' }, nonce: 0 }, signerC.privateKey),
                        },
                    },
                },
            ],
        },
        // Tick 3: Proposer is triggered to create a new frame
        {
            timestamp: 1010, // 8ms later
            commands: [{ type: 'proposeFrame', data: { entityId: 'dao-chat' } }],
        },
    ];

    // 4. Run the scenario
    for (const [i, input] of scenario.entries()) {
        console.log(`\n--- TICK ${i + 1} (Timestamp: ${input.timestamp}) ---`);
        server = applyServerInput(server, input);
    }

    console.log("\n--- Simulation End ---");
    console.log("\nFinal State of Entity 'dao-chat':");
    console.log(JSON.stringify(server.replicas['dao-chat'].lastFrame, null, 2));
}

runSimulation();