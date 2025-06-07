# Contributing to XLN

## Development Workflow

### 1. Task Management

#### GitHub Issues
- **Features**: Major components (use feature template)
- **Tasks**: Specific work items (use task template)  
- **Bugs**: Issues to fix (use bug template)

#### Labels
- `layer:server` - Server/Post Office layer
- `layer:signer` - Signer/Board Member layer
- `layer:entity` - Entity/Company layer
- `layer:channel` - Channel layer (future)
- `layer:depositary` - Token management (future)
- `priority:high` - Critical path items
- `good-first-issue` - Entry points for new contributors
- `needs:research` - Requires investigation
- `claude:ready` - Ready for Claude Code session

### 2. Working with Claude Code

#### Session Preparation
1. Create a GitHub issue with clear scope
2. Add `claude:ready` label when ready to implement
3. Include in issue description:
   - Specific files to modify
   - Expected outcomes
   - Performance requirements
   - Test requirements

#### Claude Code Best Practices
```bash
# Start a focused session
claude --mode code

# Reference the issue
"I'm working on issue #23: Implement Merkle tree for state management"

# Provide context
"Check docs/XLN_SPECIFICATION.md section 3.2 for requirements"

# Be specific about constraints
"Must be pure functional, handle 1M+ leaves, <1ms proof generation"
```

#### Session Output
- Always request tests with implementation
- Ask Claude to update relevant documentation
- Request performance benchmarks where applicable

### 3. Development Process

#### Branch Strategy
```bash
# Feature branches
git checkout -b feature/merkle-tree

# Task branches  
git checkout -b task/add-merkle-benchmarks

# Bug fixes
git checkout -b fix/entity-state-corruption
```

#### Commit Messages
Follow conventional commits:
```
feat: Add Merkle tree implementation for state management
fix: Resolve entity state corruption on block rollback
docs: Update architecture diagrams for merkle integration
test: Add performance benchmarks for merkle operations
refactor: Extract pure merkle functions to separate module
```

#### Pull Request Process
1. Reference issue: "Closes #23"
2. Include benchmarks for performance-critical code
3. Ensure all tests pass
4. Update documentation if needed
5. Request review

### 4. Team Coordination

#### Daily Workflow
1. **Morning**: Check project board, pick issue
2. **Claude Session**: Implement with Claude Code
3. **Testing**: Verify implementation
4. **PR**: Submit for review
5. **Review**: Review others' PRs

#### Weekly Sync
- Review project board
- Discuss architectural decisions
- Plan upcoming work
- Share Claude Code learnings

### 5. Quality Standards

#### Code Requirements
- **Pure Functional**: No classes, immutable data
- **Type Safe**: Must pass `bun run typecheck`
- **Tested**: >90% coverage for core logic
- **Performant**: Meet targets in PRD
- **Documented**: JSDoc for public APIs

#### Performance Targets (from PRD)
- Block time: 100ms
- Transaction latency: <10ms
- Merkle proof: <1ms
- Signature aggregation: <5ms for 100 sigs

### 6. Project Structure

#### Issue Hierarchy
```
Epic: Payment Channel Implementation
├── Feature: Channel State Machine
│   ├── Task: Define channel types
│   ├── Task: Implement state transitions
│   └── Task: Add channel tests
├── Feature: Reserve-Credit System
│   ├── Task: Design credit allocation
│   └── Task: Implement reserve logic
└── Feature: Channel Network
    └── Task: Multi-hop routing
```

#### Milestones
1. **Core (Complete)**: Server, Signer, Entity
2. **Channels**: Payment channels, reserve-credit
3. **Network**: WebSocket, REST API
4. **Storage**: Production persistence
5. **Performance**: 100k TPS target
6. **Integration**: Ethereum connectivity

### 7. Claude Code Tips

#### Effective Prompts
```
# Good: Specific and contextual
"Implement the Channel state machine from section 4.2 of the spec.
Use the same pure functional pattern as entity.ts. Include state
transitions for: open, update, dispute, close. Target <10ms operations."

# Less effective: Too vague
"Add channels to the system"
```

#### Multi-file Operations
```
"Update these files for channel support:
1. types.ts - Add Channel types
2. core/channel.ts - New state machine
3. core/server.ts - Add channel routing
4. tests/channel.test.ts - Comprehensive tests"
```

#### Iterative Development
1. Start with types/interfaces
2. Implement core logic
3. Add tests
4. Optimize performance
5. Document

### 8. Testing Strategy

#### Test Categories
- **Unit**: Pure functions (vitest)
- **Integration**: Multi-component flows
- **Performance**: Benchmark critical paths
- **Simulation**: Large-scale scenarios

#### Running Tests
```bash
bun test              # All tests
bun test:watch        # Development mode
bun test:coverage     # Coverage report
bun test src/core/    # Specific directory
```

### 9. Documentation

#### Code Documentation
- JSDoc for all exported functions
- Inline comments for complex algorithms
- README updates for new features

#### Architecture Decisions
Document in `/docs/decisions/`:
- Why specific approaches were chosen
- Trade-offs considered
- Performance implications

### 10. Getting Started

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Run tests: `bun test`
4. Pick a `good-first-issue`
5. Create a branch and start coding
6. Use Claude Code for implementation
7. Submit PR with tests and docs

## Questions?

- Technical: Create a discussion issue
- Process: Update this guide via PR
- Urgent: Contact maintainers

Remember: Follow the Kalashnikov Principle - reliability through simplicity!