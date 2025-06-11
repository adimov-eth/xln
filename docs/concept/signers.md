XLN Architecture Update: Current Vision

Based on recent clarifications from the XLN founder, the architecture has been simplified from four layers to three layers.

What "Signer" Actually Means Now

Signer is NOT a machine - it's an organizational grouping concept:

Data structure: Array of arrays signers[i][j] where:

i = signer index (0, 1, 2...)

j = entities belonging to that signer

Purpose: Groups entities by cryptographic ownership

Key derivation: Each signer index derives its private key from the server's master secret

Analogy: Think "account" or "signatory" - a logical grouping, not a processing unit

Simplified Flow

type ServerState = {
  height: number;
  signers: EntityState[][];  // signers[signerIndex][entityIndex]
  mempool: ServerTx[];
};

type ServerTx = {
  signerIndex: number;  // which "account/group" 
  entityIndex: number;  // which entity in that group
  input: EntityInput;
};


Key Changes from Previous Documentation

Removed: Signer machines as separate state machines

Removed: Three-layer hierarchy (Server → Signer → Entity)

Simplified: Direct Server → Entity relationship

Clarified: "Signer" = organizational grouping + key derivation index

Updated: No intermediate consensus layer - just Server routing to Entities

Why This Change?

The founder noted that having a separate Signer machine layer was unnecessary complexity. The system achieves the same simulation goals with:

Cleaner architecture: Fewer layers to manage

Better performance: No intermediate state management

Simpler reasoning: Direct server-to-entity communication

Maintained functionality: Entity grouping and key management preserved

Signer = signing tool/mechanism

More precisely:

Cryptographic identity that can sign transactions for different entities

Key derivation index (signer[0], signer[1], signer[2]...) that generates different private keys from the server's master secret

Organizational grouping - "this set of entities belongs to this signatory"

Think of it like:

Signer[0] = "Alice's signing key" → owns entities A, B, C

Signer[1] = "Bob's signing key" → owns entities D, E

Signer[2] = "DAO's signing key" → owns entity F

When an entity needs to do something (propose a block, send a transaction), it uses its signer's private key to create valid cryptographic signatures.

The founder mentioned you could use one key for everything, but having multiple signers creates better simulation of a real distributed system where different parties control different entities.

So yes - signer = the signing tool that provides cryptographic authority for a group of entities.

Potentially might be named Sigil or Clavis