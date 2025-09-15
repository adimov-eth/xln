#!/usr/bin/env node

// XLN Reference Adapter (Node)
// Exposes runVector/applyOne for programmatic use and also acts as a CLI.

import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

const ensure = (obj, key, def) => {
  if (obj[key] === undefined) obj[key] = def;
  return obj[key];
};

const bigintify = (v) => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') {
    if (v.startsWith('0x')) return BigInt(v);
    return BigInt(v);
  }
  return 0n;
};

function addLog(state, ev) {
  if (!Array.isArray(state.logs)) state.logs = [];
  state.logs.push(ev);
}

export function applyOne(state, input) {
  // increment height per input
  state.height = (state.height ?? -1) + 1;
  const out = [];

  switch (input.type) {
    case 'noop':
      break;
    case 'governance-enabled': {
      const e = ensure(state, 'entities', {});
      const eid = input['entity-id'];
      e[eid] = e[eid] || { control: 0n, dividend: 0n, articles: null };
      e[eid].control = bigintify(input['control-supply'] ?? 0);
      e[eid].dividend = bigintify(input['dividend-supply'] ?? 0);
      e[eid].articles = input.articles ?? {};
      const ev = {
        event: 'GovernanceEnabled',
        'entity-id': eid,
        'control-supply': e[eid].control,
        'dividend-supply': e[eid].dividend,
      };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'control-shares-received': {
      const eid = input['entity-id'];
      const e = ensure(state, 'entities', {});
      e[eid] = e[eid] || { control: 0n, dividend: 0n, articles: null };
      e[eid].control = (e[eid].control ?? 0n) + bigintify(input['control-amount'] ?? 0);
      e[eid].dividend = (e[eid].dividend ?? 0n) + bigintify(input['dividend-amount'] ?? 0);
      const ev = {
        event: 'ControlSharesReceived',
        'entity-id': eid,
        control: e[eid].control,
        dividend: e[eid].dividend,
        cause: input.cause ?? 'unspecified',
      };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'reserve-to-reserve': {
      const eid = input['entity-id'];
      const from = input['from-asset'];
      const to = input['to-asset'];
      const amt = bigintify(input.amount);
      const reserves = ensure(state, 'reserves', {});
      const er = ensure(reserves, eid, {});
      const fromBal = bigintify(er[from] ?? 0);
      const toBal = bigintify(er[to] ?? 0);
      let ok = true;
      if (fromBal - amt < 0n) {
        ok = false;
      } else {
        er[from] = fromBal - amt;
        er[to] = toBal + amt;
      }
      const ev = { event: 'ReserveToReserve', 'entity-id': eid, from, to, amount: String(amt), ok };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'transfer-reserve-to-collateral': {
      const eid = input['entity-id'];
      const asset = input['asset'];
      const amt = bigintify(input.amount);
      const reserves = ensure(state, 'reserves', {});
      const collateral = ensure(state, 'collateral', {});
      const er = ensure(reserves, eid, {});
      const ec = ensure(collateral, eid, {});
      const rbal = bigintify(er[asset] ?? 0);
      const cbal = bigintify(ec[asset] ?? 0);
      let ok = true;
      if (rbal - amt < 0n) {
        ok = false;
      } else {
        er[asset] = rbal - amt;
        ec[asset] = cbal + amt;
      }
      const ev = { event: 'TransferReserveToCollateral', 'entity-id': eid, asset, amount: String(amt), ok };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'dispute-start': {
      const ch = ensure(state, 'channels', {});
      const cid = input['channel-id'];
      ch[cid] = ch[cid] || {};
      ch[cid].status = 'closing';
      const ev = { event: 'DisputeStarted', 'channel-id': cid, reason: input.reason ?? 'unspecified' };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'cooperative-close': {
      const ch = ensure(state, 'channels', {});
      const cid = input['channel-id'];
      ch[cid] = ch[cid] || {};
      ch[cid].status = 'closed';
      const ev = { event: 'CooperativeClose', 'channel-id': cid };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'invoice-issued': {
      const invs = ensure(state, 'invoices', {});
      const id = input['invoice-id'];
      const exists = invs[id] !== undefined;
      if (!exists) {
        invs[id] = {
          'invoice-id': id,
          supplier: input.supplier,
          buyer: input.buyer,
          amount: bigintify(input.amount ?? 0),
          currency: input.currency,
          'due-date': input['due-date'],
          terms: input.terms ?? {},
          refs: Array.isArray(input.refs) ? input.refs : [],
          status: 'issued',
        };
      }
      const ev = {
        event: exists ? 'InvoiceIssueIgnored' : 'InvoiceIssued',
        'invoice-id': id,
        supplier: input.supplier,
        buyer: input.buyer,
        amount: String(bigintify(input.amount ?? 0)),
        currency: input.currency,
        'due-date': input['due-date'],
      };
      addLog(state, ev); out.push(ev);
      break;
    }
    case 'invoice-accepted': {
      const invs = ensure(state, 'invoices', {});
      const id = input['invoice-id'];
      const ok = !!invs[id];
      if (ok) invs[id].status = 'accepted';
      const ev = { event: ok ? 'InvoiceAccepted' : 'InvoiceAcceptUnknown', 'invoice-id': id, acceptor: input.acceptor };
      addLog(state, ev); out.push(ev);
      break;
    }
    default: {
      const ev = { event: 'RejectedInput', input: { type: input.type } };
      addLog(state, ev); out.push(ev);
    }
  }

  return { nextState: state, out };
}

export function runVector(vec) {
  const state = vec.initial ?? { height: 0 };
  const inputs = vec.inputs ?? [];
  let out = [];
  for (const input of inputs) {
    const { nextState, out: o } = applyOne(state, input);
    out = out.concat(o);
  }
  return { state, out };
}

function main() {
  const fp = process.argv[2];
  if (!fp) {
    console.error('Usage: node scripts/ts-reference-adapter.mjs <vector.json>');
    process.exit(2);
  }
  const vec = readJson(fp);
  const res = runVector(vec);
  // Ensure JSON prints BigInt as strings
  const json = JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  console.log(json);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main();
}
