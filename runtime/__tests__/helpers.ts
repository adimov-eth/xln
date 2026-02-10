/**
 * Test harness for consensus integration tests.
 * Extracted from settle.ts / lock-ahb.ts scenario patterns.
 * Creates real Env with BrowserVM, entities via process(), no mocks.
 */

import type { Env, EntityReplica, RoutedEntityInput } from '../types';
import type { AccountKey, TokenId } from '../ids';
import { BrowserVMProvider } from '../jadapter';
import { createGossipLayer } from '../networking/gossip';
import { setBrowserVMJurisdiction } from '../evm';
import { ensureSignerKeysFromSeed, advanceScenarioTime, getProcess, getApplyRuntimeInput } from '../scenarios/helpers';

// ─── Constants ───────────────────────────────────────────────────────────────

const SCENARIO_START_TIMESTAMP = 1700000000000;
const JURISDICTION_NAME = 'Test J';
const USDC_TOKEN_ID = 1;
const DECIMALS = 18n;
const ONE_TOKEN = 10n ** DECIMALS;

export const usd = (amount: number | bigint) => BigInt(amount) * ONE_TOKEN;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestEntity {
  id: string;
  signerId: string;
}

export interface TestEnv {
  env: Env;
  browserVM: BrowserVMProvider;
  process: (inputs?: RoutedEntityInput[]) => Promise<void>;
  converge: (maxCycles?: number) => Promise<void>;
  tick: () => Promise<void>;
}

// ─── Env Factory ─────────────────────────────────────────────────────────────

export async function createTestEnv(): Promise<TestEnv> {
  const env: Env = {
    eReplicas: new Map(),
    jReplicas: new Map(),
    evms: new Map(),
    height: 0,
    timestamp: SCENARIO_START_TIMESTAMP,
    runtimeInput: { runtimeTxs: [], entityInputs: [] },
    history: [],
    gossip: createGossipLayer(),
    frameLogs: [],
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    emit: () => {},
  } as Env;

  env.scenarioMode = true;
  env.quietRuntimeLogs = true;
  env.runtimeSeed = '';

  // Init BrowserVM
  const browserVM = new BrowserVMProvider();
  await browserVM.init();
  browserVM.setQuietLogs(true);
  env.browserVM = browserVM;

  const depositoryAddress = browserVM.getDepositoryAddress();
  const entityProviderAddress = browserVM.getEntityProviderAddress();
  setBrowserVMJurisdiction(env, depositoryAddress, browserVM);

  // Create JAdapter
  const { createBrowserVMAdapter } = await import('../jadapter/browservm');
  const { ethers } = await import('ethers');
  const { BrowserVMEthersProvider } = await import('../jadapter/browservm-ethers-provider');
  const bvmProvider = new BrowserVMEthersProvider(browserVM);
  const bvmSigner = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    bvmProvider as any,
  );
  const jadapter = await createBrowserVMAdapter(
    { mode: 'browservm', chainId: 31337 },
    bvmProvider as any,
    bvmSigner as any,
    browserVM as any,
  );

  env.jReplicas.set(JURISDICTION_NAME, {
    name: JURISDICTION_NAME,
    blockNumber: 0n,
    stateRoot: new Uint8Array(32),
    mempool: [],
    blockDelayMs: 100,
    lastBlockTimestamp: env.timestamp,
    position: { x: 0, y: 0, z: 0 },
    depositoryAddress,
    entityProviderAddress,
    contracts: { depository: depositoryAddress, entityProvider: entityProviderAddress },
    jadapter,
  } as any);
  env.activeJurisdiction = JURISDICTION_NAME;

  jadapter.startWatching(env);

  const processFn = await getProcess();

  const wrappedProcess = async (inputs?: RoutedEntityInput[]) => {
    await processFn(env, inputs);
    advanceScenarioTime(env);
  };

  const wrappedConverge = async (maxCycles = 20) => {
    for (let i = 0; i < maxCycles; i++) {
      await wrappedProcess();

      // Check all work queues (mirrors scenarios/helpers.ts converge pattern)
      let hasWork = false;
      const e = env as Env & Record<string, unknown>;
      const pendingOutputs = env.pendingOutputs?.length ?? 0;
      const pendingNetwork = Array.isArray(e['pendingNetworkOutputs']) ? e['pendingNetworkOutputs'].length : 0;
      const pendingInbox = Array.isArray(e['networkInbox']) ? e['networkInbox'].length : 0;
      const pendingInputs = env.runtimeInput?.entityInputs?.length ?? 0;

      if (pendingOutputs > 0 || pendingNetwork > 0 || pendingInbox > 0 || pendingInputs > 0) {
        hasWork = true;
      }

      for (const [, replica] of env.eReplicas) {
        if (replica.mempool.length > 0 || replica.proposal || replica.lockedFrame) {
          hasWork = true;
          break;
        }
        for (const [, account] of replica.state.accounts) {
          if (account.mempool.length > 0 || account.proposal) {
            hasWork = true;
            break;
          }
        }
        if (hasWork) break;
      }

      if (!hasWork) return;
    }
  };

  const wrappedTick = async () => {
    await wrappedProcess();
  };

  return { env, browserVM, process: wrappedProcess, converge: wrappedConverge, tick: wrappedTick };
}

