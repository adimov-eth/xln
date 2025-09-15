# XLN Project Structure

## Core Directories

```
xln/
├── src/                    # Main source code
│   ├── bridges/           # Bridge implementations
│   ├── consensus/         # BFT consensus layer
│   ├── entities/          # Entity management
│   ├── merkle/           # Merkle tree implementations
│   ├── organizations/    # Organizational primitives
│   └── legacy/           # Integration with old_src
│
├── archive/               # Preserved legacy code
│   ├── old_src/          # Original working channel implementation
│   └── old_docs/         # Original protocol documentation
│
├── contracts/            # Smart contracts
├── frontend/            # Web interface
├── cli/                # Command-line interface
│
├── examples/            # Demos and examples
│   ├── demos/          # Working demonstrations
│   ├── visualization/  # Visual tools
│   └── legacy/        # Historical examples
│
├── scripts/            # Utility scripts
│   ├── debug/         # Debugging tools
│   ├── tools/         # Development tools
│   ├── bench/         # Benchmarks
│   └── deploy/        # Deployment scripts
│
├── docs/              # Documentation
│   ├── protocol/      # Protocol specs
│   ├── deployment/    # Deployment guides
│   └── assets/        # Images and diagrams
│
├── test/              # Test suites
├── e2e/               # End-to-end tests
└── benchmarks/        # Performance benchmarks
```

## Key Files

- `src/server.ts` - Main server entry point
- `archive/old_src/app/Channel.ts` - Working bilateral channel implementation
- `archive/old_src/app/Transition.ts` - State transition logic
- `examples/demos/trade-credit-demo.ts` - Trade credit demonstration

## Symlinks for Compatibility

- `old_src` -> `archive/old_src`
- `old_docs` -> `archive/old_docs`

These symlinks ensure existing code continues to work while we migrate.
