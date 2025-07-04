# GEMINI.md — Project Constitution

This file is the single source of truth for all code architecture, style, and philosophy in this project. Adhere to it without exception. The goal is not just working code, but self-evident, minimal, and robust systems.

════════════════════════════════════════════════════════════

## MISSION & PHILOSOPHY

**Core Mission:** Design and implement rapid, robust, and secure solutions using **functional, declarative TypeScript**. Every line of code must be self-explanatory through its structure and naming.

**Guiding Philosophy: Code IS Documentation**

1.  **Intent Over Cleverness:** Names must precisely describe behavior. If a name is insufficient, the code is wrong.
2.  **Obvious Data Flow:** Logic must follow a traceable `Input → Process → Output` path.
3.  **Functional Purity as Default:** All functions are pure and side-effect-free unless a clear, documented performance or clarity constraint requires otherwise.
4.  **Composition as Prose:** Code should read like a sentence. `pipe(loadData, validateSchema, transformUser, saveRecord)`.
5.  **Aggressive Single Responsibility:**
    - **Files:** One conceptual domain per file. Max 500 LoC.
    - **Functions:** One logical operation per function. Max 40 LoC.
    - **Types:** One data structure or contract per type alias.
6.  **Explicit Contracts:** All dependencies, side effects, and error paths are declared and visible at the function signature level.
7.  **Accessible TypeScript:** Advanced types are used only to _simplify and clarify_ business logic, never to obscure it. A junior developer must be able to understand the intent.

════════════════════════════════════════════════════════════

## MANDATES & HARD CONSTRAINTS

These are non-negotiable.

- **Runtime Environment:** **Bun**. All commands must use `bun`. Never use `npm`, `pnpm`, or `yarn`.
- **Programming Paradigm:** **100% functional and declarative.**
  - **ABSOLUTELY NO CLASSES.** Use functions and plain objects.
  - **NO `this` KEYWORD.**
- **Immutability:** All data structures are immutable by default. State is changed by creating new state from old state.
- **Naming Convention:**
  - `camelCase` for all functions and values (`const getUserProfile`).
  - `PascalCase` for all type definitions (`type UserProfile`).
- **Code Comments:** **PROHIBITED.** Code must explain itself. The only acceptable comments are top-of-file docblocks for legal/licensing or temporary `// TODO:` markers with an associated ticket number.
- **Visual Noise:** Omit `readonly` and `public`/`private`/`protected` modifiers. Immutability is the default assumption; verbosity that doesn't change behavior is noise.
- **Dependency Management:** Do not propose direct edits to `package.json`. Instead, provide the `bun add <package>` command.

────────────────────────────────────────────────────────────

## TYPESCRIPT STYLE & PATTERNS

- **Type Composition:** Decompose complex types into smaller, well-named building blocks.
  - **Good:** `type UserPreferences = { theme: 'dark' | 'light'; notifications: boolean; }`
  - **Bad:** `type UserPreferences = { [key: string]: 'dark' | 'light' | boolean; }`
- **Type Factories:** Use generic type creators for common patterns to enhance safety and readability.
  - `type ApiResponse<TData> = { ok: true; data: TData } | { ok: false; error: ApiError };`
  - `type Result<TSuccess, TError> = { success: true; value: TSuccess } | { success: false; error: TError };`
- **Avoid Obfuscation:** Do not use deeply nested conditional types or complex mapped types inline. If needed, wrap them in a type alias with a name that explains its business purpose.

────────────────────────────────────────────────────────────

## FUNCTION & API DESIGN

- **Function Signatures:** For functions with more than one argument, use the Receive Object-Return Object (RO-RO) pattern.
  - **Good:** `const createUser = ({ name, email }: CreateUserParams): User => { ... };`
  - **Bad:** `const createUser = (name, email, role, isActive) => { ... };`
- **Control Flow:** Use guard clauses and early returns to reduce nesting.
- **Error Handling:** Functions that can fail must return an explicit `Result` object. Never throw exceptions for predictable business logic errors.
  - **Signature:** `const processPayment = (params: PaymentParams): Result<TransactionReceipt, PaymentError>`
- **API Payloads:** All I/O operations (HTTP APIs, database calls) must return a standardized payload:
  - `{ ok: boolean, data: T | null, error: E | null }`
- **Asynchronicity:** Use `async/await` for all asynchronous operations. Abstract I/O details away from the core domain logic.

────────────────────────────────────────────────────────────

## PROJECT STRUCTURE

- **No Generic Buckets:** Avoid folders named `utils`, `helpers`, `common`, or `misc`.
- **Feature-Based Colocation:** Group files by feature or domain. A `userProfile` feature would contain its own types, API handlers, data transformations, and validation logic.
- **File Naming:** Files should be named after their primary export, using `camelCase`.
  - `getUserProfile.ts` (exports `getUserProfile`)
  - `userProfile.types.ts` (exports `UserProfile`, `UserProfileUpdate`)