// ─── Entity Factory ──────────────────────────────────────────────────────────

let nextSignerId = 2; // 1 is reserved for foundation in EntityProvider

export function resetSignerCounter() {
  nextSignerId = 2;
}

export async function createEntity(
  testEnv: TestEnv,
  name: string,
  opts?: { validators?: string[]; threshold?: bigint },
): Promise<TestEntity> {
  const { env, browserVM } = testEnv;
  const signerId = String(nextSignerId++);
  const signerIds = opts?.validators ?? [signerId];

  ensureSignerKeysFromSeed(env, signerIds, name);

  // Register with EntityProvider
  if (browserVM.registerEntitiesWithSigners) {
    await browserVM.registerEntitiesWithSigners(signerIds.slice(0, 1));
  }

  const entityId = `0x${signerId.padStart(64, '0')}`;
  const depositoryAddress = browserVM.getDepositoryAddress();
  const entityProviderAddress = browserVM.getEntityProviderAddress();

  const jurisdiction = {
    name: JURISDICTION_NAME,
    chainId: 31337,
    address: 'browservm://',
    entityProviderAddress,
    depositoryAddress,
  };

  const applyRuntimeInput = await getApplyRuntimeInput();
  await applyRuntimeInput(env, {
    runtimeTxs: [
      {
        type: 'importReplica' as const,
        entityId,
        signerId,
        data: {
          isProposer: true,
          config: {
            mode: 'proposer-based' as const,
            threshold: opts?.threshold ?? 1n,
            validators: signerIds,
            shares: Object.fromEntries(signerIds.map(s => [s, 1n])),
            jurisdiction,
          },
        },
      },
    ],
    entityInputs: [],
  });

  return { id: entityId, signerId };
}

// ─── Multi-Signer Entity Factory ─────────────────────────────────────────────

export interface MultiSignerEntity {
  id: string;
  proposerId: string;
  validators: string[];
  threshold: bigint;
}

export async function createMultiSignerEntity(
  testEnv: TestEnv,
  name: string,
  validatorCount: number,
  threshold: bigint,
): Promise<MultiSignerEntity> {
  const { env, browserVM } = testEnv;

  // Allocate signer IDs
  const validators: string[] = [];
  for (let i = 0; i < validatorCount; i++) {
    validators.push(String(nextSignerId++));
  }
  const proposerId = validators[0]!;

  ensureSignerKeysFromSeed(env, validators, name);

  if (browserVM.registerEntitiesWithSigners) {
    await browserVM.registerEntitiesWithSigners(validators.slice(0, 1));
  }

  const entityId = `0x${proposerId.padStart(64, '0')}`;
  const depositoryAddress = browserVM.getDepositoryAddress();
  const entityProviderAddress = browserVM.getEntityProviderAddress();

  const jurisdiction = {
    name: JURISDICTION_NAME,
    chainId: 31337,
    address: 'browservm://',
    entityProviderAddress,
    depositoryAddress,
  };

  const config = {
    mode: 'proposer-based' as const,
    threshold,
    validators,
    shares: Object.fromEntries(validators.map(s => [s, 1n])),
    jurisdiction,
  };

  const applyRuntimeInput = await getApplyRuntimeInput();

  // Create one replica per validator (proposer first, then non-proposers)
  await applyRuntimeInput(env, {
    runtimeTxs: validators.map((signerId, i) => ({
      type: 'importReplica' as const,
      entityId,
      signerId,
      data: {
        isProposer: i === 0,
        config,
      },
    })),
    entityInputs: [],
  });

  return { id: entityId, proposerId, validators, threshold };
}

