/**
 * XLN Production Configuration
 *
 * Real deployment settings for the XLN trading and settlement network
 */

import { ethers } from 'ethers';

export interface XLNConfig {
  network: {
    chainId: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
  };

  trading: {
    pairs: Array<{ base: string; quote: string }>;
    spreadSplit: { maker: number; taker: number; hub: number };
    limits: {
      maxOrderValue: bigint;
      maxDailyVolume: bigint;
      minOrderAmount: bigint;
      maxOrdersPerSide: number;
    };
    circuitBreaker: {
      priceMovementThreshold: number; // percentage
      cooldownPeriod: number; // milliseconds
    };
  };

  settlement: {
    batchInterval: number; // milliseconds
    minBatchSize: number;
    maxBatchSize: number;
    finalityBlocks: number;
  };

  credit: {
    enabled: boolean;
    defaultTerms: 'NET15' | 'NET30' | 'NET60' | 'NET90';
    maxExposure: bigint;
    collateralRatios: {
      initial: number;
      minimum: number;
    };
    trustScoreThresholds: {
      excellent: { score: number; collateral: number };
      good: { score: number; collateral: number };
      medium: { score: number; collateral: number };
      low: { score: number; collateral: number };
    };
  };

  hubs: {
    primary: string;
    secondary: string[];
    congestionPricing: {
      enabled: boolean;
      alpha: number; // congestion pricing parameter
    };
  };

  monitoring: {
    metricsPort: number;
    healthcheckInterval: number;
    alertWebhook?: string;
  };
}

// Production configuration
export const PRODUCTION_CONFIG: XLNConfig = {
  network: {
    chainId: 1,
    name: 'ethereum-mainnet',
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
    explorerUrl: 'https://etherscan.io'
  },

  trading: {
    pairs: [
      { base: 'USDC', quote: 'USDT' },
      { base: 'ETH', quote: 'USDC' },
      { base: 'WBTC', quote: 'USDC' },
      { base: 'DAI', quote: 'USDC' }
    ],
    spreadSplit: {
      maker: 45,
      taker: 45,
      hub: 10
    },
    limits: {
      maxOrderValue: ethers.parseEther('1000000'), // $1M max order
      maxDailyVolume: ethers.parseEther('50000000'), // $50M daily volume
      minOrderAmount: ethers.parseEther('100'), // $100 minimum
      maxOrdersPerSide: 10000
    },
    circuitBreaker: {
      priceMovementThreshold: 10, // 10% price movement triggers halt
      cooldownPeriod: 5 * 60 * 1000 // 5 minutes
    }
  },

  settlement: {
    batchInterval: 60 * 1000, // 1 minute batches
    minBatchSize: 10,
    maxBatchSize: 1000,
    finalityBlocks: 12 // ~3 minutes on Ethereum
  },

  credit: {
    enabled: true,
    defaultTerms: 'NET30',
    maxExposure: ethers.parseEther('100000000'), // $100M max exposure
    collateralRatios: {
      initial: 20, // 20% initial collateral
      minimum: 5   // 5% minimum for excellent credit
    },
    trustScoreThresholds: {
      excellent: { score: 900, collateral: 0 },
      good: { score: 800, collateral: 5 },
      medium: { score: 700, collateral: 10 },
      low: { score: 600, collateral: 15 }
    }
  },

  hubs: {
    primary: process.env.PRIMARY_HUB || '0x' + 'a'.repeat(40),
    secondary: [
      process.env.SECONDARY_HUB_1 || '0x' + 'b'.repeat(40),
      process.env.SECONDARY_HUB_2 || '0x' + 'c'.repeat(40)
    ],
    congestionPricing: {
      enabled: true,
      alpha: 0.1 // congestion pricing sensitivity
    }
  },

  monitoring: {
    metricsPort: 9090,
    healthcheckInterval: 30 * 1000, // 30 seconds
    alertWebhook: process.env.ALERT_WEBHOOK_URL
  }
};

// Staging configuration (lower limits for testing)
export const STAGING_CONFIG: XLNConfig = {
  ...PRODUCTION_CONFIG,
  network: {
    chainId: 11155111,
    name: 'sepolia',
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY',
    explorerUrl: 'https://sepolia.etherscan.io'
  },
  trading: {
    ...PRODUCTION_CONFIG.trading,
    limits: {
      maxOrderValue: ethers.parseEther('10000'), // $10k max order
      maxDailyVolume: ethers.parseEther('100000'), // $100k daily volume
      minOrderAmount: ethers.parseEther('10'), // $10 minimum
      maxOrdersPerSide: 1000
    }
  },
  credit: {
    ...PRODUCTION_CONFIG.credit,
    maxExposure: ethers.parseEther('1000000') // $1M max exposure
  }
};

// Local development configuration
export const DEVELOPMENT_CONFIG: XLNConfig = {
  ...STAGING_CONFIG,
  network: {
    chainId: 31337,
    name: 'localhost',
    rpcUrl: 'http://127.0.0.1:8545',
    explorerUrl: 'http://localhost:3000'
  },
  settlement: {
    ...STAGING_CONFIG.settlement,
    batchInterval: 5 * 1000, // 5 seconds for faster testing
    finalityBlocks: 1
  },
  monitoring: {
    ...STAGING_CONFIG.monitoring,
    metricsPort: 9091,
    healthcheckInterval: 5 * 1000
  }
};

// Environment-based configuration selection
export function getConfig(): XLNConfig {
  const env = process.env.NODE_ENV || 'development';

  switch (env) {
    case 'production':
      return PRODUCTION_CONFIG;
    case 'staging':
      return STAGING_CONFIG;
    default:
      return DEVELOPMENT_CONFIG;
  }
}

// Validate configuration on load
export function validateConfig(config: XLNConfig): void {
  // Validate spread splits sum to 100
  const { maker, taker, hub } = config.trading.spreadSplit;
  if (maker + taker + hub !== 100) {
    throw new Error(`Invalid spread split: ${maker}+${taker}+${hub} != 100`);
  }

  // Validate trust score thresholds are in order
  const thresholds = config.credit.trustScoreThresholds;
  if (thresholds.excellent.score <= thresholds.good.score ||
      thresholds.good.score <= thresholds.medium.score ||
      thresholds.medium.score <= thresholds.low.score) {
    throw new Error('Trust score thresholds must be in descending order');
  }

  // Validate collateral requirements are in ascending order
  if (thresholds.excellent.collateral >= thresholds.good.collateral ||
      thresholds.good.collateral >= thresholds.medium.collateral ||
      thresholds.medium.collateral >= thresholds.low.collateral) {
    throw new Error('Collateral requirements must be in ascending order');
  }

  // Validate hub addresses
  if (!ethers.isAddress(config.hubs.primary)) {
    throw new Error(`Invalid primary hub address: ${config.hubs.primary}`);
  }

  for (const hub of config.hubs.secondary) {
    if (!ethers.isAddress(hub)) {
      throw new Error(`Invalid secondary hub address: ${hub}`);
    }
  }
}

// Export validated configuration
export const config = getConfig();
validateConfig(config);