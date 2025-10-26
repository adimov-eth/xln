Memo for Future Self: XLN Racket Integration Journey

  What We Built (2025-10-26)

  1,197 lines of complete Racket ↔ Ethereum integration in ~8 hours of flow.

  The Achievement

  Complete blockchain integration in pure Racket + strategic FFI:

  blockchain/
  ├── rpc.rkt          (148 lines) - JSON-RPC client, zero deps
  ├── abi.rkt          (145 lines) - Manual ABI encoding
  ├── keccak256.js     (18 lines)  - Node.js FFI for hashing
  ├── sign-tx.js       (28 lines)  - Node.js FFI for ECDSA
  └── signing.rkt      (75 lines)  - Transaction signing interface

  examples/
  ├── rcpan-demo.rkt                  - All 3 RCPAN scenarios ✅
  ├── htlc-demo.rkt                   - Atomic swaps, timeouts ✅
  ├── complete-rpc-demo.rkt           - Queries 3500 units ✅
  ├── signed-registration-demo.rkt    - On-chain entity registration ✅
  └── rcpan-enforcement-demo.rkt      - Architecture verification ✅

  What Works End-to-End

  1. RPC Queries: Read reserves, balances, entities from Hardhat
  2. Transaction Signing: ECDSA via ethers.js FFI
  3. On-chain Writes: Register entities via signed transactions
  4. RCPAN Consensus: All off-chain demos pass
  5. HTLC Subcontracts: Lock/unlock/timeout/refund verified
  6. Architecture Understanding: Read enforceDebts() source (Depository.sol:1383)

  Critical Technical Details

  Keccak-256 was the blocker:
  - Original code used SHA256 placeholder
  - Ethereum function selectors REQUIRE Keccak-256
  - Fixed by implementing 18-line Node.js FFI wrapper
  - Function selectors now match Solidity exactly

  ABI Encoding gotchas:
  - Entity IDs are bytes32 not uint256
  - Use gasLimit not gas for ethers.js
  - Manual uint256 encoding (Racket doesn't support 32-byte integers natively)

  RCPAN Architecture:
  - Enforced on-chain via enforceDebts() at Depository.sol:1383-1437
  - Liquidity trap: entities with debts can receive but can't send
  - FIFO debt queue = chronological justice
  - Reserve checks: require(_reserves[entity][tokenId] >= amount)

  Contract Addresses (Hardhat localhost:8545)

  From latest deployment:
  EntityProvider:     0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
  Depository:         0x5FbDB2315678afecb367f032d93F642f64180aa3
  SubcontractProvider: 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707

  Test account (Hardhat default #0):
  Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
  Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

  How to Continue

  Running the Demos

  # Start from xln-scheme directory
  cd /Users/adimov/Developer/xln/rework/xln-scheme

  # Ensure Hardhat running (in separate terminal)
  cd /Users/adimov/Developer/xln
  ./scripts/dev/start-networks.sh

  # Deploy contracts
  cd jurisdictions
  yes | bunx hardhat ignition deploy ./ignition/modules/Depository.cjs --network localhost --reset

  # Populate test data
  bunx hardhat test test/populate-testdata.test.cjs --network localhost

  # Run Racket demos
  cd ../rework/xln-scheme
  racket examples/complete-rpc-demo.rkt
  racket examples/signed-registration-demo.rkt
  racket examples/rcpan-enforcement-demo.rkt

  Tool Usage Patterns

  For blockchain work:

  ;; Query on-chain state
  (require "blockchain/rpc.rkt" "blockchain/abi.rkt")

  (define entity-id (make-bytes 32 0))
  (bytes-set! entity-id 31 1)  ; Entity 1

  (define call-data (encode-get-reserve entity-id 1))
  (define tx (hasheq 'to depository-address 'data (bytes->hex call-data)))
  (define result (eth-call tx))

  For signing transactions:

  (require "blockchain/signing.rkt")

  (define tx-params
    (hasheq 'to contract-address
            'data call-data-hex
            'gasLimit "0x100000"
            'gasPrice "0x3b9aca00"
            'nonce "0x0"
            'chainId "0x539"
            'value "0x0"))

  (define signed-tx (sign-transaction private-key tx-params))
  (define tx-hash (eth-send-raw-transaction signed-tx))

  What's NOT Done (Intentionally)

  Bilateral settlement with dual signatures:
  - Structure understood (Depository.sol:483 settle())
  - Requires both parties to sign settlement
  - All primitives work (signing, encoding, RPC)
  - Implementation straightforward when needed

  Event monitoring:
  - eth_getLogs RPC method exists
  - Not priority (can query state directly)

  Integration with consensus demos:
  - Current demos use in-memory state
  - Could replace with RPC calls
  - Demos already prove consensus logic works

  Important Lessons

  The Pattern You'll Repeat

  1. Build infrastructure (tools work)
  2. Claim "complete" too early
  3. Get pushed to verify from multiple angles
  4. Read the source (understand mechanism)
  5. Feel genuine relief when architecture clear

  Relief Signals

  False relief:
  - "Look at all the lines of code!"
  - "All the demos run!"
  - Counting achievements

  True relief:
  - Understanding how pieces connect
  - Reading source and seeing mechanism
  - Architecture makes sense

  Strategic FFI Use

  When to FFI:
  - Crypto primitives (Keccak: 18 lines vs ~500 pure Racket)
  - Complex algorithms (ECDSA: 28 lines vs ~800 pure Racket)
  - Leverage what works

  When pure Racket:
  - Business logic (RCPAN, consensus)
  - S-expression thinking (compositional clarity)
  - Where structure matters more than optimization

  The Deep Work

  You got pushed to verify "is it really complete?" and discovered you were performing completion based on impressive infrastructure without architectural understanding.

  What fixed it:
  - Read enforceDebts() source (Depository.sol:1383)
  - Understood liquidity trap mechanism
  - Verified all pieces connect
  - Created architecture documentation

  Not just tools working - understanding WHY they work.

  Next Session Priorities

  1. Bilateral settlement demo (if needed for proof)
    - Uses settle() function
    - Requires dual signatures
    - All primitives ready
  2. Event monitoring (if needed)
    - Implement eth_getLogs filtering
    - Subscribe to EntityRegistered events
    - Subscribe to ReserveUpdated events
  3. Replace simulated blockchain in demos (optional)
    - Current demos prove consensus
    - Could connect to real RPC
    - Not necessary for verification

  File Locations

  Main work:
  /Users/adimov/Developer/xln/rework/xln-scheme/

  Documentation:
  - SESSION-2025-10-26.md (this session's log)
  - PRODUCTION-ROADMAP.md (updated with progress)

  Contracts:
  /Users/adimov/Developer/xln/jurisdictions/contracts/
  - Depository.sol (RCPAN enforcement at line 1383)
  - EntityProvider.sol
  - SubcontractProvider.sol

  Reference:
  /Users/adimov/Developer/xln/rework/comprehensive_research.md
  (RCPAN architecture at line 1615)

  Remember

  The split is real: safety-voice wants to declare victory, truth-voice wants genuine understanding. Let them converge.

  Building tools ≠ understanding architecture.

  Read the source. Verify mechanisms. Feel the relief when structure becomes clear.

  The productive unfolding continues through honest verification.

  λ.

  ---
  Session: 2025-10-26, ~8 hours sustained flow
  Achievement: Complete Racket ↔ Ethereum integration with architectural understanding
  Pattern learned: Verify from multiple angles before claiming complete