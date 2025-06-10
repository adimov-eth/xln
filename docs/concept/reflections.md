**Ask 10 questions based on the results of this call with Boris and Arseny, where I explain the XLN architecture. What, in your opinion, is unclear from the dialogue, and what are the top 10 architecture questions that will help them and you understand the essence. 
[[XLN meeting 8]]

ChatGPT said: Here are 10 key questions about the XLN architecture that will help Boris, Arseny, and you better understand the system and identify potential gaps:

1. **How is message routing between machines implemented?** It's mentioned that there's "no networking" and interaction happens directly. Is there a plan to implement a full network layer or routing protocol for scaling?
    
2. **What parameters define transactions?** You mentioned three types of machines: jurisdictions, entities, and accounts. What parameters do transactions between them include? Is there a concept of gas, limits, or other restrictions?
    
3. **How is state management and consensus between machines handled?** If machines interact through events, how is state consistency ensured and conflicts or double-spending prevented?
    
4. **How are asynchronous transactions processed?** You mentioned that transactions are asynchronous. How does the system handle confirmation, rollback, or retry of transactions in case of failures?
    
5. **How is security and authentication implemented?** How is participant authentication verified and protection against unauthorized access or attacks ensured?
    
6. **How does interaction between different jurisdictions work?** You mentioned that jurisdictions live separately and can be implemented in Rust. How do they interact with each other and other machines?
    
7. **How is multi-signature support and access management implemented?** You mentioned that entities can be DAOs or personal entities. How is multi-signature support and access rights management implemented within entities?
    
8. **How are machine state updates and migrations handled?** If you need to update the logic or state of a machine, how is migration done without data loss and with minimal disruption?
    
9. **How is system monitoring and debugging done?** What tools or mechanisms are provided for tracking machine states, event logging, and problem diagnostics?
    
10. **What are the plans for scaling and integration with other systems?** How do you plan to scale the system as the number of participants and transactions increases? Are there plans for integration with other blockchain networks or external services?
    

Answers to these questions will help clarify the XLN architecture and prepare it for further development and scaling.

**Sources** You said:

1. Routing will be based on an external library principle like libp2p or signal protocol for encrypted messages. This is not part of the core. In the core, all entities live simultaneously, like in a matrix on one server, because they are isolated and simulate network behavior without full websockets. This just isn't needed right now.

ChatGPT said: Excellent, this clarifies a lot. Based on your clarification and assumed misunderstandings from Boris and Arseny's side, here's an updated list of 10 clarifying questions that will help them better grasp the XLN architecture and not get stuck on unnecessary details:

📌 **Top 10 Questions about XLN Architecture After the Call**

1. **If all entities "live on one server," what ensures isolation and distributed simulation?** Is this containers? Virtual machines? Or just an object model with async messaging?
    
2. **How is the messaging model between entities structured?** Is it an event queue? RPC? Are messages passed through explicit inputs/outputs? Is there serialization?
    
3. **How will integration with real p2p work when scaling?** Is direct connection of libp2p/libsignal to each entity planned, or dedicated channels between nodes? Who will be the initiator?
    
4. **How are conflicts handled if two accounts or entities try to change shared state simultaneously?** Is there optimistic concurrency, locks, or does the architecture completely avoid shared state?
    
5. **What's the difference between account and channel?** Both sound like "between two E". When is one created versus the other? What's the update logic?
    
6. **How is entity "binding" to jurisdiction implemented?** Can an entity migrate? Or is this a permanent relationship? Who validates that an entity follows jurisdiction rules?
    
7. **What does the XLN core do?** Your description mentions a lot about what's not in the core. What exactly is included? Event bus? Entity registry? Mini-VM?
    
8. **How is storage implemented: events, states, snapshots?** Where is history stored? Is LevelDB or something else used? Is rollback supported?
    
9. **What form of computation is allowed in accounts?** Are these finite state machines? Programs? Can accounts have their own "execution logic" (like smart contracts)?
    
10. **How can jurisdictions interact with each other?** Through hashlocks? Through signed messages? Is there a cross-jurisdictional interaction protocol?
    

Want me to create a developer doc based on these questions so they understand XLN faster?

You said: Again, we're talking about development. Yes, they currently live on one server. Isolation and simulation are guaranteed by the fact that they all fold into one hash, meaning an Entity occupies its cell in LevelDB, and it doesn't touch other cells, other entities, replicas of this entity at other signers. Accordingly, what happens to it is isolated from others. Transactions arrive to it, first to mempool, then through block creation, and they change its state. And then the server hash is the hash of all replicas of all entities that this server contains.

ChatGPT said: Excellent, now it's clear how isolation, replication, and state hashing work. Let me rewrite the questions for Boris and Arseny, taking into account your answer, to help them get into the architecture faster:

📌 **10 Clarifying Questions for XLN Developers (v2)**

