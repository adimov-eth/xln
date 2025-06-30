/********************************************************************
 * xln‑mini.ts  –  the tiniest useful demo of XLN flow
 *
 * 1. signer 3 submits Tx “increment counter by 1”
 * 2. signer 1 (the fixed proposer) builds a block
 * 3. signer 2 & 3 validate it
 * 4. signer 1 commits; everyone updates local state
 *******************************************************************/

import crypto from 'crypto';

/* ------------------------------------------------------------------ */
/*  Helpers: toy “crypto”                                              */
/* ------------------------------------------------------------------ */
const sha256 = (d: string) => crypto.createHash('sha256').update(d).digest('hex');
function sign(data: string, key: string)   { return sha256(data + key); }
function verify(d: string, sig: string, k: string) { return sig === sha256(d + k); }

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Tx        = { readonly op: 'increment'; value: number };
type BlockHash = string;

interface Block {
  readonly prev   : BlockHash;
  readonly txs    : readonly Tx[];
  readonly hash   : BlockHash;           // sha256(prev+txs)
  readonly proposer : string;
  readonly sigs   : Record<string, string>; // address → signature
}

interface Entity {
  readonly address : string;
  readonly quorum  : readonly string[];
  proposer         : string;             // fixed for demo
  stage            : 'idle'|'proposed';
  mempool          : Tx[];
  lastHash         : BlockHash;
  state            : { counter: number };
  pending?         : Block;              // last proposed block
}

interface Message {
  readonly from  : string;               // signer address
  readonly to    : string;               // signer address
  readonly cmd   : 'addTx'|'proposeBlock'|'validateBlock'|'commitBlock';
  readonly data  : any;
}

/* ------------------------------------------------------------------ */
/*  Simple “network”                                                   */
/* ------------------------------------------------------------------ */
const BUS: Message[] = [];
function send(msg: Message) { BUS.push(msg); }

/* ------------------------------------------------------------------ */
/*  Signers                                                            */
/* ------------------------------------------------------------------ */
type Signer = {
  readonly address : string;
  readonly key     : string;
  inbox            : Message[];
  entities         : Record<string, Entity>;
};

function mkSigner(addr: string): Signer {
  return {
    address: addr,
    key    : 'KEY_'+addr,         // toy key
    inbox  : [],
    entities: {}
  };
}

/* ------------------------------------------------------------------ */
/*  Demo entity shared by all signers                                  */
/* ------------------------------------------------------------------ */
function bootstrapEntity(): Entity {
  return {
    address : '0x42',
    quorum  : ['0x1','0x2','0x3'],
    proposer: '0x1',
    stage   : 'idle',
    mempool : [],
    lastHash: 'GENESIS',
    state   : { counter: 0 }
  };
}

/* ------------------------------------------------------------------ */
/*  Instantiate three signers                                          */
/* ------------------------------------------------------------------ */
const signer1 = mkSigner('0x1');
const signer2 = mkSigner('0x2');
const signer3 = mkSigner('0x3');
const SIGNERS: Record<string, Signer> = { '0x1': signer1, '0x2': signer2, '0x3': signer3 };

// every signer starts with its own *copy* of the same entity
for (const s of Object.values(SIGNERS))
  s.entities['0x42'] = JSON.parse(JSON.stringify(bootstrapEntity()));

const entityAddr = '0x42';

/* ------------------------------------------------------------------ */
/*  1. signer‑3 submits a Tx                                           */
/* ------------------------------------------------------------------ */
const tx: Tx = { op: 'increment', value: 1 };

send({
  from: signer3.address,
  to  : signer1.address,                     // proposer
  cmd : 'addTx',
  data: { tx, sig: sign(JSON.stringify(tx), signer3.key) }
});

