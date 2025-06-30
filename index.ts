// message
// tx
// proposal
// proposedBlock

// Frame

import crypto from 'crypto';

interface Message {
  from: string;
  to: string;
  command: {
    type: string;
    data: any;
  };
}

interface Signer {
    address: string;
    key: string;
}

interface Block {
    previousHash: string;
    transactions: any[];
    hash: string;
}

function sign(data: string, key: string) {
    return crypto.createSign('RSA-SHA256').update(data).sign(key, 'base64');
}

function verify(data: string, signature: string, address: string) {
    return crypto.createVerify('RSA-SHA256').update(data).verify(address, signature, 'base64');
}

const entity = {
    address: "0x42",
    quorum: ["0x1", "0x2", "0x3"],
    blockProposer: "0x1",
    stage: "idle",
    mempool: [] as any[],
    blocks: {
        "0x0": {
            previousHash: "0x0",
            transactions: [],
            hash: "0x0"
        }
    },
    state: {
        counter: 0
    }
}

const signer1 = {
    address: "0x1",
    key: "0x1234567890",
    entities: {
        [entity.address]: entity
    }
}

const signer2 = {
    address: "0x2",
    key: "0x1234567890",
    entities: {
        [entity.address]: entity
    }
}

const signer3 = {
    address: "0x3",
    key: "0x1234567890",
    entities: {
        [entity.address]: entity
    }
}

// signer3 sends message to signer1 with proposal to increment counter by 1

const tx1 = {
    op: "createProposal",
    data: {
        action: "increment",
        payload: {
            value: 1
        }
    }
}

const message1 = {
    from: `0x${signer3.address}`,
    to: `0x${entity.address}:${entity.blockProposer}`,
    command: {
        type: "addTx",
        data: tx1,
        signature: sign(JSON.stringify(tx1), signer3.key)
    }
}

// signer1 (proposer) receives message and adds tx to mempool: 
signer1.entities[entity.address]?.mempool.push(message1);

// signer1 (blockProposer) creates a blockProposal with the tx from mempool
const blockTx = signer1.entities[entity.address]!.mempool
// clear mempool
signer1.entities[entity.address]!.mempool = [];

const block1: Block = {
    previousHash: "0x0",
    transactions: blockTx,
    hash: "0x1",
}

// signer1 (blockProposer) sends message to all signers with the block for validation
const [message2, message3] = entity.quorum.reduce((acc, signer) => {
    if (signer === entity.blockProposer) return acc 
        
    return [...acc, 
        {
            from: `0x${entity.blockProposer}`,
            to: `0x${entity.address}:${signer}`,
            command: {
                type: "proposeBlock",
                data: block1
            }
        }   
    ]
}, [] as Message[])

// signer2 receives message with block proposal and validates it
const isValid1 = verify(JSON.stringify(block1), block1.hash, signer1.address)

// if (isValid) 
// signer2 signs block proposal and sends it to signer1
const signedBlockProposal1 = sign(JSON.stringify(block1), signer2.key)
// send message to signer1 with signed block proposal
const message4 = {
    from: `0x${signer2.address}`,
    to: `0x${entity.address}:${entity.blockProposer}`,
    command: {
        type: "validateBlock",
        data: {
            block: block1,
            signature: signedBlockProposal1
        }
    }
}

// signer3 receives message with block proposal and validates it
const isValid2 = verify(JSON.stringify(block1), block1.hash, signer1.address)

// if (isValid) 
// signer3 signs block proposal and sends it to signer1
const signedBlockProposal2 = sign(JSON.stringify(block1), signer3.key)
// send message to signer1 with signed block proposal
const message5 = {
    from: `0x${signer3.address}`,
    to: `0x${entity.address}:${entity.blockProposer}`,
    command: {
        type: "validateBlock",
        data: {
            block: block1,
            signature: signedBlockProposal2
        }
    }
}

// signer1 collects all signed block proposals and commits block

const [message6, message7] = entity.quorum.reduce((acc, signer) => {
    if (signer === entity.blockProposer) return acc 
    return [...acc, 
        {
            from: entity.blockProposer,
            to: `0x${entity.address}:${signer}`,
            command: {
                type: "commitBlock",
                data: block1
            }
        }
    ]
}, [] as Message[])










const input = {
    commands: [
        {
            type: "importEntity",
            data: {
                currentFrame: {}
            }
        },

    ]

}




const server = { 
    // 32 bytes random string
    secret: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    
    // signers are array of pub/priv key pairs + address derived from pub key, created from secret

    signers: {
        "0": {
            privateKey: "0x1234567890",
            publicKey: "0x1234567890",
            address: "0x1"
        },
        "1": {
            privateKey: "0x1234567890",
            publicKey: "0x1234567890",
            address: "0x2"
        },
        "2": {
            privateKey: "0x1234567890",
            publicKey: "0x1234567890",
            address: "0x3"
        }
    },

    entityProvider: {
        // registry of entities and its quorum
    },

    // entity replicas
    entityReplicas: {
        "0": {
            // id of the entity in entity provider (32 bytes)
            id: "alice",
            // entity address =  entityid + entityprovider + jurisdiction
            address: "alice@lido.eth",

            // TODO: move quorum to current frame
            quorum: {
                // threshold is amount of shares collected to create a valid signature by the quorum
                // e.g. total shares = 1000, signer A has 300, signer B has 300, signer C has 300, signer D has 100, threshold is 600
                threshold: 600,
                // members can be later represented as array of addresses + array of shares for better rlp
                signers: [
                    {
                        address: "0x1",
                        shares: 300
                    },
                    {
                        address: "0x2",
                        shares: 300
                    },
                    {
                        address: "0x3",
                        shares: 300
                    },
                ]
            },
            // blockProposer is an address of the signer that is responsible for proposing a block, defaults of 0
            blockProposer: "0x1",
            // stage is the current state of the entity: ready, sent
            stage: "ready",
            // mempool of entity transactions
            mempool: [
                {
                    from: "0x1", // address of the signer that sent the tx
                    type: "chatMessage", // type of the tx
                    data: {
                        message: "Hello, world!"
                    },
                    signature: "0x1234567890", // signature of the tx
                    nonce: 0 // nonce of the tx
                }
            ],

            // virtual field
            // genesisFrame: {
            //     height: 0,
            //     timestamp: 0,
            //     transactions: [],
            //     entityState: {
            //         chat: []
            //     }
            // },

            currentFrame: {
                // height of the frame
                height: 1,
                // timestamp of the frame
                timestamp: 1000,
                // transactions in the frame
                transactions: [
                    {
                        from: "0x1",
                        to: "0x2",
                        message: "Hello, Bob!"
                    },
                    {
                        from: "0x2",
                        to: "0x1",
                        message: "Hello, Alice!"
                    }
                ],

                // entity state = apply(prevState, transactions)

                entityState: {
                    chat: [
                        {
                            from: "0x1",
                            to: "0x2",
                            message: "Hello, Bob!"
                        },
                        {
                            from: "0x2",
                            to: "0x1",
                            message: "Hello, Alice!"
                        }
                    ]
                }
            },

            nextFrame: {
                timestamp: 1001,
                transactions: [
                    {
                        from: "0x1",
                        to: "0x2",
                        message: "How are you?"
                    }
                ],
            }
        }
    }
}


// TODO add server's mempool for commands