1. **How is the entity replication model between signer servers structured?** Who initiates state sending and when? Are deltas or snapshots signed? How is conflict resolved if replicas diverge?
    
2. **How is mempool structured: is it global per server or per-entity?** Where are incoming transactions stored before application? Can you have two unconfirmed transactions for one entity simultaneously?
    
3. **How is a block created?** Is there a fixed schedule (e.g., every 100 ms), or is a block created by transaction count? Who assembles and signs it?
    
4. **What does the server hash structure look like?** Is it hash(serialize(all_entities_state))? Or hash(hash(E1) + hash(E2) + ...)? Is there a Merkle tree on top of LevelDB?
    
5. **How does a transaction look at the code level?** Is it a structure with type, inputs, data, signatures? What's the minimal structure for core processing?
    
6. **How exactly does an entity "change its state"?** Is it just a key write in LevelDB? Is there an intermediate state machine or in-memory interpretation?
    
7. **How are transactions validated before entering a block?** Is there a dry-run? Are signatures checked before execution? Can rejected transactions remain in mempool?
    
8. **How does synchronization happen between different servers that have different entity subsets?** What's the hash exchange mechanism, and how to determine that a neighbor has the needed version?
    
9. **Is there a notion of "finality" for a block?** How many signatures (quorum?) are needed for a block to be finalized? Or can one signer "go ahead" and others catch up?
    
10. **How will scaling work when entities are physically distributed across different machines?** Is there a transaction router? Or is each server responsible only for its subset and doesn't process others'?
    

If you want, I can turn this into a Markdown doc "Guide for XLN Core Contributors" or start writing the core README.md.

You said: First. Replication model. First, new signers clone to themselves, as if forking the current entity snapshot on GitHub. Then they start participating in its consensus if they are validators. If they are observers, they just read and synchronize new blocks of this entity. Deltas are signed exclusively in accounts, meaning this happens virtualized inside the entity. And accounts are relationships with other entities. Conflict shouldn't arise in principle because all changes are verified. That is, chain splitting is impossible if all code executes deterministically and identically, and arrives at the same Merkle hash. Mempool is three-level, accordingly. There's a global server mempool where requests arrive, but in our case it adds them to itself, simulating networking. That is, it has an inbox and outbox, so to speak. It adds incoming messages to itself, outbox is what it supposedly could send to other servers, but it just redistributes it back to inbox, meaning it's looped. This way networking is simulated without its actual implementation. They're all stored in memory, the whole system works exclusively with memory. Transactions, entities have their own counter, like in blockchain, meaning they can accumulate. For example, five different signers made votes inside one entity. They voted for some proposal. Accordingly, yes, all these proposals must first be sent to the proposer of this entity, who in consensus collects... This is some signer who collects the mempool already at the level of this entity and sends it for signature to other signers participating in the quorum, who decide what to sign, what not, how to progress blocks. About block creation. The server processes its mempool every 100 milliseconds. Accordingly, then it already looks at which entities have accumulated transactions in their entity mempool and already tries to create a block for them if the signer is a proposer there. And it sends this block for signature back to itself through Outbox to the server mempool. That is, the server mempool is an aggregation of all inputs to entity machines, and the entity mempool is an aggregator of entity-level transactions and inputs to account machines that already live inside the entity. Fourth question. The hash structure looks like RLP of all signers, more precisely all entities, grouped by signers. This is a two-level nested array, where entity arrays simply go one after another, and signers just have index 0, 1, 2 and so on. Merkle tree doesn't need to be implemented at the moment. And a hash is taken from this. This is the hash of the current server state. It is a reflection of everything happening in the network. Fifth. A transaction simply has a type and data, arguments that it executes. This should all be typed. To be continued.

ChatGPT said: Excellent, this gives a much more precise understanding of XLN's internal workings. Here's an updated and refined list of questions that can be passed to Boris and Arseny for further development:

🔍 **10 Technical Questions for Deep XLN Development (v3)**

1. **How does an entity determine who exactly is its proposer?** Is there a fixed schedule (round-robin)? Can the proposer be changed? How to prevent role abuse?
    
2. **How do validators within an entity decide whether to sign a block or not?** Is it always automatic code execution and hash comparison? Or is a validation logic tree/rules possible?
    
3. **How is the delta format inside an account structured?** What data exactly is signed? Is it serialized state? Or a list of changes? How is cross-entity verification ensured?
    
4. **How are messages between two entities processed through an account?** Is the message transmitted twice (in one's outbox and another's inbox)? Who and where stores a copy of the account contract?
    
5. **What happens if one of the signers loses synchronization?** Can you recover from an entity snapshot? Is there a mechanism to confirm you have the correct state?
    
6. **How is proposal voting structured?** What's the vote structure? Is vote history stored? How is quorum achievement determined?
    
