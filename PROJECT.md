# XLN Project Management Guide

## Quick Start for Team Members

### Daily Workflow with Claude Code

1. **Pick an Issue**
   ```bash
   # View available issues
   gh issue list --label "claude:ready"
   
   # Assign yourself
   gh issue edit <number> --add-assignee @me
   ```

2. **Start Claude Session**
   ```bash
   # Start Claude Code
   claude
   
   # First message to Claude:
   "I'm working on issue #<number>: <title>
   Check the issue description for requirements.
   Let's start by reading the relevant spec sections."
   ```

3. **Development Loop**
   - Implement with Claude
   - Run tests: `bun test`
   - Check types: `bun run typecheck`
   - Commit with conventional format

4. **Submit PR**
   ```bash
   gh pr create --title "feat: <description>" --body "Closes #<number>"
   ```

## Recommended GitHub Setup

### 1. Project Board Columns
- **Backlog**: All unassigned issues
- **Ready**: Issues with `claude:ready` label
- **In Progress**: Assigned issues
- **In Review**: Open PRs
- **Done**: Merged PRs

### 2. Labels Structure
```yaml
# Component layers
- layer:server
- layer:signer  
- layer:entity
- layer:channel
- layer:depositary

# Priority
- priority:critical
- priority:high
- priority:medium
- priority:low

# Type
- type:feature
- type:bug
- type:task
- type:research

# Status
- claude:ready      # Ready for implementation
- needs:design      # Needs technical design
- needs:research    # Needs investigation
- blocked           # Blocked by dependencies

# Difficulty
- good-first-issue
- difficulty:easy
- difficulty:medium
- difficulty:hard
```

### 3. Milestones

Create milestones for major phases:

1. **MVP Core** ✅ (Complete)
   - Server state machine
   - Entity consensus
   - Basic persistence

2. **Channels** (Current)
   - Channel state machine
   - Reserve-credit system
   - Multi-hop routing

3. **Network Layer**
   - WebSocket implementation
   - REST API
   - Message serialization

4. **Production Ready**
   - Performance optimization
   - Security audit
   - Deployment tools

## Working with Claude Code

### Effective Session Management

1. **Preparation Checklist**
   - [ ] Issue has clear requirements
   - [ ] Related specs are referenced
   - [ ] Performance targets defined
   - [ ] Test scenarios outlined

2. **Session Structure**
   ```
   CONTEXT → DESIGN → IMPLEMENT → TEST → DOCUMENT
   ```

3. **Claude Prompts by Phase**

   **Research Phase:**
   ```
   "Let's explore how other projects handle <problem>.
   Check our existing patterns in src/core/"
   ```

   **Design Phase:**
   ```
   "Based on the spec in docs/XLN_SPECIFICATION.md section X,
   design the types and pure functions for <feature>"
   ```

   **Implementation Phase:**
   ```
   "Implement <feature> following our patterns:
   - Pure functional (no classes)
   - Immutable data structures
   - Must achieve <performance target>"
   ```

   **Testing Phase:**
   ```
   "Write comprehensive tests including:
   - Unit tests for each function
   - Integration test for the flow
   - Performance benchmark"
   ```

### Multi-Session Features

For complex features spanning multiple sessions:

1. **Session 1**: Types and interfaces
2. **Session 2**: Core implementation
3. **Session 3**: Tests and benchmarks
4. **Session 4**: Integration and documentation

## Team Coordination

### Communication Channels

1. **GitHub Issues**: Technical discussions
2. **PR Reviews**: Code feedback
3. **Discussions**: Architecture decisions

### Code Review Process

1. **Self Review**:
   - Run all tests
   - Check performance
   - Verify documentation

2. **Peer Review Focus**:
   - Functional purity
   - Performance implications
   - Test coverage
   - Spec compliance

### Knowledge Sharing

1. **Document Claude Learnings**:
   ```markdown
   <!-- In PR description -->
   ## Claude Code Notes
   - Effective prompt: "..."
   - Gotcha discovered: ...
   - Pattern that worked well: ...
   ```

2. **Update CLAUDE.md**:
   - Add new patterns discovered
   - Document project-specific context
   - Include helpful prompts

## Tracking Progress

### Metrics to Track

1. **Velocity**
   - Issues completed per week
   - Average PR cycle time
   - Test coverage trend

2. **Performance**
   - Block processing time
   - Memory usage
   - Transaction throughput

3. **Quality**
   - Bug discovery rate
   - Test coverage
   - Type safety violations

### Weekly Reviews

1. **What to Review**:
   - Completed issues
   - Blocked items
   - Performance metrics
   - Upcoming priorities

2. **Action Items**:
   - Unblock issues
   - Adjust priorities
   - Plan next sprint

## Advanced GitHub Integration

### Automation with GitHub Actions

1. **Issue Templates**: ✅ Created
2. **CI Pipeline**: ✅ Created
3. **Future Automations**:
   - Performance regression detection
   - Automated benchmarking
   - Documentation generation

### Using GitHub CLI

```bash
# Create issue from template
gh issue create --template feature.md

# List your assigned issues
gh issue list --assignee @me

# Create PR with template
gh pr create --template pull_request_template.md

# Check CI status
gh pr checks

# Review PR
gh pr review <number> --comment -b "LGTM!"
```

## Best Practices

### 1. Issue Creation
- One issue = one Claude session worth of work
- Clear success criteria
- Link to spec sections
- Include performance requirements

### 2. PR Size
- Keep PRs focused (< 400 lines)
- One feature per PR
- Include tests in same PR

### 3. Documentation
- Update inline with code
- Document decisions
- Share Claude learnings

### 4. Performance
- Benchmark before optimizing
- Document performance characteristics
- Set up regression detection

## Getting Started Checklist

For new team members:

1. [ ] Read CONTRIBUTING.md
2. [ ] Review open issues
3. [ ] Pick a `good-first-issue`
4. [ ] Set up development environment
5. [ ] Run existing tests
6. [ ] Try a Claude Code session
7. [ ] Submit first PR

## Questions?

- Technical: Create a GitHub issue
- Process: Suggest improvements via PR
- Urgent: Use GitHub Discussions

Remember: The goal is to build a reliable, simple, and performant system following the Kalashnikov Principle!