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
      },
      '0x6623451555f4724546996789aa0231789aa00000': {
        name: 'USDC',
        symbol: 'USDC',
        decimals: 18,
      },
      '0x4200000000000000000000000000000000000002': {
        name: 'Token of Example corporate entity',
        symbol: 'xCorp1Shares',
        decimals: 18,
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
        '0x8888420000000000000000000000000000000000000000000000000000000002': {
          1: 99999700000,
        },
        // USDT, USDC, etc. for Boris
        // hash(0x8888888888888888888888888888888888888888, 0x4200000000000000000000000000000000000000)
        '0x8888420000000000000000000000000000000000000000000000000000000000': {
          1: 100000,
          2: 10000,
          3: 5000,
        },
        // USDT, USDC, etc. for Egor
        // hash(0x8888888888888888888888888888888888888888, 0x4200000000000000000000000000000000000001)
        '0x8888420000000000000000000000000000000000000000000000000000000001': {
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
        lruCache: {
          capacity: 1000,
          tokens: {
            '0xabcd': { ts: 1680000000000, difficulty: 4, nonce: '0x1234' },
            '0xdef0': { ts: 1680000001000, difficulty: 4, nonce: '0x5678' },
            '0xf123': { ts: 1680000002000, difficulty: 5, nonce: '0x9abc' }
          }
        },
  
        claimchain: {
          head: {
            blockHash: '0xf1f1f1',
            timestamp: 1680000002000,
            number: 42,
            prev: '0xe0e0e0',
            input: {
              type: 'BATCH',
              data: {
                transactions: [
                  {
                    type: 'TRANSFER',
                    token: '0x5555772846680b2d55f4724546996789aa000000', // USDT
                    amount: '1000000000000000000', // 1 USDT
                    from: '0xAlice',
                    to: '0xBob',
                    nonce: 5,
                    signature: '0xalicesig'
                  },
                  {
                    type: 'CHANNEL_UPDATE',
                    channelId: '0xchannel1',
                    balanceUpdate: {
                      token: '0x5555772846680b2d55f4724546996789aa000000',
                      amount: '-1000000000000000000',
                      participant: '0xAlice'
                    },
                    signature: '0xalicesig2'
                  }
                ]
              }
            },
            output: {
              balances: {
                '0xAlice': {
                  '0x5555772846680b2d55f4724546996789aa000000': '9000000000000000000',
                  '0x6623451555f4724546996789aa0231789aa00000': '5000000000000000000'
                },
                '0xBob': {
                  '0x5555772846680b2d55f4724546996789aa000000': '11000000000000000000',
                  '0x6623451555f4724546996789aa0231789aa00000': '3000000000000000000'
                }
              },
              channels: {
                '0xchannel1': {
                  participants: ['0xAlice', '0xBob'],
                  balances: {
                    '0x5555772846680b2d55f4724546996789aa000000': {
                      '0xAlice': '4000000000000000000',
                      '0xBob': '6000000000000000000'
                    }
                  },
                  nonce: 12,
                  lastUpdate: 1680000002000
                }
              },
              nonce: 42,
              timestamp: 1680000002000
            }
          },
  
          mpt: {
            root: '0xmptroot',
            nodes: {
              '0xmptroot': {
                children: {
                  '0x0': '0xbalances',
                  '0x1': '0xchannels'
                }
              },
              '0xbalances': {
                children: {
                  '0xAlice': {
                    value: {
                      '0x5555772846680b2d55f4724546996789aa000000': '9000000000000000000',
                      '0x6623451555f4724546996789aa0231789aa00000': '5000000000000000000'
                    }
                  },
                  '0xBob': {
                    value: {
                      '0x5555772846680b2d55f4724546996789aa000000': '11000000000000000000',
                      '0x6623451555f4724546996789aa0231789aa00000': '3000000000000000000'
                    }
                  }
                }
              },
              '0xchannels': {
                children: {
                  '0xchannel1': {
                    value: {
                      participants: ['0xAlice', '0xBob'],
                      balances: {
                        '0x5555772846680b2d55f4724546996789aa000000': {
                          '0xAlice': '4000000000000000000',
                          '0xBob': '6000000000000000000'
                        }
                      },
                      nonce: 12,
                      lastUpdate: 1680000002000
                    }
                  }
                }
              }
            }
          },
  
          stateComponents: {
            basic: {
              prev: '0xe0e0e0',
              input: {
                type: 'CHANNEL_UPDATE',
                channelId: '0xchannel1',
                update: {
                  balances: {
                    '0x5555772846680b2d55f4724546996789aa000000': {
                      '0xAlice': '3900000000000000000',
                      '0xBob': '6100000000000000000'
                    }
                  },
                  nonce: 13
                },
                signatures: ['0xalicesig', '0xbobsig']
              },
              output: {
                success: true,
                newState: {
                  channels: {
                    '0xchannel1': {
                      balances: {
                        '0x5555772846680b2d55f4724546996789aa000000': {
                          '0xAlice': '3900000000000000000',
                          '0xBob': '6100000000000000000'
                        }
                      },
                      nonce: 13,
                      lastUpdate: 1680000002500
                    }
                  }
                }
              }
            },
  
            extended: {
              head: '0xf1f1f1',
              data: {
                signerKey: '0xAlice',
                timestamp: 1680000002000,
                channelStates: {
                  '0xchannel1': {
                    status: 'ACTIVE',
                    lastSyncNonce: 12,
                    pendingUpdates: 1
                  }
                }
              }
            },
  
            full: {
              prev: '0xe0e0e0',
              input: { /* same as basic.input */ },
              output: { /* same as basic.output */ },
              mempool: [
                {
                  type: 'CHANNEL_UPDATE',
                  channelId: '0xchannel1',
                  update: {
                    balances: {
                      '0x5555772846680b2d55f4724546996789aa000000': {
                        '0xAlice': '3800000000000000000',
                        '0xBob': '6200000000000000000'
                      }
                    },
                    nonce: 14
                  },
                  signature: '0xalicesig3'
                },
                {
                  type: 'TRANSFER',
                  token: '0x6623451555f4724546996789aa0231789aa00000',
                  amount: '1000000000000000000',
                  from: '0xBob',
                  to: '0xAlice',
                  nonce: 6,
                  signature: '0xbobsig2'
                }
              ]
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
                  input: {
                    type: 'CHANNEL_UPDATE',
                    update: {
                      balances: {
                        '0x5555772846680b2d55f4724546996789aa000000': {
                          '0xAlice': '3900000000000000000',
                          '0xBob': '6100000000000000000'
                        }
                      },
                      nonce: 13
                    },
                    signatures: ['0xalicesig', '0xbobsig']
                  },
                  output: {
                    success: true,
                    newBalances: {
                      '0x5555772846680b2d55f4724546996789aa000000': {
                        '0xAlice': '3900000000000000000',
                        '0xBob': '6100000000000000000'
                      }
                    }
                  }
                },
                mpt: {
                  root: '0xbobchannelroot',
                  nodes: {
                    '0xbobchannelroot': {
                      value: {
                        balances: {
                          '0x5555772846680b2d55f4724546996789aa000000': {
                            '0xAlice': '3900000000000000000',
                            '0xBob': '6100000000000000000'
                          }
                        },
                        nonce: 13,
                        lastUpdate: 1680000002500
                      }
                    }
                  }
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
                  input: {
                    type: 'CHANNEL_DEPOSIT',
                    token: '0x6623451555f4724546996789aa0231789aa00000',
                    amount: '5000000000000000000',
                    from: 'Carol'
                  },
                  output: {
                    success: true,
                    newBalances: {
                      '0x6623451555f4724546996789aa0231789aa00000': {
                        'Carol': '5000000000000000000'
                      }
                    }
                  }
                },
                mpt: {
                  root: '0xcarolchannelroot',
                  nodes: {
                    '0xcarolchannelroot': {
                      value: {
                        balances: {
                          '0x6623451555f4724546996789aa0231789aa00000': {
                            'Carol': '5000000000000000000'
                          }
                        },
                        nonce: 5,
                        lastUpdate: 1680000003000
                      }
                    }
                  }
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