7. **How exactly does the RLP structure serialize state?** Is a fixed entity order used? What if one server contains an entity subset — how to verify hashes?
    
8. **Is there an "empty blocks" mechanism?** What happens if there were no new transactions within 100 ms? Is an empty block created for finality or just skipped?
    
9. **What language or DSL is used for transaction typing and account logic?** Is a custom domain model planned, or is it regular JSON + schema + TypeScript interpreter?
    
10. **What happens if two proposers simultaneously propose different blocks for one entity?** Or is this impossible by architecture? What protection against double proposal exists within one entity?
    

These questions will not only clarify the picture but also help outline areas for documentation, tests, and validators. Ready to turn this into documentation or XLN Core v0.1 specification if needed.

You said: Quorum — arrays separated by commas in pairs, where signer — external account, comma its weight, and so on in pairs, and then the threshold is indicated — how much needs to be collected, for example, 67%. Round Robin doesn't need to be implemented, proposer is just the very first signer in the quorum, by default. We don't care about abuse right now. We also skip the prevote stage, essentially it's like simplified Tendermint. Instead of prevote, the block is immediately sent for signature to other signers of this quorum, and as soon as 67% of them accumulate, the block is considered finalized and is sent to all other validators, signers and all other observers for progression to the next final block, so to speak. Second. They should always sign the block if the transaction in it is valid, this is automatic. If the hash of the resulting state, more precisely the storage of this entity, which already includes accounts and the internal database, so to speak, with orderbooks and so on, and proposals. If the hash matches and it has the correct proposer signature, then other validators also sign it. Same logic as Ethereum jurisdiction, everything is the same. Deltas, more precisely account proof consists of deltas for each individual asset, and this is a signed integer, which can be negative and positive. Think of it like abacus beads in a store that can be moved left-right, this can also be called a balance. Fourth. Outbox is what the entity wants to send to others, and inbox is what it receives from others. Figure it out yourself. An account has no contract. The entire account is a machine that exists inside the entity machine. And settling account disputes happens in depositary.sol in the jurisdiction. There are only two contracts in total. EntityProvider.sol and Depositary.sol. Entity provider stores the relationship between entity ID and current quorum. Quorums can vote to change the entity's quorum, like electing a new board of directors. Fifth. Yes, if it loses synchronization, recovery can be done, but we don't care about that now, we have a prototype. Sixth. First someone creates a proposal, and others just vote from their signers. Like yes, no. Well, rather only yes. And as soon as yes accumulates a majority, 67% or it's configurable, then code is triggered inside the entity that says to execute this proposal. And it acts further synchronously. I didn't understand the seventh question. Figure it out yourself. Eighth. No, there's no point in creating empty blocks, this isn't a public jurisdiction, there's no point in simulating liveness. That is, an entity can create a block once a week, for example, when they gathered to do some operation with their treasury with the entity's reserve in the depositary, for example. Ninth. No, it's purely TypeScript. No need to create something complex, I think. Figure it out yourself. Tenth. An entity has one proposer at a time, there can't be two. It's essentially proof of stake. Only with weights predetermined in the quorum. And the quorum is stored in EntityProvider and it's fixed. It's the board of directors.

ChatGPT said: Accepted. Based on your answers and new level of detail, here's the final version of 10 questions, reformulated as tasks for understanding and developing XLN — they can form the basis of dev-onboarding or discussion with any new developer.

✅ **XLN — 10 Key Control Questions for Developers (vFinal)**

1. **What does the quorum structure look like in EntityProvider.sol and how is it validated at the core level?** Can you manually serialize it to a string and back? How is this used when checking block signature?
    
2. **What stages does a transaction go through from entering inbox to finalization in an entity block?** Where are intermediate states stored? How are they aggregated and who decides which ones get into the block?
    
3. **How is a signable block structured: what fields are included in its hash and how is signature validity checked?** What exactly should a signer verify before signing? What does the canonical form of data look like?
    
4. **How are deltas processed inside accounts: where are they stored and how is current state calculated?** Create an example: how would a transfer of 10 units from E1 to E2 for asset X look like?
    
5. **How does the server interpret and process one entity's Outbox and another's Inbox?** Where and how are these messages logged? What's stored in memory and what in LevelDB?
    
6. **How is proposal invocation and execution after reaching vote threshold implemented?** Where does proposal code live? Can it be tested separately? How to know that quorum is executed?
    
7. **What JSON/TypeScript structure format do transactions use?** Write an example of a valid ProposalVote transaction with fields and signatures.
    
8. **What guarantee does the RLP hash structure of all entities provide?** If one server contains not all entities (e.g., a subset), how does it verify that its hash is "partially valid"?
    
9. **How to check the relevance of your entity's state?** Is there a built-in "heartbeat" mechanism or verification with other signers, or is state considered valid by consensus?
    
