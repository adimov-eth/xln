/**
 * BrowserVMProvider - In-browser EVM using @ethereumjs/vm
 * Self-contained environment with Depository.sol
 *
 * @license AGPL-3.0
 * Copyright (C) 2025 XLN Finance
 */

import { createVM, runTx } from '@ethereumjs/vm';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAddressFromPrivateKey, hexToBytes, createAccount, bytesToHex } from '@ethereumjs/util';
import type { Address } from '@ethereumjs/util';
import { Common, Hardfork, Chain } from '@ethereumjs/common';

export class BrowserVMProvider {
  private vm: any;
  private common: any;
  private depositoryAddress: Address | null = null;
  private deployerPrivKey: Uint8Array;
  private deployerAddress: Address;
  private nonce = 0n;
  private depositoryArtifact: any = null;
  private initialized = false;

  constructor() {
    // Hardhat default account #0
    this.deployerPrivKey = hexToBytes('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    this.deployerAddress = createAddressFromPrivateKey(this.deployerPrivKey);
  }

  /** Initialize VM and deploy contracts */
  async init(): Promise<void> {
    if (this.initialized) {
      console.log('[BrowserVM] Already initialized, skipping');
      return;
    }

    // Load artifact from static/ (can't import JSON from /public in vite)
    const response = await fetch('/contracts/Depository.json');
    if (!response.ok) {
      throw new Error(`Failed to load Depository artifact: ${response.status}`);
    }
    this.depositoryArtifact = await response.json();
    console.log('[BrowserVM] Initializing...');

    // Create VM with evmOpts to disable contract size limit
    this.vm = await createVM({
      evmOpts: {
        allowUnlimitedContractSize: true, // Disable EIP-170 24KB limit for simnet
      },
    });
    this.common = this.vm.common;
    console.log('[BrowserVM] Unlimited contract size enabled for simnet');

    // Fund deployer
    const deployerAccount = createAccount({
      nonce: 0n,
      balance: 10000000000000000000000n, // 10000 ETH
    });
    await this.vm.stateManager.putAccount(this.deployerAddress, deployerAccount);

    console.log(`[BrowserVM] Deployer funded: ${this.deployerAddress.toString()}`);

    // Deploy Depository
    await this.deployDepository();

    this.initialized = true;
    console.log('[BrowserVM] Initialization complete');
  }

  /** Deploy Depository contract */
  private async deployDepository(): Promise<void> {
    console.log('[BrowserVM] Deploying Depository...');
    console.log('[BrowserVM] Bytecode length:', this.depositoryArtifact.bytecode?.length || 0);

    // Query nonce from VM state
    const currentNonce = await this.getCurrentNonce();

    const tx = createLegacyTx({
      gasLimit: 100000000n,
      gasPrice: 10n,
      data: this.depositoryArtifact.bytecode,
      nonce: currentNonce,
    }, { common: this.common }).sign(this.deployerPrivKey);

    const result = await runTx(this.vm, { tx });

    if (result.execResult.exceptionError) {
      console.error('[BrowserVM] Deployment exception:', result.execResult.exceptionError);
      console.error('[BrowserVM] Result:', JSON.stringify({
        gasUsed: result.totalGasSpent?.toString(),
        returnValue: result.execResult.returnValue?.length,
        logs: result.execResult.logs?.length
      }));
      throw new Error(`Deployment failed: ${result.execResult.exceptionError}`);
    }

    this.depositoryAddress = result.createdAddress!;
    console.log(`[BrowserVM] Deployed at: ${this.depositoryAddress.toString()}`);
    console.log(`[BrowserVM] Gas used: ${result.totalGasSpent}`);

    // Verify code exists
    const code = await this.vm.stateManager.getCode(this.depositoryAddress);
    if (code.length === 0) {
      throw new Error('Contract deployment failed - no code at address');
    }
  }

  /** Get entity reserves for a token */
  async getReserves(entityId: string, tokenId: number): Promise<bigint> {
    if (!this.depositoryAddress) {
      throw new Error('Depository not deployed');
    }

    // Encode function call: _reserves(bytes32,uint256)
    const selector = '0xacd6f208';
    const paddedEntity = entityId.startsWith('0x') ? entityId.slice(2).padStart(64, '0') : entityId.padStart(64, '0');
    const paddedTokenId = tokenId.toString(16).padStart(64, '0');
    const callData = selector + paddedEntity + paddedTokenId;

    const result = await this.vm.evm.runCall({
      to: this.depositoryAddress,
      caller: this.deployerAddress,
      data: hexToBytes(callData as `0x${string}`),
      gasLimit: 100000n,
    });

    if (result.execResult.exceptionError) {
      console.error(`[BrowserVM] getReserves failed:`, result.execResult.exceptionError);
      return 0n;
    }

    const returnData = result.execResult.returnValue;
    if (!returnData || returnData.length === 0) return 0n;

    return BigInt(bytesToHex(returnData));
  }

  /** Get total number of tokens */
  async getTokensLength(): Promise<number> {
    if (!this.depositoryAddress) {
      throw new Error('Depository not deployed');
    }

    // Encode function call: getTokensLength()
    const selector = '0xb0c26ecf'; // keccak256("getTokensLength()")[:4]

    const result = await this.vm.evm.runCall({
      to: this.depositoryAddress,
      caller: this.deployerAddress,
      data: hexToBytes(selector),
      gasLimit: 100000n,
    });

    if (result.execResult.exceptionError) {
      console.error(`[BrowserVM] getTokensLength failed:`, result.execResult.exceptionError);
      return 0;
    }

    const returnData = result.execResult.returnValue;
    if (returnData.length === 0) return 0;

    return Number(BigInt(bytesToHex(returnData)));
  }

  /** Get current nonce from VM state */
  private async getCurrentNonce(): Promise<bigint> {
    const account = await this.vm.stateManager.getAccount(this.deployerAddress);
    return account?.nonce || 0n;
  }

  /** Debug: Fund entity reserves */
  async debugFundReserves(entityId: string, tokenId: number, amount: bigint): Promise<void> {
    if (!this.depositoryAddress) {
      throw new Error('Depository not deployed');
    }

    // Encode function call: debugFundReserves(bytes32,uint256,uint256)
    const selector = '0x5ffefe5b';
    const paddedEntity = entityId.startsWith('0x') ? entityId.slice(2).padStart(64, '0') : entityId.padStart(64, '0');
    const paddedTokenId = tokenId.toString(16).padStart(64, '0');
    const paddedAmount = amount.toString(16).padStart(64, '0');
    const callData = selector + paddedEntity + paddedTokenId + paddedAmount;

    // Always query nonce from VM (don't trust local counter)
    const currentNonce = await this.getCurrentNonce();

    const tx = createLegacyTx({
      to: this.depositoryAddress,
      gasLimit: 1000000n,
      gasPrice: 10n,
      data: hexToBytes(callData as `0x${string}`),
      nonce: currentNonce,
    }, { common: this.common }).sign(this.deployerPrivKey);

    const result = await runTx(this.vm, { tx });

    if (result.execResult.exceptionError) {
      throw new Error(`debugFundReserves failed: ${result.execResult.exceptionError}`);
    }

    console.log(`[BrowserVM] Funded ${entityId.slice(0, 10)}... with ${amount} of token ${tokenId}`);
  }

  /** Execute R2R transfer */
  async reserveToReserve(from: string, to: string, tokenId: number, amount: bigint): Promise<void> {
    if (!this.depositoryAddress) {
      throw new Error('Depository not deployed');
    }

    // Encode function call: reserveToReserve(bytes32,bytes32,uint256,uint256)
    const selector = '0x3925cd44'; // keccak256("reserveToReserve(bytes32,bytes32,uint256,uint256)")[:4]
    const paddedFrom = from.startsWith('0x') ? from.slice(2).padStart(64, '0') : from.padStart(64, '0');
    const paddedTo = to.startsWith('0x') ? to.slice(2).padStart(64, '0') : to.padStart(64, '0');
    const paddedTokenId = tokenId.toString(16).padStart(64, '0');
    const paddedAmount = amount.toString(16).padStart(64, '0');
    const callData = selector + paddedFrom + paddedTo + paddedTokenId + paddedAmount;

    // Always query nonce from VM
    const currentNonce = await this.getCurrentNonce();

    const tx = createLegacyTx({
      to: this.depositoryAddress,
      gasLimit: 1000000n,
      gasPrice: 10n,
      data: hexToBytes(callData as `0x${string}`),
      nonce: currentNonce,
    }, { common: this.common }).sign(this.deployerPrivKey);

    const result = await runTx(this.vm, { tx });

    if (result.execResult.exceptionError) {
      throw new Error(`reserveToReserve failed: ${result.execResult.exceptionError}`);
    }

    console.log(`[BrowserVM] Transferred ${amount} from ${from.slice(0, 10)}... to ${to.slice(0, 10)}...`);
  }

  /** Get contract address */
  getDepositoryAddress(): string {
    return this.depositoryAddress?.toString() || '0x0';
  }
}

// Singleton instance
export const browserVMProvider = new BrowserVMProvider();
