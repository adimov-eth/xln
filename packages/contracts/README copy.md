## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

-   **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
-   **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
-   **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
-   **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```



# For local testing
forge script script/Depository.s.sol --fork-url http://localhost:8545

# For testnet deployment
forge script script/Depository.s.sol --rpc-url $RPC_URL --broadcast --verify
```

# Depository Smart Contracts

This repository contains the smart contracts for the Depository system, which includes token management, entity management, and subcontract handling capabilities.

## Contracts

- **Depository**: Main contract for managing token reserves, channels, and disputes
- **EntityProvider**: Manages entities and their governance structures
- **SubcontractProvider**: Handles subcontract operations like payments and swaps

## Development Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Rust (required for Foundry)
- Git

### Installation

```shell
# Clone the repository
git clone <repository-url>
cd packages/contracts

# Install dependencies
forge install

# Build the contracts
forge build
```

### Testing

```shell
# Run all tests
forge test

# Run specific test file
forge test --match-path test/Depository.t.sol

# Run tests with verbosity
forge test -vv

# Run tests with gas reporting
forge test --gas-report
```

### Deployment

The project includes several deployment scripts for different environments:

#### Local Development (with mock tokens)
```shell
# Start local node
anvil

# Deploy all contracts including mocks
forge script script/Depository.s.sol:DeployModule --fork-url http://localhost:8545 --broadcast
```

#### Production Deployment
```shell
# Deploy core contracts only
forge script script/Depository.s.sol:DeployProd --rpc-url $RPC_URL --broadcast --verify
```

#### Individual Contract Deployment
```shell
# Deploy SubcontractProvider
forge script script/Depository.s.sol:DeploySubcontractProvider --rpc-url $RPC_URL --broadcast

# Deploy EntityProvider
forge script script/Depository.s.sol:DeployEntityProvider --rpc-url $RPC_URL --broadcast

# Deploy Depository
forge script script/Depository.s.sol:DeployDepository --rpc-url $RPC_URL --broadcast
```

### Environment Setup

Create a `.env` file in the root directory:
```env
PRIVATE_KEY=your_private_key_here
RPC_URL=your_rpc_url_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here  # For verification
```

### Contract Verification

```shell
# Verify on Etherscan (after deployment)
forge verify-contract <deployed-address> src/Depository.sol:Depository --chain-id <chain-id> --compiler-version <version>
```

## Testing Tools

### Gas Snapshots
```shell
# Generate gas snapshots
forge snapshot
```

### Format Code
```shell
# Format Solidity files
forge fmt
```

### Static Analysis
```shell
# Run Slither (if installed)
slither .
```

## Contract Architecture

### Depository
- Manages token reserves and channels
- Handles disputes and cooperative updates
- Supports ERC20, ERC721, and ERC1155 tokens

### EntityProvider
- Manages entity creation and governance
- Handles board proposals and activation
- Implements signature verification

### SubcontractProvider
- Processes batched payments and swaps
- Manages hash-based reveals
- Handles credit default swaps

## Documentation

For detailed documentation of the contracts and their functions, see:
- [Foundry Book](https://book.getfoundry.sh/)
- [Contract Documentation](./docs/)