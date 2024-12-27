/**
 * XLN: Ethereum Lightning Network State
 *
 * This file holds a detailed representation of the current XLN state,
 * including tokens, entity providers, depository information, and an
 * example aggregator-level HSTM implementation.
 */

export const XLN = {
    /**
     * token descriptions, not part of protocol data representation
     */
    tokens: {
      '0x5555772846680b2d55f4724546996789aa000000': {
        name: 'USDT',
        symbol: 'USDT',
        decimals: 18,
        totalSupply: '1000000000000000000000000', // 1M tokens
        holders: {
          '0x4200000000000000000000000000000000000000': '500000000000000000000000', // 500k
          '0x4200000000000000000000000000000000000001': '300000000000000000000000', // 300k
          '0x4200000000000000000000000000000000000002': '200000000000000000000000'  // 200k
        }
      },
      '0x6623451555f4724546996789aa0231789aa00000': {
        name: 'USDC',
        symbol: 'USDC',
        decimals: 18,
        totalSupply: '2000000000000000000000000', // 2M tokens
        holders: {
          '0x4200000000000000000000000000000000000000': '800000000000000000000000',
          '0x4200000000000000000000000000000000000001': '700000000000000000000000',
          '0x4200000000000000000000000000000000000002': '500000000000000000000000'
        }
      },
      '0x4200000000000000000000000000000000000002': {
        name: 'Token of Example corporate entity',
        symbol: 'xCorp1Shares',
        decimals: 18,
        totalSupply: '100000000000000000000000',  // 100k tokens
        holders: {
          '0x4200000000000000000000000000000000000000': '40000000000000000000000',
          '0x4200000000000000000000000000000000000001': '35000000000000000000000',
          '0x4200000000000000000000000000000000000002': '25000000000000000000000'
        }
      },
    },
  
    /**
     * entityProvider specifies the addresses used to create
     * programmable governance structures. Each 'entity' below
     * has a name, a board array for multi-sig or voting-based
     * management, and current/next board hash references.
     */
    entityProvider: {
      address: '0x8888888888888888888888888888888888888888',
      entities: {
        '0x4200000000000000000000000000000000000000': {
          name: 'Boris',
          board: [
            1,
            [
              '0x0000000000000000000000000000000000000001', // Another entity or user
              1, // Voting power or signature weighting
            ],
          ],
          currentBoardHash:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          nextBoardHash:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          channels: ['0xchannel1', '0xchannel3'],
          status: 'active',
          lastActivity: 1680000002000
        },
        '0x4200000000000000000000000000000000000001': {
          name: 'Egor',
          board: [
            1,
            [
              '0x0000000000000000000000000000000000000002',
              1,
            ],
          ],
          currentBoardHash:
            '0x1111111111111111111111111111111111111111111111111111111111111111',
          nextBoardHash:
            '0x1111111111111111111111111111111111111111111111111111111111111112',
          channels: ['0xchannel1', '0xchannel2'],
          status: 'active',
          lastActivity: 1680000002500
        },
        '0x4200000000000000000000000000000000000002': {
          name: 'Example corporate entity',
          // board containing entity 0x4200000000000000000000000000000000000000 & entity 0x4200000000000000000000000000000000000001
          // signature threshold is 2, each entity has voting power 1
          board: [
            2,
            [
              [
                '0x4200000000000000000000000000000000000000',
                1,
              ],
            ],
            [
              '0x4200000000000000000000000000000000000001',
              1,
            ],
          ],
          currentBoardHash:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
          nextBoardHash:
            '0x2222222222222222222222222222222222222222222222222222222222222223',
          channels: ['0xchannel2'],
          status: 'active',
          lastActivity: 1680000003000
        },
        '0x4200000000000000000000000000000000000003': {
          name: 'Fourth Example Entity',
          board: [
            1,
            [
              '0x0000000000000000000000000000000000000004',
              1,
            ],
          ],
          currentBoardHash:
            '0x3333333333333333333333333333333333333333333333333333333333333333',
          nextBoardHash:
            '0x3333333333333333333333333333333333333333333333333333333333333334',
          channels: ['0xchannel3'],
          status: 'pending',
          lastActivity: 1680000003500
        },
      },
    },
  
    /**
     * depository: stores references to token types, as well as
     * current token balances for each entity (tracked in 'reserves').
     * The 'tokens' property uses a numeric key to identify each token type,
     * which can be ERC1155 or ERC20, among others.
     */
    depository: {
      address: '0x7777777777777777777777777777777777777777',
      tokens: {
        1: [1155, '0x8888888888888888888888888888888888888888', '0x4200000000000000000000000000000000000002'],
        2: [20, '0x5555772846680b2d55f4724546996789aa000000', 0], // USDT
        3: [20, '0x6623451555f4724546996789aa0231789aa00000', 0], // USDC
      },
      /**
       * The 'reserves' map tracks how many tokens each entity has
       * in the system, keyed by:
       *   hash(entityProviderAddress, entityId)
       * Each integer key (like 1,2,3) references a token in the 'tokens' object above.
       */
      reserves: {
        // xCorp1Shares for example corporate entity
        // hash(0x8888888888888888888888888888888888888888, 0x4200000000000000000000000000000000000002)
        '0x8888420000000000000000000000000000000002': {
          1: 99999700000,
        },
        // USDT, USDC, etc. for Boris
        // hash(0x8888888888888888888888888888888888888888, 0x4200000000000000000000000000000000000000)
        '0x8888420000000000000000000000000000000000': {
          1: 100000,
          2: 10000,
          3: 5000,
        },
        // USDT, USDC, etc. for Egor
        // hash(0x8888888888888888888888888888888888888888, 0x4200000000000000000000000000000000000001)
        '0x8888420000000000000000000000000000000001': {
          1: 200000,
          2: 1000000,
          3: 500000,
        },
      },
    },
  
    /**
     * HSTM: Hierarchical State Transition Machine
     * Implements a DAG-based state machine with LRU caching and hashcash verification
     */
    HSTM: {
      '0x3233232323232323232323232323232323232323232323232323232323232323': {
        metrics: {
          totalTransactions: 156742,
          activeChannels: 843,
          totalVolume: {
            '0x5555772846680b2d55f4724546996789aa000000': '45638291000000000000000000', // 45.6M USDT
            '0x6623451555f4724546996789aa0231789aa00000': '89127634000000000000000000'  // 89.1M USDC
          },
          lastDayVolume: {
            '0x5555772846680b2d55f4724546996789aa000000': '1234567000000000000000000',  // 1.23M USDT
            '0x6623451555f4724546996789aa0231789aa00000': '2345678000000000000000000'   // 2.34M USDC
          },
          avgBlockTime: 2.3, // seconds
          lastBlockTime: 1680000002600,
          uptime: 2592000, // 30 days in seconds
          peakTPS: 458,
          currentTPS: 127,
          mempoolSize: 234,
          nodeCount: 15,
          activePeers: 12
        },

        lruCache: {
          capacity: 1000,
          size: 156,
          pruneCount: 2891,
          lastPruneTime: 1680000001800,
          tokens: {
            '0xabcd': { ts: 1680000000000, difficulty: 4, nonce: '0x1234', issuer: '0x4200000000000000000000000000000000000000', usageCount: 23 },
            '0xdef0': { ts: 1680000001000, difficulty: 4, nonce: '0x5678', issuer: '0x4200000000000000000000000000000000000001', usageCount: 15 },
            '0xf123': { ts: 1680000002000, difficulty: 5, nonce: '0x9abc', issuer: '0x4200000000000000000000000000000000000002', usageCount: 8 },
            // ... more tokens ...
            '0xf789': { ts: 1680000002500, difficulty: 4, nonce: '0xdef0', issuer: '0x4200000000000000000000000000000000000001', usageCount: 1 }
          }
        },

        claimchain: {
          head: {
            blockHash: '0xf1f1f1',
            timestamp: 1680000002000,
            number: 42897,
            prev: '0xe0e0e0',
            merkleRoot: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            difficulty: 4,
            input: {
              type: 'BATCH',
              data: {
                transactions: [
                  {
                    type: 'TRANSFER',
                    token: '0x5555772846680b2d55f4724546996789aa000000',
                    amount: '1000000000000000000',
                    from: '0x4200000000000000000000000000000000000000',
                    to: '0x4200000000000000000000000000000000000001',
                    nonce: 5,
                    signature: '0xalicesig',
                    fee: '100000000000000', // 0.0001 ETH
                    gasPrice: '50000000000' // 50 gwei
                  },
                  {
                    type: 'CHANNEL_UPDATE',
                    channelId: '0xchannel1',
                    balanceUpdate: {
                      token: '0x5555772846680b2d55f4724546996789aa000000',
                      amount: '-1000000000000000000',
                      participant: '0x4200000000000000000000000000000000000000'
                    },
                    signature: '0xalicesig2',
                    timestamp: 1680000002000,
                    nonce: 127,
                    fee: '50000000000000' // 0.00005 ETH
                  }
                ],
                merkleProof: [
                  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                  '0x2345678901bcdef2345678901bcdef2345678901bcdef2345678901bcdef2345'
                ]
              }
            },
            output: {
              balances: {
                '0x4200000000000000000000000000000000000000': {
                  '0x5555772846680b2d55f4724546996789aa000000': '499000000000000000000000',
                  '0x6623451555f4724546996789aa0231789aa00000': '800000000000000000000000'
                },
                '0x4200000000000000000000000000000000000001': {
                  '0x5555772846680b2d55f4724546996789aa000000': '301000000000000000000000',
                  '0x6623451555f4724546996789aa0231789aa00000': '700000000000000000000000'
                }
              },
              channels: {
                '0xchannel1': {
                  participants: [
                    '0x4200000000000000000000000000000000000000',
                    '0x4200000000000000000000000000000000000001'
                  ],
                  balances: {
                    '0x5555772846680b2d55f4724546996789aa000000': {
                      '0x4200000000000000000000000000000000000000': '4000000000000000000',
                      '0x4200000000000000000000000000000000000001': '6000000000000000000'
                    }
                  },
                  nonce: 12,
                  lastUpdate: 1680000002000,
                  status: 'active',
                  disputePeriod: 86400, // 24 hours in seconds
                  gracePeriod: 3600,    // 1 hour in seconds
                  channelType: 'bilateral',
                  version: 1,
                  metadata: {
                    name: "Alice-Bob Channel",
                    created: 1679900000000,
                    lastActivity: 1680000002000,
                    totalTransactions: 127,
                    averageTransactionSize: '5000000000000000000' // 5 USDT
                  }
                }
              },
              nonce: 42897,
              timestamp: 1680000002000,
              stateRoot: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
              receiptRoot: '0x5432109876abcdef5432109876abcdef5432109876abcdef5432109876abcdef'
            }
          },

          mempool: {
            transactions: [
              {
                type: 'CHANNEL_UPDATE',
                channelId: '0xchannel1',
                update: {
                  balances: {
                    '0x5555772846680b2d55f4724546996789aa000000': {
                      '0x4200000000000000000000000000000000000000': '3800000000000000000',
                      '0x4200000000000000000000000000000000000001': '6200000000000000000'
                    }
                  },
                  nonce: 13,
                  metadata: {
                    reason: "Payment for services",
                    reference: "INV-2023-12345"
                  }
                },
                signature: '0xalicesig3',
                timestamp: 1680000002500,
                gasPrice: '45000000000', // 45 gwei
                maxFeePerGas: '100000000000', // 100 gwei
                priorityFee: '2000000000' // 2 gwei
              },
              {
                type: 'TRANSFER',
                token: '0x6623451555f4724546996789aa0231789aa00000',
                amount: '1000000000000000000',
                from: '0x4200000000000000000000000000000000000001',
                to: '0x4200000000000000000000000000000000000000',
                nonce: 6,
                signature: '0xbobsig2',
                timestamp: 1680000002600,
                gasPrice: '50000000000',
                maxFeePerGas: '100000000000',
                priorityFee: '3000000000'
              }
            ],
            size: 234,
            maxSize: 1000,
            metrics: {
              avgWaitTime: 2.5, // seconds
              avgGasPrice: '48000000000', // 48 gwei
              peakSize: 567,
              rejectedCount: 123,
              pendingVolume: {
                '0x5555772846680b2d55f4724546996789aa000000': '25000000000000000000000', // 25k USDT
                '0x6623451555f4724546996789aa0231789aa00000': '15000000000000000000000'  // 15k USDC
              }
            }
          },

          history: {
            blocks: {
              '0xe0e0e0': {
                blockHash: '0xe0e0e0',
                timestamp: 1680000001000,
                number: 42896,
                prev: '0xd0d0d0',
                merkleRoot: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                transactions: [
                  {
                    type: 'CHANNEL_OPEN',
                    channelId: '0xchannel1',
                    participants: [
                      '0x4200000000000000000000000000000000000000',
                      '0x4200000000000000000000000000000000000001'
                    ],
                    initialBalances: {
                      '0x5555772846680b2d55f4724546996789aa000000': {
                        '0x4200000000000000000000000000000000000000': '5000000000000000000',
                        '0x4200000000000000000000000000000000000001': '5000000000000000000'
                      }
                    },
                    channelConfig: {
                      disputePeriod: 86400,
                      gracePeriod: 3600,
                      channelType: 'bilateral',
                      version: 1
                    },
                    metadata: {
                      purpose: "Trading channel",
                      category: "business",
                      tags: ["high-volume", "trusted"]
                    }
                  }
                ],
                metrics: {
                  size: 1457, // bytes
                  gasUsed: 145678,
                  baseFeePerGas: '40000000000',
                  priorityFeePerGas: '2000000000'
                }
              }
            },
            lastPruned: 41896,
            maxBlocks: 1000,
            pruningMetrics: {
              lastPruneTime: 1680000000000,
              prunedBlocks: 41896,
              averageBlockSize: 2345, // bytes
              totalStorageSaved: 98234567, // bytes
              pruningInterval: 1000 // blocks
            }
          }
        },

        entities: {
          'Bob': {
            channels: {
              '0xchannel1': {
                head: {
                  blockHash: '0xc1c1c1',
                  timestamp: 1680000002500,
                  number: 13,
                  prev: '0xc0c0c0',
                  merkleRoot: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
                  input: {
                    type: 'CHANNEL_UPDATE',
                    update: {
                      balances: {
                        '0x5555772846680b2d55f4724546996789aa000000': {
                          '0x4200000000000000000000000000000000000000': '3900000000000000000',
                          '0x4200000000000000000000000000000000000001': '6100000000000000000'
                        }
                      },
                      nonce: 13,
                      metadata: {
                        description: "Payment for services",
                        invoiceRef: "INV-2023-12345",
                        category: "business"
                      }
                    },
                    signatures: ['0xalicesig', '0xbobsig']
                  },
                  output: {
                    success: true,
                    newBalances: {
                      '0x5555772846680b2d55f4724546996789aa000000': {
                        '0x4200000000000000000000000000000000000000': '3900000000000000000',
                        '0x4200000000000000000000000000000000000001': '6100000000000000000'
                      }
                    },
                    events: [
                      {
                        type: 'BALANCE_CHANGE',
                        token: '0x5555772846680b2d55f4724546996789aa000000',
                        participant: '0x4200000000000000000000000000000000000000',
                        oldBalance: '4000000000000000000',
                        newBalance: '3900000000000000000',
                        timestamp: 1680000002500
                      },
                      {
                        type: 'BALANCE_CHANGE',
                        token: '0x5555772846680b2d55f4724546996789aa000000',
                        participant: '0x4200000000000000000000000000000000000001',
                        oldBalance: '6000000000000000000',
                        newBalance: '6100000000000000000',
                        timestamp: 1680000002500
                      }
                    ]
                  }
                },
                metrics: {
                  totalTransactions: 13,
                  volume: '65000000000000000000000', // 65k USDT
                  averageTransactionSize: '5000000000000000000', // 5 USDT
                  largestTransaction: '10000000000000000000000', // 10k USDT
                  lastActivity: 1680000002500,
                  uptime: 259200, // 3 days in seconds
                  disputeCount: 0,
                  successRate: 100 // percentage
                }
              }
            }
          },
          'Carol': {
            channels: {
              '0xchannel2': {
                head: {
                  blockHash: '0xc2c2c2',
                  timestamp: 1680000003000,
                  number: 5,
                  prev: '0xc1c1c1',
                  merkleRoot: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                  input: {
                    type: 'CHANNEL_DEPOSIT',
                    token: '0x6623451555f4724546996789aa0231789aa00000',
                    amount: '5000000000000000000',
                    from: '0x4200000000000000000000000000000000000002',
                    metadata: {
                      purpose: "Initial channel funding",
                      source: "external deposit",
                      reference: "DEP-2023-67890"
                    }
                  },
                  output: {
                    success: true,
                    newBalances: {
                      '0x6623451555f4724546996789aa0231789aa00000': {
                        '0x4200000000000000000000000000000000000002': '5000000000000000000'
                      }
                    },
                    events: [
                      {
                        type: 'DEPOSIT',
                        token: '0x6623451555f4724546996789aa0231789aa00000',
                        amount: '5000000000000000000',
                        participant: '0x4200000000000000000000000000000000000002',
                        timestamp: 1680000003000
                      }
                    ]
                  }
                },
                metrics: {
                  totalTransactions: 5,
                  volume: '25000000000000000000000', // 25k USDC
                  averageTransactionSize: '5000000000000000000', // 5 USDC
                  largestTransaction: '10000000000000000000000', // 10k USDC
                  lastActivity: 1680000003000,
                  uptime: 86400, // 1 day in seconds
                  disputeCount: 0,
                  successRate: 100 // percentage
                }
              }
            }
          }
        }
      }
    },
  
    /**
     * aggregator: a detailed example aggregator-level state to illustrate
     * how an HSTM aggregator might maintain local "signers," each with its
     * own chain of finalized/proposed blocks, channels, etc.
     */
    aggregator: {
      signers: {
        /**
         * "0xAlice" is an example signer address that the aggregator tracks.
         * She has local finalized blocks representing her “personal chain,”
         * plus a list of “proposed blocks” that she has not finalized yet,
         * and any channels she’s establishing with other participants.
         */
        '0xAlice': {
          privateKey: '0xALICE_PRIVATE_KEY', // Typically not stored in plaintext
          headBlockHash: '0xe4fb9c', // The latest finalized block for Alice

          headSig: '',
          checkpoints: [['hash100','sig100'],['hash200','sig200']],

          head: {
            prev: {
                prev: '0x0',
                input: '',
            },
            input: {
                '': [{
                    type: 'update',
                    token: 2,
                    reserve: 1000 
                }]
            },
            output: {
                '': {
                    'reserve[2]': 1000
                },
                '0xBob': {
                    head: {
                        prev: '',
                        output: {
                            '': {
                                'board': [2, ['alice',1],['bob',1]]
                            }
                        }
                    }
                }


            }

          },
  
          finalizedBlocks: {
            // Genesis block created with empty transactions
            '0x000000': {
              blockHash: '0x000000',
              prevBlockHash: null,
              timestamp: 1680000000000,
              transactions: [],
              signatures: [],
            },
            // Example block where Alice receives some deposit
            '0xa1b2c3': {
              blockHash: '0xa1b2c3',
              prevBlockHash: '0x000000',
              timestamp: 1680000001000,
              transactions: [
                {
                  type: 'DEPOSIT',
                  description: 'Funds arrived in token USDT',
                  token: 'USDT',
                  amount: 500,
                  from: 'DepositoryContract',
                  to: '0xAlice',
                },
              ],
              signatures: ['AliceSignatureOfBlock1'],
            },
            // Next finalized block: Alice spent some USDT
            '0xe4fb9c': {
              blockHash: '0xe4fb9c',
              prevBlockHash: '0xa1b2c3',
              timestamp: 1680000002000,
              transactions: [
                {
                  type: 'TRANSFER',
                  description: 'Alice sends 100 USDT to 0xDeadBeef',
                  token: 'USDT',
                  amount: 100,
                  from: '0xAlice',
                  to: '0xDeadBeef',
                },
              ],
              signatures: ['AliceSignatureOfBlock2'],
            },
          },
  
          proposedBlocks: [
            {
              // Proposed block referencing the current head
              tentativeBlockHash: '0x01abcd',
              prevBlockHash: '0xe4fb9c',
              timestamp: 1680000002500,
              transactions: [
                {
                  type: 'CREATE_CHANNEL',
                  description: 'Alice proposes opening a channel with Bob',
                  partner: '0xBob',
                },
              ],
              signatures: [],
            },
          ],
  
          channels: {
            /**
             * If a channel is established with Bob, we store a local sub-chain
             * or mini-state-machine referencing that channel’s own finalized blocks,
             * proposed blocks, etc.
             */
            '0xBob': {
              genesisBlock: {
                blockHash: '0xChannelGenesisAB',
                prevBlockHash: null,
                timestamp: 1680000002600,
                transactions: [],
                signatures: [],
              },
              headBlockHash: '0xChannelGenesisAB',
              finalizedBlocks: {
                '0xChannelGenesisAB': {
                  blockHash: '0xChannelGenesisAB',
                  prevBlockHash: null,
                  timestamp: 1680000002600,
                  transactions: [],
                  signatures: [],
                },
              },
              proposedBlocks: [],
            },
          },
        },
  
        /**
         * "0xBob" is another example signer. He also keeps track of his local chain
         * of finalized blocks, possibly waiting for new proposals from Alice.
         */
        '0xBob': {
          privateKey: '0xBOB_PRIVATE_KEY',
          headBlockHash: '0xf5f111',
  
          finalizedBlocks: {
            '0x000000': {
              blockHash: '0x000000',
              prevBlockHash: null,
              timestamp: 1680000000000,
              transactions: [],
              signatures: [],
            },
            '0xf5f111': {
              blockHash: '0xf5f111',
              prevBlockHash: '0x000000',
              timestamp: 1680000002000,
              transactions: [
                {
                  type: 'DEPOSIT',
                  description: 'Bob receives 3000 USDT from depositor',
                  token: 'USDT',
                  amount: 3000,
                  from: 'DepositoryContract',
                  to: '0xBob',
                },
              ],
              signatures: ['BobSignatureOfBlock1'],
            },
          },
  
          proposedBlocks: [
            // Potential new blocks from Bob’s side, if any
          ],
  
          channels: {
            // If/when Bob finalizes or acknowledges a new channel with Alice,
            // an entry would appear here matching that of Alice’s channel state.
          },
        },
      },
    },
  };
  