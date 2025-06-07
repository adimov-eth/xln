# XLN Development Workflow Guide

## Overview

This guide summarizes the project management structure for XLN development, optimizing the integration between GitHub and Claude Code for efficient AI-assisted development.

## 📋 Project Structure

### GitHub Organization

```
.github/
├── ISSUE_TEMPLATE/
│   ├── feature.md      # Major component implementations
│   ├── bug.md          # Bug reports
│   └── task.md         # Development tasks for Claude sessions
└── workflows/
    └── ci.yml          # Automated testing and checks
```

### Documentation

- **CONTRIBUTING.md** - Development workflow and standards
- **PROJECT.md** - Team coordination and management
- **WORKFLOW.md** - This guide (quick reference)
- **CLAUDE.md** - AI assistant configuration

## 🚀 Recommended Daily Workflow

### 1. Individual Developer Flow

```bash
# Morning: Pick an issue
gh issue list --label "claude:ready"
gh issue edit <number> --add-assignee @me

# Start Claude Code session
claude

# In Claude:
"I'm working on issue #<number>: <title>
Let's start by reviewing the requirements in the issue description."

# Development cycle
bun test               # Run tests
bun run typecheck      # Check types
git add -A             # Stage changes
git commit -m "feat: <description>"

# Submit PR
gh pr create --title "feat: <description>" --body "Closes #<number>"
```

### 2. Claude Code Session Structure

Each session should follow this pattern:

```
CONTEXT → DESIGN → IMPLEMENT → TEST → DOCUMENT
```

**Example Session Flow:**
1. Reference the GitHub issue
2. Review relevant specification sections
3. Design the solution (types first)
4. Implement with pure functions
5. Write comprehensive tests
6. Update documentation

### 3. Team Coordination

#### GitHub Project Board Columns
- **Backlog** - Unassigned issues
- **Ready** - Issues with `claude:ready` label
- **In Progress** - Assigned issues
- **In Review** - Open PRs
- **Done** - Merged PRs

#### Label System
```yaml
# Components
layer:server, layer:signer, layer:entity, layer:channel

# Priority
priority:critical, priority:high, priority:medium, priority:low

# Status
claude:ready, needs:design, needs:research, blocked

# Difficulty
good-first-issue, difficulty:easy, difficulty:medium, difficulty:hard
```

## 💡 Best Practices

### Issue Creation
- One issue = One Claude session worth of work
- Include specific requirements and performance targets
- Reference specification sections
- Add `claude:ready` label when fully defined

### Claude Code Sessions
- Start with clear context (issue number)
- Request tests with implementation
- Ask for performance benchmarks
- Document any gotchas discovered

### Pull Requests
- Reference issue: "Closes #XX"
- Include test results
- Document Claude learnings
- Keep PRs focused (<400 lines)

### Code Quality Standards
- Pure functional (no classes)
- Immutable data structures
- >90% test coverage for core logic
- Meet performance targets from PRD

## 📊 Progress Tracking

### Key Metrics
- Issues completed per week
- Average PR cycle time
- Test coverage trend
- Performance benchmarks

### Milestones
1. ✅ **MVP Core** - Server, Entity, Persistence
2. 🚧 **Channels** - Payment channels, reserve-credit
3. 📋 **Network** - WebSocket, REST API
4. 📋 **Production** - Performance, security, deployment

## 🛠️ Quick Commands

```bash
# Issues
gh issue create --template feature.md
gh issue list --assignee @me
gh issue view <number>

# Development
bun dev                # Run with auto-reload
bun test              # Run all tests
bun run typecheck     # Type check
bun run clean         # Clean data directory

# Git
git checkout -b feature/<name>
git add -A && git commit -m "feat: <description>"
gh pr create

# Review
gh pr checks
gh pr review <number> --approve
```

## 🎯 Performance Targets

From the PRD, all implementations must meet:
- Block time: 100ms
- Transaction latency: <10ms
- Merkle proof generation: <1ms
- Signature aggregation: <5ms for 100 signatures
- Support 10M+ channels, 100k+ TPS

## 🔗 Resources

- **Specification**: `/docs/XLN_SPECIFICATION.md`
- **PRD**: `/docs/XLN_PRD.md`
- **Contributing**: `/CONTRIBUTING.md`
- **Project Management**: `/PROJECT.md`
- **GitHub Issues**: https://github.com/adimov-eth/xln/issues

## 📝 Example Claude Prompts

### Research Phase
```
"Let's explore how other projects handle <problem>.
Check our existing patterns in src/core/"
```

### Implementation Phase
```
"Implement <feature> following our patterns:
- Pure functional (no classes)
- Immutable data structures
- Must achieve <performance target>
- Include comprehensive tests"
```

### Review Phase
```
"Review the implementation for:
- Functional purity
- Performance bottlenecks
- Test coverage
- Edge cases"
```

---

Remember: Follow the Kalashnikov Principle - reliability through simplicity!