import type {
  Input, Replica, Command, ServerFrame, ServerState,
  TS, Hex, Address, UInt64
} from '../types';
import { addrKey } from '../types';
import { applyCommand } from './entity';
import { keccak_256 as keccak } from '@noble/hashes/sha3';
import { encServerFrame } from '../codec/rlp';

/* ──────────── Merkle root computation (simplified binary tree for MVP) ──────────── */
/** Compute a Merkle-like root over all replicas' last states. (Here we just hash the JSON of all state snapshots.) */
const computeRoot = (reps: Map<string, Replica>): Hex =>
  ('0x' + Buffer.from(
      keccak(JSON.stringify(
        [...reps.values()].map(r => ({ addr: r.address, state: r.last.state })),
        (_, v) => typeof v === 'bigint' ? v.toString() : v
      ))
    ).toString('hex')) as Hex;

/* ──────────── helper: trivial power calc (all shares = 1 in MVP) ──────────── */
const power = (sigs: Map<Address, string>, q: any) =>
  sigs.size;  // in our genesis, each signer has 1 share

/* ──────────── Pure Server reducer (executed every 100ms tick) ──────────── */
/**
 * Apply a batch of Inputs to the server's state for one tick.
 * @param prev - previous ServerState
 * @param batch - list of Inputs received in this tick
 * @param ts - current wall-clock timestamp (ms) for this tick
 * @returns { state: next ServerState, frame: ServerFrame, outbox: Input[] }
 */
export function applyServerBlock(prev: ServerState, batch: Input[], ts: TS) {
  let outbox: Input[] = [];
  const replicas = new Map(prev.replicas);

  const enqueue = (...msgs: Input[]) => { outbox.push(...msgs); };

  for (const { cmd } of batch) {
    /* — Determine routing key — 
       If the command is entity-specific, we route it to the Replica state that should handle it.
       We use addrKey (jurisdiction:entity) plus the signer's address for uniqueness when needed. */
    const signerPart =
      cmd.type === 'ADD_TX' ? cmd.tx.from :
      cmd.type === 'SIGN'   ? cmd.signer   : '';
    const key = (cmd.type === 'IMPORT')
      ? ''
      : cmd.addrKey + (signerPart ? ':' + signerPart : '');

    /* — IMPORT command (bootstrap a new Entity into server state) — */
    if (cmd.type === 'IMPORT') {
      const baseReplica = cmd.replica;
      const eKey = addrKey(baseReplica.address);  // e.g. "demo:chat"
      // Clone and insert one Replica per signer in the quorum (each signer will have its own replica state)
      for (const signerAddr of Object.keys(baseReplica.last.state.quorum.members)) {
        const replicaCopy: Replica = { ...baseReplica, proposer: signerAddr as Address };
        replicas.set(`${eKey}:${signerAddr}`, replicaCopy);
      }
      continue;  // move to next input
    }

    const rep = replicas.get(key) || [...replicas.values()][0];
    if (!rep) continue;  // no replica found (shouldn't happen if IMPORT done)

    /* — Apply the Entity state machine — */
    const updatedRep = applyCommand(rep, cmd);
    replicas.set(key, updatedRep);

    /* — Deterministic post-effects: generate follow-up commands if needed — */
    switch (cmd.type) {
      case 'PROPOSE': {
        if (!rep.proposal && updatedRep.proposal) {
          // Proposal just created: ask all other signers to SIGN
          for (const s of Object.keys(updatedRep.last.state.quorum.members)) {
            if (s === updatedRep.proposer) continue;  // skip proposer itself
            enqueue({
              from: s as Address,
              to:   updatedRep.proposer,
              cmd:  { type: 'SIGN', addrKey: cmd.addrKey,
                      signer: s as Address, frameHash: updatedRep.proposal.hash, sig: '0x00' as Hex }
            });
          }
        }
        break;
      }
      case 'SIGN': {
        if (updatedRep.isAwaitingSignatures && updatedRep.proposal) {
          const q = updatedRep.last.state.quorum;
          const prevPower = rep.proposal ? power(rep.proposal.sigs, q) : 0;
          const newPower  = power(updatedRep.proposal.sigs, q);
          if (prevPower < q.threshold && newPower >= q.threshold) {
            // Threshold just reached: proposer will broadcast COMMIT
            enqueue({
              from: updatedRep.proposer,
              to: '0x00' as Address,  // broadcast placeholder
              cmd:  { type: 'COMMIT', addrKey: cmd.addrKey,
                      hanko: '0x00' as Hex, frame: updatedRep.proposal as any }
            });
          }
        }
        break;
      }
      case 'ADD_TX': {
        if (!updatedRep.isAwaitingSignatures && updatedRep.mempool.length) {
          // After adding a tx, if not already proposing, automatically trigger a PROPOSE on next tick
          enqueue({
            from: rep.proposer, to: rep.proposer,
            cmd:  { type: 'PROPOSE', addrKey: cmd.addrKey, ts }
          });
        }
        break;
      }
      // COMMIT and IMPORT do not produce any outbox messages in this loop
    }
  }

  /* — After processing all inputs, build the ServerFrame for this tick — */
  const newHeight = (prev.height + 1n) as UInt64;
  const rootHash = computeRoot(replicas);  // Merkle root of all Entity states after this tick
  let frame: ServerFrame = {
    height: newHeight,
    ts,
    inputs: batch,
    root: rootHash,
    hash: '0x00' as Hex
  };
  frame.hash = ('0x' + Buffer.from(keccak(encServerFrame(frame))).toString('hex')) as Hex;

  return { state: { replicas, height: newHeight }, frame, outbox };
}