/* ------------------------------------------------------------------ */
/*  Processing loop                                                    */
/* ------------------------------------------------------------------ */
while (BUS.length) {
  const msg = BUS.shift()!;
  const dest = SIGNERS[msg.to];
  if (!dest) { console.error('No such signer:', msg.to); continue; }

  dest.inbox.push(msg);

  /* process synchronously for demo – one message at a time           */
  while (dest.inbox.length) {
    const m = dest.inbox.shift()!;
    handleMessage(dest, m);
  }
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                           */
/* ------------------------------------------------------------------ */
function handleMessage(signer: Signer, m: Message) {
  const ent = signer.entities[entityAddr]!;

  switch (m.cmd) {
    /* -------------------------------------------------------------- */
    case 'addTx': {
      const { tx, sig } = m.data;
      if (!verify(JSON.stringify(tx), sig, SIGNERS[m.from]?.key || '')) {
        console.error('invalid tx signature'); return;
      }
      ent.mempool.push(tx);

      /* proposer builds a block immediately once it has something   */
      if (signer.address === ent.proposer && ent.stage === 'idle') {
        const block: Block = {
          prev : ent.lastHash,
          txs  : [...ent.mempool],
          hash : sha256(ent.lastHash + JSON.stringify(ent.mempool)),
          proposer: signer.address,
          sigs : { [signer.address]: sign('', signer.key) } // self‑sig placeholder
        };
        ent.stage   = 'proposed';
        ent.pending = block;
        ent.mempool = [];

        /* broadcast to other quorum members                         */
        for (const q of ent.quorum) {
          if (q === signer.address) continue;
          send({ from: signer.address, to: q, cmd: 'proposeBlock', data: block });
        }
      }
      break;
    }
    /* -------------------------------------------------------------- */
    case 'proposeBlock': {
      const block: Block = m.data;
      /* naive checks                                                */
      if (block.prev !== ent.lastHash) { console.error('fork!'); return; }
      if (block.hash !== sha256(block.prev + JSON.stringify(block.txs))) {
        console.error('bad hash'); return;
      }

      /* sign & send back                                            */
      const sig = sign(block.hash, signer.key);
      send({ from: signer.address, to: block.proposer, cmd: 'validateBlock',
             data: { hash: block.hash, sig } });
      break;
    }
    /* -------------------------------------------------------------- */
    case 'validateBlock': {
      const { hash, sig } = m.data;
      const pending = ent.pending!;
      if (hash !== pending.hash) { console.error('hash mismatch'); return; }
      if (!verify(hash, sig, SIGNERS[m.from]?.key || '')) {
        console.error('bad validation sig'); return;
      }
      pending.sigs[m.from] = sig;

      /* commit when we have *all* quorum sigs                       */
      if (Object.keys(pending.sigs).length === ent.quorum.length) {
        commitBlock(ent, pending);

        /* broadcast commit                                           */
        for (const q of ent.quorum)
          if (q !== signer.address)
            send({ from: signer.address, to: q, cmd: 'commitBlock', data: pending });
      }
      break;
    }
    /* -------------------------------------------------------------- */
    case 'commitBlock': {
      const block: Block = m.data;
      commitBlock(ent, block);
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Commit helper – apply txs & advance chain                          */
/* ------------------------------------------------------------------ */
function commitBlock(ent: Entity, block: Block) {
  if (block.hash === ent.lastHash) return;           // already applied
  for (const tx of block.txs)
    if (tx.op === 'increment') ent.state.counter += tx.value;
  ent.lastHash = block.hash;
  ent.stage    = 'idle';
  ent.pending  = undefined;
}

/* ------------------------------------------------------------------ */
/*  Final state check                                                  */
/* ------------------------------------------------------------------ */
console.log('\nFinal counter at each signer:');
for (const [addr, s] of Object.entries(SIGNERS))
  console.log(`  ${addr} →`, s.entities[entityAddr]?.state.counter);




type ServerBlock = {
    readonly height: BlockHeight;
    readonly timestamp: number;
    readonly transactions: readonly ServerTx[];  // All messages routed this tick
    readonly stateHash: string;                  // Hash of entire server state
    readonly parentHash?: string;
  };






  