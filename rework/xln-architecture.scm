;; ═══════════════════════════════════════════════════════════════════════════
;; XLN PROJECT ARCHITECTURE - COMPLETE S-EXPRESSION MAP
;; Generated: 2025-10-24
;;
;; Legend:
;;   (module name [files...] purpose flows)
;;   → = data flow direction
;;   ⊕ = aggregation/composition
;;   ⊗ = validation/filtering
;;   ∘ = function composition
;; ═══════════════════════════════════════════════════════════════════════════

(xln
  :root "/Users/adimov/Developer/xln"
  :architecture 'r-e-a  ;; Runtime → Entity → Account layers

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; CONSENSUS LAYERS (Byzantine Fault Tolerant State Machines)
  ;; ═══════════════════════════════════════════════════════════════════════

  (consensus-layers

    ;; Runtime Layer - 100ms tick coordinator
    (runtime-layer
      :tick-interval 100  ;; milliseconds
      :purpose "Coordinate all entities, merge inputs, create snapshots"

      (files
        (runtime.ts
          :loc 856
          :exports '(createEnv applyRuntimeInput process tick)
          :flow '(RuntimeInput → EntityInput[] → Env))

        (types.ts
          :loc 718
          :purpose "All TypeScript interfaces - single source of truth"
          :key-types '(Env EntityReplica EntityState AccountMachine
                      Delta AccountFrame EntityTx RuntimeInput))

        (state-helpers.ts
          :purpose "Clone functions for immutable state updates"
          :pattern 'functional-immutability))

      (data-flow
        (tick
          '(external-event → RuntimeInput)
          '(merge-inputs → Env.runtimeInput)
          '(process → EntityInput[])
          '(create-snapshot → Env.history))))

    ;; Entity Layer - BFT consensus (Tendermint-like)
    (entity-layer
      :consensus-mode '(proposer-based gossip-based)
      :safety 'byzantine-fault-tolerant

      (files
        (entity-consensus.ts
          :loc 644
          :purpose "BFT consensus: ADD_TX → PROPOSE → PRECOMMIT → COMMIT"
          :flow '(EntityInput → EntityTx[] → ProposedFrame → threshold-sigs → finalized))

        (entity-crontab.ts
          :loc 422
          :purpose "Periodic tasks: stale frame detection, hub rebalancing"
          :tasks '(stale-frame-handler hub-rebalance-handler)
          :gaps '(netting-execution))  ;; Detection exists, execution missing

        (entity-factory.ts
          :purpose "Create numbered/named entities on-chain"
          :blockchain-integration 'yes))

      (consensus-protocol
        (proposer-selection
          :mode 'static  ;; validators[0] is proposer (not rotating)
          :flow '(validators → proposer-id → mempool-collection))

        (bft-voting
          :threshold '(>= 2/3)
          :precommits '(Map signerId signature)
          :finalization '(threshold-reached → apply-frame))

        (frame-structure
          (EntityFrame
            :fields '(height txs hash newState signatures)
            :merkle-root 'stateHash))))

    ;; Account Layer - Bilateral consensus (Lightning-like channels)
    (account-layer
      :consensus-mode 'bilateral  ;; 2-of-2 required
      :pattern 'optimistic-execution

      (files
        (account-consensus.ts
          :loc 892
          :purpose "Process bilateral AccountInput, ACK frames, handle disputes"
          :flow '(AccountInput → validate → apply-txs → create-frame → sign))

        (account-utils.ts
          :purpose "Delta derivation, left/right perspective logic"
          :critical-fn 'deriveDelta  ;; Computes capacities from bilateral state)

        (account-crypto.ts
          :purpose "Frame hashing, signature verification"
          :algorithms '(keccak256 ecdsa)))

      (bilateral-protocol
        (frame-consensus
          :pattern 'ping-pong
          :flow '(A-proposes → B-validates → B-signs → A-receives → 2-of-2-finalized))

        (counter-mechanism
          :purpose "Replay protection"
          :rule '(counter = ackedTransitions + 1)  ;; No gaps allowed
          :critical 'yes)

        (delta-structure
          (Delta
            :fields '(tokenId collateral ondelta offdelta
                     leftCreditLimit rightCreditLimit
                     leftAllowance rightAllowance)
            :perspective '(left right)
            :derivation 'isLeft-determines-sign)))

      (transaction-handlers
        :location "runtime/account-tx/handlers/"
        (handlers
          (direct-payment.ts :multi-hop 'yes :forwarding 'pendingForward)
          (add-delta.ts :purpose "Add new token to account")
          (set-credit-limit.ts :purpose "Mutual credit extension")
          (reserve-to-collateral.ts :purpose "Phase 1: R→C funding")
          (request-withdrawal.ts :purpose "Phase 2: C→R withdrawal")
          (approve-withdrawal.ts :purpose "ACK/NACK withdrawal")
          (deposit-collateral.ts :purpose "Add collateral to bilateral channel")
          (request-rebalance.ts :purpose "Request hub to rebalance"))))

    ;; Entity Transaction Handlers
    (entity-tx-layer
      :location "runtime/entity-tx/"
      (files
        (apply.ts
          :loc 589
          :purpose "Route EntityTx to handlers, orchestrate outputs"
          :key-handlers '(openAccount directPayment settleDiffs))

        (handlers/account.ts
          :purpose "Process AccountInput, consume pendingForward"
          :pattern 'layer-cooperation  ;; Account sets flag, Entity consumes
          :flow '(AccountInput → processAccountInput → pendingForward? → create-next-hop)))))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; NETWORK DISCOVERY & ROUTING (Emergent from Bilateral Consensus)
  ;; ═══════════════════════════════════════════════════════════════════════

  (network-layer
    :emergence 'yes  ;; No central coordinator

    (gossip-subsystem
      :pattern 'eventually-consistent

      (files
        (gossip.ts
          :loc 109
          :purpose "Profile announcements, timestamp-based updates"
          :structure 'Profile
          :update-rule '(newTimestamp > existingTimestamp))

        (gossip-helper.ts
          :loc 70
          :purpose "Build profile from EntityState"
          :critical-fn 'buildEntityProfile  ;; Extracts tokenCapacities
          :flow '(EntityState → accounts → deltas → deriveDelta → capacities)))

      (profile-structure
        (Profile
          :fields '(entityId capabilities hubs metadata accounts)
          (metadata
            :fields '(name avatar routingFeePPM baseFee position))
          (accounts
            :structure '(counterpartyId tokenCapacities)
            (tokenCapacities
              :per-token '(inCapacity outCapacity))))))

    (routing-subsystem
      :algorithm 'dijkstra-modified
      :location "runtime/routing/"

      (files
        (graph.ts
          :loc 161
          :purpose "Build network graph from gossip profiles"
          :fn 'buildNetworkGraph
          :structure 'ChannelEdge)

        (pathfinding.ts
          :loc 287
          :purpose "Find optimal payment routes"
          :class 'PathFinder
          :algorithm 'dijkstra-with-capacity
          :returns '(up-to-100-routes sorted-by-fee)))

      (routing-flow
        '(bilateral-delta-update
          → buildEntityProfile
          → gossip.announce
          → buildNetworkGraph
          → PathFinder.findRoutes
          → optimal-path))

      (edge-structure
        (ChannelEdge
          :fields '(from to tokenId capacity baseFee feePPM disabled)))

      (pathfinding-constraints
        :no-loops '(path.includes(node) → skip)
        :capacity-check '(requiredAmount > edge.capacity → skip)
        :fee-calculation 'backwards  ;; From target to source
        :cost-function 'total-fee)))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; BLOCKCHAIN INTEGRATION (Dispute Resolution & Settlement)
  ;; ═══════════════════════════════════════════════════════════════════════

  (blockchain-layer
    :location "jurisdictions/"
    :framework 'hardhat
    :language 'solidity-0.8.24

    (smart-contracts
      (Depository.sol
        :loc 1861
        :purpose "Reserve management, settlement, disputes, enforceDebts"

        (key-functions
          (enforceDebts
            :lines '(1383 1437)
            :pattern 'fifo-queue-vacuum-cleaner
            :purpose "Pay all reserves into debt[0], create liquidity trap"
            :safety 'partial-payments-safe)

          (processBatch
            :purpose "Atomic batch operations"
            :operations '(reserveToReserve externalTokenToReserve
                         reserveToCollateral settlements
                         cooperativeUpdate cooperativeDisputeProof
                         initialDisputeProof finalDisputeProof flashloans))

          (finalizeChannel
            :lines '(1612 1692)
            :purpose "Dispute resolution with subcontract execution"
            :applies-subcontracts 'yes
            :validation 'allowance-constraints)

          (cooperativeUpdate
            :lines '(1510 1607)
            :deprecated 'use-settle-instead
            :structure '(Diff[] forgiveDebtsInTokenIds sig)
            :subcontracts 'no))  ;; Cooperative path has NO subcontracts

        (invariant
          :name 'RCPAN
          :formula '(−Lₗ ≤ Δ ≤ C + Lᵣ)
          :enforcement 'enforceDebts
          :description "Negative balance ≤ left-credit, positive ≤ collateral + right-credit"))

      (SubcontractProvider.sol
        :loc 141
        :purpose "Programmable credit: HTLCs, swaps, arbitrary delta transformers"
        :innovation 'dispute-layer-programmability

        (subcontracts
          (Payment
            :type 'HTLC
            :fields '(deltaIndex amount revealedUntilBlock hash))

          (Swap
            :type 'atomic-swap-limit-order
            :fields '(ownerIsLeft addDeltaIndex addAmount subDeltaIndex subAmount)))

        (key-function
          (applyBatch
            :signature '(deltas encodedBatch leftArguments rightArguments)
            :returns 'int[]  ;; Modified delta array
            :constraint 'respects-RCPAN)))

      (EntityProvider.sol
        :loc 683
        :purpose "Entity registration, name resolution, governance tokens"

        (functions
          (registerNumberedEntity :returns 'entityNumber)
          (registerNumberedEntitiesBatch :optimization 'batch-registration)
          (assignName :admin-only 'yes)
          (getGovernanceInfo :returns '(controlTokenId dividendTokenId))))

      (architectural-insight
        :separation-of-concerns
        '(cooperative-path (simple-diffs off-chain-speed no-subcontracts)
          dispute-path (subcontracts on-chain-security programmable-settlement))))

    (integration-layer
      :location "runtime/"

      (files
        (evm.ts
          :loc 994
          :purpose "Ethereum integration, contract ABIs, connections"
          :functions '(connectToEthereum submitProcessBatch
                      registerNumberedEntity getAvailableJurisdictions))

        (jurisdiction-loader.ts
          :purpose "Load jurisdictions.json configuration"
          :rpc-handling '(relative-path port-offset oculus-browser-fix))

        (j-batch.ts
          :purpose "Accumulate operations for on-chain submission"
          :pattern 'batch-optimization)

        (j-event-watcher.ts
          :purpose "Watch blockchain for ReserveUpdated, SettlementProcessed events"))))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; WORLD SCRIPTING SYSTEM (Declarative Scenarios)
  ;; ═══════════════════════════════════════════════════════════════════════

  (world-dsl
    :location "worlds/"
    :purpose "Declarative economic scenarios with cinematic framing"
    :determinism 'seeded-randomness

    (scenario-files
      (diamond-dybvig.xln.js
        :loc 114
        :demonstrates 'bank-run
        :entities 6
        :narrative "Fractional reserve collapse")

      (phantom-grid.xln.js
        :loc 69
        :demonstrates '3d-topology
        :structure '2x2x2-cube
        :payments 'random-flow)

      (corporate-treasury.xln.js
        :loc 123
        :demonstrates 'multi-sig-governance
        :aspirational 'yes  ;; API not fully implemented
        :primitives '(propose vote threshold-execution))

      (share-release.xln.js
        :loc 131
        :demonstrates 'equity-vesting
        :aspirational 'yes
        :primitives '(grantOptions vestShares exerciseOptions)))

    (executor
      :location "runtime/scenarios/"

      (files
        (executor.ts
          :loc 1108
          :purpose "Translate .xln.js frames to RuntimeInputs"
          :pattern 'interpreter

          (implemented-primitives
            (import :creates 'numbered-entities :blockchain 'yes)
            (grid :topology '3d-lattice :connections 'automatic)
            (payRandom :testing 'network-dynamics)
            (openAccount :bilateral 'channel-setup)
            (r2r :reserve-transfer 'direct)
            (fund :mint-tokens 'debug))

          (todo-primitives
            (deposit :status 'stub)
            (withdraw :status 'stub)
            (transfer :status 'stub)
            (chat :status 'stub))

          (aspirational-primitives
            (propose :governance 'multisig)
            (vote :threshold 'bft)
            (grantOptions :equity 'vesting)
            (vestShares :time-based 'cliffs)
            (transferShares :secondary-market 'trading)))

        (types.ts
          :loc 218
          :purpose "Scenario type definitions"
          (ViewState
            :fields '(camera zoom focus panel speed position rotation)
            :purpose 'cinematic-framing))

        (parser.ts
          :purpose "Parse .xln text format (if needed)"))

      (execution-flow
        '(.xln.js-script
          → frames[{time title narrative actions camera}]
          → executor.executeScenario
          → translateActions → RuntimeInputs
          → applyRuntimeInput → Env
          → applyViewState → EnvSnapshot.viewState
          → frontend-renders-cinematically)))

    (cinematic-system
      :purpose "Transform economic scenarios into visual narratives"
      :emergence 'pedagogy-from-determinism
      :shareability '(seed → reproducible-scenario)))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; SIGNATURE SYSTEM (Hanko - Recursive Threshold Signatures)
  ;; ═══════════════════════════════════════════════════════════════════════

  (hanko-system
    :purpose "BFT threshold signatures with recursive entity delegation"
    :philosophy 'assume-yes-flashloan-governance

    (files
      (hanko-real.ts
        :loc 842
        :purpose "Real secp256k1 signatures, Solidity ecrecover compatible"
        :innovation 'recursive-entity-validation

        (structure
          (HankoBytes
            :fields '(placeholders packedSignatures claims)
            (placeholders :purpose "Entities that didn't sign")
            (packedSignatures :format '(R[64] S[64] V[bits]))
            (claims :structure 'HankoClaim[]))

          (HankoClaim
            :fields '(entityId entityIndexes weights threshold expectedQuorumHash)
            :allows 'entity-validates-entity))

        (philosophical-insight
          :intentional-loophole
          '(EntityA delegates-to EntityB
            EntityB delegates-to EntityA
            → Both validate each other → Hanko succeeds WITHOUT EOAs!)

          :why-intended
          '(protocol-flexibility
            ui-enforces-policies
            gas-efficiency
            enables-exotic-governance)))

      (usage
        :entity-consensus '(precommits Map<signerId signature>)  ;; Simpler model
        :dispute-resolution 'hanko-recursive  ;; Complex delegation chains
        :on-chain-verification 'Solidity-verifyHankoSignature)))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; FRONTEND (Svelte + Three.js Visualization)
  ;; ═══════════════════════════════════════════════════════════════════════

  (frontend
    :location "frontend/"
    :framework 'sveltekit
    :3d-engine 'three.js

    (routes
      (+page.svelte
        :main-app 'yes
        :components '(TimeMachine Graph3DPanel AdminPanel))

      (view/+page.svelte
        :purpose "Embedded scenario viewer"
        :isolation 'browservm))

    (components
      :location "frontend/lib/components/"

      (visualization
        (Network/NetworkTopology.svelte
          :loc 5842
          :function-index '(163 282)  ;; USE INDEX for navigation!
          :purpose "3D force-directed graph visualization"
          :rendering '(entities-as-spheres accounts-as-bars payments-as-flows))

        (Network/EntityNode.svelte
          :purpose "Single entity sphere with pulse effects")

        (Network/AccountBar.svelte
          :purpose "Bilateral account cylinder connection"))

      (panels
        (TimeMachine.svelte
          :purpose "Historical debugging, frame-by-frame playback"
          :time-travel 'full-replay)

        (AdminPanel.svelte
          :purpose "Entity creation, payment sending, topology control")

        (ScenarioPanel.svelte
          :purpose "Load/execute world scenarios")

        (Graph3DPanel.svelte
          :purpose "Camera controls, view state"))

      (stores
        :location "frontend/lib/stores/"
        :purpose "Svelte reactive state"
        :pattern 'derived-stores))

    (static-assets
      (runtime.js
        :generated-from 'runtime/runtime.ts
        :build-command '(bun build --target=browser --external http,https,...)
        :critical 'browser-only-target)

      (c.txt
        :loc 13000+
        :purpose "Competitive analysis document")))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; DOCUMENTATION & SPECIFICATIONS
  ;; ═══════════════════════════════════════════════════════════════════════

  (documentation
    :location "vibepaper/"

    (architecture-docs
      (readme.md :overview 'system-architecture)
      (jea.md :model 'jurisdiction-entity-account)
      (payment-spec.md :specification 'payment-flows))

    (philosophy
      (sessions/ :technical-discussions 'detailed)
      (philosophy/ :paradigm-explanations 'conceptual))

    (project-root-docs
      (CLAUDE.md :ai-development-guidelines 'yes)
      (readme.md :project-overview 'yes)
      (NEXT.md :task-tracking 'active)
      (CHANGELOG.md :version-history 'yes)
      (WORKFLOW.md :development-process 'yes)))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; CRITICAL DATA FLOWS (Complete Tracing)
  ;; ═══════════════════════════════════════════════════════════════════════

  (data-flows

    ;; Flow 1: Payment Execution
    (payment-flow
      :start 'user-interface
      :end 'bilateral-consensus

      '(frontend:AdminPanel
        → RuntimeInput{entityInputs:[directPayment]}
        → runtime:process
        → entity-consensus:processInput
        → entity-tx/apply:handleDirectPayment
        → pathfinding:findRoutes (if no direct account)
        → account-tx/handlers/direct-payment:apply
        → accountMachine.mempool.push(payment)
        → account-consensus:processAccountInput
        → create AccountFrame
        → sign frame (2-of-2)
        → bilateral finalized
        → pendingForward? → entity-tx/handlers/account:consume → next-hop))

    ;; Flow 2: Capacity Discovery (Emergent Routing)
    (capacity-discovery-flow
      :emergence 'automatic
      :no-manual-config 'yes

      '(bilateral-payment
        → accountMachine.deltas updated
        → entity-tx/apply:openAccount → gossip-helper:buildEntityProfile
        → deriveDelta(delta, isLeftEntity) → {inCapacity, outCapacity}
        → gossip:announce(profile)
        → timestamp-based-update (newTimestamp > existing)
        → routing/graph:buildNetworkGraph(gossip.profiles)
        → routing/pathfinding:PathFinder.findRoutes
        → optimal-routes-available-for-payments))

    ;; Flow 3: Multi-Hop Forwarding
    (multi-hop-flow
      :pattern 'layer-cooperation

      '(account-layer:direct-payment-handler
        → route not empty? → nextHop = route[1]
        → accountMachine.pendingForward = {tokenId, amount, route}
        → account-consensus returns
        → entity-layer:account-handler
        → pendingForward detected
        → create EntityInput to nextHop
        → delete accountMachine.pendingForward
        → process(nextHopInput)
        → recursive until target))

    ;; Flow 4: Hub Rebalancing (Detection Only)
    (hub-rebalance-flow
      :detection 'implemented
      :execution 'missing  ;; GAP!

      '(entity-crontab:hubRebalanceHandler (every N frames)
        → scan all accountMachines
        → deriveDelta per account
        → identify net-spenders (delta < 0)
        → identify net-receivers (requestedRebalance > 0)
        → calculate rebalanceAmount = min(totalDebt, totalRequested)
        → create chatMessage "🔄 REBALANCE OPPORTUNITY"
        → ❌ NO ACTUAL NETTING EXECUTION))

    ;; Flow 5: Dispute Resolution
    (dispute-flow
      :on-chain 'yes
      :subcontracts 'applied

      '(bilateral-disagreement
        → initialDisputeProof submitted to Depository.sol
        → challenge period starts
        → finalDisputeProof with ProofBody{deltas, tokenIds, subcontracts}
        → Depository:finalizeChannel
        → apply subcontracts (SubcontractProvider:applyBatch)
        → validate allowance constraints
        → enforce deltas on-chain
        → channel finalized))

    ;; Flow 6: BFT Consensus
    (bft-consensus-flow
      :mode 'proposer-based

      '(validator sends EntityTx to proposer
        → proposer adds to mempool
        → proposer creates ProposedFrame{height, txs, hash, newState}
        → broadcast to validators
        → validators verify → sign frame
        → send precommit to proposer
        → proposer collects signatures
        → threshold reached (≥2/3)?
        → finalize frame → apply to EntityState
        → create EnvSnapshot with narrative metadata))

    ;; Flow 7: World Scenario Execution
    (scenario-execution-flow
      :determinism 'seeded

      '(user loads diamond-dybvig.xln.js
        → executor:executeScenario(scenario, {seed})
        → mergeAndSortEvents → group by timestamp
        → for each frame:
          → executeEvent(event)
            → executeAction (import, grid, payRandom, openAccount...)
              → translate to RuntimeInput
              → applyRuntimeInput(env)
          → applyViewState to EnvSnapshot
          → EnvSnapshot.title = frame.title
          → EnvSnapshot.narrative = frame.description
        → frontend reads Env.history
        → TimeMachine enables playback
        → NetworkTopology renders with camera from viewState)))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; ARCHITECTURAL PATTERNS & INSIGHTS
  ;; ═══════════════════════════════════════════════════════════════════════

  (architectural-patterns

    (separation-of-concerns
      :layers '(consensus discovery routing execution)
      :coupling 'loose
      :insight "Consensus ≠ Discovery ≠ Routing")

    (emergence
      :phenomenon "Bilateral consensus → global routing capability"
      :no-coordinator 'yes
      :mechanism 'gossip-derived-graph)

    (layer-cooperation
      :pattern 'flag-and-consume
      :example 'pendingForward
      :account-layer '(sets flag with routing intent)
      :entity-layer '(consumes flag, creates next hop))

    (deterministic-replay
      :all-state 'pure-functions
      :side-effects 'at-boundaries
      :replay '(ServerFrame[] → deterministic-state-reconstruction))

    (optimistic-execution
      :bilateral '(execute-immediately, dispute-if-needed)
      :settlement '(off-chain-instant, on-chain-security))

    (recursive-composition
      :hanko '(entities validate entities)
      :routing '(accounts compose into graph)
      :scenarios '(frames compose into narratives)))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; IMPLEMENTATION GAPS & TODOs
  ;; ═══════════════════════════════════════════════════════════════════════

  (gaps-and-todos

    (gap-1-netting-execution
      :status 'detection-only
      :location 'entity-crontab.ts:284
      :what-exists '(scan-accounts calculate-rebalance-amount chat-message)
      :what-missing '(netting-path-calculation bilateral-delta-updates settleDiffs-trigger)
      :recommended-pattern 'pendingNetting-flag-like-pendingForward)

    (gap-2-world-dsl-primitives
      :aspirational-apis '(propose vote grantOptions vestShares transferShares)
      :status 'specification-documents
      :implementation 'todo)

    (gap-3-governance-tokens
      :exists-in-solidity '(EntityProvider.sol getGovernanceInfo controlTokenId)
      :runtime-integration 'minimal
      :ui-support 'missing)

    (gap-4-time-machine-indexing
      :large-files '(NetworkTopology.svelte 5842-lines)
      :pattern 'function-index
      :lines '(163 282)
      :workflow 'docs/editing-large-files.md))

  ;; ═══════════════════════════════════════════════════════════════════════
  ;; KEY NUMERICAL CONSTANTS
  ;; ═══════════════════════════════════════════════════════════════════════

  (constants
    (timing
      :runtime-tick 100  ;; milliseconds
      :scenario-tick 1000  ;; milliseconds (configurable))

    (blockchain
      :block-time 1000  ;; ms for BrowserVM
      :default-gas-limit 'auto)

    (tokens
      :decimals 18
      :usdc-token-id 1
      :one-token '(10n ** 18n))

    (limits
      :max-routes 100  ;; PathFinder returns up to 100 routes
      :max-txs-per-input 1000
      :max-grid-size 1000  ;; entities
      :max-precommits 100)

    (fees
      :default-routing-fee-ppm 100  ;; 0.01%
      :default-base-fee 0n)))

;; ═══════════════════════════════════════════════════════════════════════════
;; END OF S-EXPRESSION MAP
;;
;; This map represents the complete XLN architecture as of 2025-10-24.
;; All data flows, component relationships, and implementation gaps are captured.
;;
;; To navigate: Use your favorite S-expression editor (Emacs, Racket DrRacket, etc.)
;; To query: Write Scheme predicates over this structure
;; To extend: Add new forms following the established conventions
;;
;; The architecture is sound. The patterns are elegant. The gaps are known.
;; ═══════════════════════════════════════════════════════════════════════════