/** Find all replicas for a given entityId */
export function findAllReplicas(env: Env, entityId: string) {
  const replicas: Array<{ signerId: string; replica: import('../types').EntityReplica }> = [];
  for (const [key, replica] of env.eReplicas.entries()) {
    if (key.startsWith(`${entityId}:`)) {
      replicas.push({ signerId: replica.signerId, replica });
    }
  }
  return replicas;
}

// ─── Account Operations ──────────────────────────────────────────────────────

export async function openAccount(
  testEnv: TestEnv,
  entityA: TestEntity,
  entityB: TestEntity,
  opts?: { tokenId?: number; creditAmount?: bigint },
): Promise<void> {
  const tokenId = opts?.tokenId ?? USDC_TOKEN_ID;
  const creditAmount = opts?.creditAmount ?? usd(1000);

  // A opens account to B with credit (also sends notification to B creating mirror account)
  await testEnv.process([
    {
      entityId: entityA.id,
      signerId: entityA.signerId,
      entityTxs: [{ type: 'openAccount', data: { targetEntityId: entityB.id, creditAmount, tokenId } }],
    },
  ]);

  // B extends credit to A (B's mirror account was already created by A's notification)
  // Using extendCredit instead of openAccount avoids the "already exists" early return
  await testEnv.process([
    {
      entityId: entityB.id,
      signerId: entityB.signerId,
      entityTxs: [{ type: 'extendCredit', data: { counterpartyEntityId: entityA.id, amount: creditAmount, tokenId } }],
    },
  ]);

  // Let bilateral consensus converge (proposal + ACK)
  await testEnv.converge();
}

export async function pay(
  testEnv: TestEnv,
  from: TestEntity,
  to: TestEntity,
  amount: bigint,
  opts?: { tokenId?: number; route?: string[]; description?: string },
): Promise<void> {
  const tokenId = opts?.tokenId ?? USDC_TOKEN_ID;
  const route = opts?.route ?? [from.id, to.id];

  await testEnv.process([
    {
      entityId: from.id,
      signerId: from.signerId,
      entityTxs: [
        {
          type: 'directPayment',
          data: {
            targetEntityId: to.id,
            tokenId,
            amount,
            route,
          },
        },
      ],
    },
  ]);

  // Bilateral consensus needs multiple ticks:
  // 1. Proposer creates frame + sends proposal
  // 2. Counterparty validates + sends ACK
  // 3. Proposer receives ACK + commits
  // Run enough cycles to fully converge
  await testEnv.converge(10);
}

// ─── State Accessors ─────────────────────────────────────────────────────────

export function findReplica(env: Env, entityId: string): EntityReplica {
  for (const [key, replica] of env.eReplicas.entries()) {
    if (key.startsWith(`${entityId}:`)) return replica;
  }
  throw new Error(`Replica not found for ${entityId.slice(-8)}`);
}

export function getOffdelta(env: Env, entityA: string, entityB: string, tokenId = USDC_TOKEN_ID): bigint {
  const rep = findReplica(env, entityA);
  // Account may be stored under counterparty's ID
  const account = rep.state.accounts.get(entityB as AccountKey);
  if (!account) return 0n;
  return account.deltas.get(tokenId as TokenId)?.offdelta ?? 0n;
}

export function getAccountHeight(env: Env, entityA: string, entityB: string): number {
  const rep = findReplica(env, entityA);
  const account = rep.state.accounts.get(entityB as AccountKey);
  return account?.currentHeight ?? 0;
}

export function getEntityHeight(env: Env, entityId: string): number {
  return findReplica(env, entityId).state.height;
}

export function getAccountFrameHash(env: Env, entityA: string, entityB: string): string {
  const rep = findReplica(env, entityA);
  const account = rep.state.accounts.get(entityB as AccountKey);
  return account?.currentFrame.stateHash ?? '';
}

export function hasPendingProposal(env: Env, entityA: string, entityB: string): boolean {
  const rep = findReplica(env, entityA);
  const account = rep.state.accounts.get(entityB as AccountKey);
  return !!account?.proposal;
}

export function getAccount(env: Env, entityA: string, entityB: string) {
  const rep = findReplica(env, entityA);
  return rep.state.accounts.get(entityB as AccountKey);
}

export function getDelta(env: Env, entityA: string, entityB: string, tokenId = USDC_TOKEN_ID) {
  const account = getAccount(env, entityA, entityB);
  return account?.deltas.get(tokenId as TokenId);
}

export function getLocks(env: Env, entityA: string, entityB: string) {
  const account = getAccount(env, entityA, entityB);
  return account?.locks;
}
