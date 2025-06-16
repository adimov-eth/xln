# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript project using Bun as the runtime and package manager. The project was initialized with `bun init` and uses modern TypeScript features with strict type checking enabled.

## Development Commands

### Package Management
- **Install dependencies**: `bun install`
- **Add a dependency**: `bun add <package>`
- **Add a dev dependency**: `bun add -d <package>`
- **Remove a dependency**: `bun remove <package>`

### Running Code
- **Execute the main script**: `bun run index.ts`
- **Run any TypeScript file directly**: `bun <filename.ts>`

### TypeScript
- **Type check without running**: `bun --bun tsc --noEmit`
- Note: Bun handles TypeScript execution directly without a separate build step

## Code Architecture

### Technology Stack
- **Runtime**: Bun (fast all-in-one JavaScript runtime)
- **Language**: TypeScript 5.x with strict mode
- **Module System**: ESNext modules with bundler resolution
- **Package Manager**: Bun (replaces npm/yarn/pnpm)

### TypeScript Configuration
The project enforces strict TypeScript settings:
- Strict mode is enabled (all strict checks)
- Target and lib set to ESNext (latest JavaScript features)
- Module resolution set to "bundler" with import extensions allowed
- No fallthrough cases in switch statements
- No unchecked indexed access
- JSX support configured for React

### Project Structure
- `index.ts`: Main entry point
- `tsconfig.json`: TypeScript compiler configuration
- `bun.lock`: Lockfile for reproducible installs

## Development Guidelines

### Bun-Specific Practices
- Always use `bun` commands instead of `npm`, `yarn`, or `pnpm`
- TypeScript files can be executed directly without compilation
- Bun has built-in TypeScript support, so no build step is needed for development
- Use `bun test` for running tests (when tests are added)

### Code Style
- Maintain strict type safety - avoid using `any` type
- Use modern JavaScript/TypeScript features (ESNext)
- Import statements should use proper extensions when needed
- Follow the existing TypeScript configuration's strict rules

### Performance Considerations
- Bun is optimized for startup speed and runtime performance
- The TypeScript config skips library checking for faster type checking
- Direct execution of TypeScript files eliminates build overhead
