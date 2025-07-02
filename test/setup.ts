import { expect } from 'bun:test'
expect.extend({ toBeTruthy: (v: unknown) => ({ pass: !!v, message: () => '' }) })
