# Ethereum Lightning Network: Architecture and Reserve-Credit Model

## Overview and Core Innovations
This Lightning Network (LN) implementation for Ethereum represents a significant advancement in payment channel networks by introducing programmable functionality and flexible capacity management. The system combines off-chain scalability with the programmable capabilities of Ethereum smart contracts to enable sophisticated financial instruments and governance structures.

## Key Architectural Components

### 1. Programmable Subcontracts
The subcontract system enables complex payment conditions within payment channels, supporting various DeFi applications:

- Hash Time Locked Contracts (HTLCs) for atomic swaps and cross-chain transactions
- Credit Default Swaps with external triggers
- Programmable payment schedules and conditional payments
- Token swaps and liquidity provision within channels

The SubcontractProvider contract serves as both a registry and executor for these payment conditions, allowing new financial instruments to be added without modifying the core protocol.

### 2. Programmable Entities
The EntityProvider contract introduces sophisticated governance capabilities that allow channels to be controlled by complex organizational structures rather than simple private keys. This enables:

- Multi-signature control of channels
- DAO-like governance structures
- Delegated control and hierarchical permissions
- Dynamic voting thresholds and stakeholder structures

For example, a channel could be governed by a DAO where token holders vote on operations, or by a federated group with weighted voting rights.

### 3. Layered Architecture
The system implements a three-layer architecture:

1. Base Layer: Depository contract managing core payment channel mechanics
2. Programmability Layer: SubcontractProvider enabling custom payment conditions
3. Governance Layer: EntityProvider enabling programmable control

This structure maintains separation of concerns while enabling complex compositions of functionality.

## The Reserve-Credit Model

### Core Components
The system implements an innovative reserve-credit model that combines multiple balance components:

#### Reserves
- Tokens committed to the Depository contract
- Provide underlying security for channel operations
- Can be moved between channels as needed

#### Collateral
- Portion of reserves locked into specific channels
- Provides base capacity for making payments
- Directly backs payment obligations

#### Credit Limits
- Allow payments beyond collateral amounts
- Establish trust relationships between parties
- Similar to lines of credit in traditional finance

### Balance Calculation
The deriveDelta function calculates payment capacities using these key formulas:

```typescript
    // Calculate total net transfer in channel
    const delta = d.ondelta + d.offdelta;
    const collateral = nonNegative(d.collateral);
    // Calculate collateral distribution
    let inCollateral = delta > 0n ? nonNegative(collateral - delta) : collateral;
    let outCollateral = delta > 0n ? (delta > collateral ? collateral : delta) : 0n;
    // Calculate credit utilization
    let inOwnCredit = nonNegative(-delta);
    if (inOwnCredit > ownCreditLimit) inOwnCredit = ownCreditLimit;
    let outPeerCredit = nonNegative(delta - collateral);
    if (outPeerCredit > peerCreditLimit) outPeerCredit = peerCreditLimit;
```


### Payment Flow
Payments follow a waterfall structure:

1. First utilize available collateral
2. Then consume credit limit if needed
3. Total capacity = collateral + available credit

This creates bidirectional payment channels with:

- Forward Capacity = user's collateral + counterparty's credit limit
- Backward Capacity = counterparty's collateral + user's credit limit
- Dynamic rebalancing as payments flow

### State Visualization
The system includes an innovative ASCII visualization showing:

```
[-------------------====================--------------------]
     Credit Limit       Collateral        Credit Limit
                           |
                     Current Balance
```


This helps users understand:
- Balance position relative to total capacity
- Available collateral and its utilization
- Credit limits in both directions
- Overall channel state

## Benefits and Applications
The combination of programmable contracts and the reserve-credit model provides several key advantages:

### Scalability
- Moves most transactions off-chain
- Maintains security through eventual settlement
- Efficient capacity utilization

### Programmability
- Complex financial instruments within channels
- DeFi functionality without on-chain transactions
- Extensible contract system

### Flexibility
- Dynamic capacity through credit limits
- Complex organizational control structures
- Adaptable trust relationships

### Security
- Collateral-backed payments
- Programmable governance
- Clear separation of concerns

This architecture provides a foundation for building sophisticated financial applications that combine the scalability benefits of payment channels with the programmability of Ethereum smart contracts. It's particularly well-suited for DeFi applications requiring high throughput while maintaining complex payment conditions and governance structures.

The careful balance between on-chain and off-chain execution, combined with the flexible reserve-credit model, creates a powerful platform for next-generation decentralized financial applications.



Repo structure:

```
packages/contracts/ — smart contracts
packages/node/ — xln node implementation
packages/types/ — typescript types
packages/webapp/ — webapp implementation
packages/devtools/ — devtools for running and testing smart contracts
docs/ — documentation
```