10. **What might a DevTool for debugging one entity's work look like:** What should it show? Delta history? Mempool? State hash? Signatures?
    

If you want — I'll turn this into documentation, an interactive tutorial, or CLI utility xln-devtool.

You said: First. The quorum in EntityProvider.sol is not stored directly, but only its hash, because it can be quite large. And every time you want to provide a signature of this quorum, you must simultaneously provide the quorum structure, which will be hashed and checked whether this is the current hash in EntityProvider for this EntityID, that is, whether the board is current. Maybe during a transition period, 2 quorums can be valid simultaneously. That is, let's say shareholders voted for a new quorum, then the old quorum has a grace period of one week while it's still valid, and others, for example, can close accounts with it if such a need arises. Entity blocks don't go into the jurisdiction, same as account blocks. Instead, only transactions that entities decided to make in the jurisdiction go there, reserve and collateral management, and disputes and collateral management of accounts with other entities, which also must first agree on this at the entity level. Second. What stages? First it goes into the entity's mempool, then it goes into consensus, where its current proposer tries to finalize with other validators. If it's a single-signer entity, then it does this instantly, that is, it's like a personal wallet. If it's a complex DAO, then based on the result of signature collection, the block is finalized, and when creating its own block, the proposer executes it and asks for signatures. When finalization happens, storage changes, or come up with your own name for what is already the internal state of the entity, not the machine state. Third. It must verify that after block execution it arrives at exactly this final entity storage, same as in blockchain. Fourth. They are stored inside account records, which fold like merkle-3 into the entity state. Fifth. Outbox exists in memory. This is how many requests have accumulated that the entity decided to send to others. These are requests like account-inputs for another entity, or requests, if it's a multi-signer entity, requests like "give me a signature for a new block" or "here's a new block with signatures for you". Everything is stored in memory. It's simply dumped to leveldb every 100 milliseconds when the server loop ends. Before sending the Outbox, you need to, like in write-ahead-log, save the current set of entity inputs and the final hash state, so that if the server crashes, you can load the last server snapshot and apply all server blocks. Sixth. Proposal code lives in TypeScript. Proposal parameters live in the entity state. Test separately? Yes, everything is modular. Quorum accumulates because the entity itself remembers who voted, who didn't, and when 67%, then the proposal is considered activated, and it already acts simultaneously for everyone. Seventh. Figure it out yourself. Eighth. One server in our situation is a matrix where everything happens. When these are different servers, we don't care what happens on other servers, because ours works as a pure function. Everything that comes in is sent from Outbox to output. We're purely testing it. It doesn't give us guarantees, it's used purely for integrity. We don't use it in any way and don't send the server hash. It's just convenient to test. Ninth. It's considered valid by default. If you just executed everything, finalized a new block and it's signed by the majority, then there's no point in re-checking, since you just signed on a specific hash of the entire merkle, the entire state. Tenth. This will be a console logo that shows an ASCII map of all this internal magical map that's downloaded from LevelDB, starting from server root, then the next layer is all machines, then the state of all machines and the state of all accounts that live inside machines. That is, it's such a tree. And it all folds into the server root. There's no point in showing signatures at this stage. They can be skipped.

ChatGPT said: Now everything is fixed clearly and systematically. At this stage, we can prepare:

🧭 **XLN Developer Onboarding Summary (v1)**

📌 **Protocol**

- **Single proposer**: first signer in the quorum.
- **Quorum**: [(signer1, weight1), (signer2, weight2), ..., threshold], stored as hash in EntityProvider.sol, presented with every action.
- **Grace Period**: two quorums can be valid temporarily when changing board composition.

🧱 **Execution Architecture**

- **3 levels of mempool**:
    
    - Server inbox/outbox
    - Entity mempool (transaction aggregation)
    - Account queues (actions between entities)
- **Transactions**: type + data. Processed deterministically → final storage → hash verification → signature.
    
- **Storage**: entity state structure (includes accounts and proposals) → serialized and hashed → verified at finalization.
    

🔁 **Replication and Integrity**

- Server = pure function from incoming data.
- State hash (RLP[ [entities grouped by signer] ]) is not distributed, but used for tests and integrity.
- Everything works in-memory. LevelDB = snapshot and WAL every 100 ms.

🔄 **Accounts and Jurisdictions**

- Account = internal state-time machine inside Entity.
- Account has no contract.
- All disputes and settlements — through Depositary.sol.
- Entity and account blocks don't leave the entity boundaries.
- Only jurisdiction interaction transactions (reserves, disputes) go to Depositary.

🛠 **DevTool**

- Console map (ASCII map): tree Server → Entities → Accounts.
- Shows only structure and hashes, signatures omitted.

Ready to format this as README.md, documentation, repository skeleton, or TypeScript template. Tell me where we're moving next.