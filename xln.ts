#!/usr/bin/env bun
/**
 * XLN CLI Entry Point
 *
 * This is the main entry point to run xln server.
 * Runtime is a pure library with no side effects.
 * Uses BrowserVM by default (external RPC not yet supported).
 *
 * Usage:
 *   bun run xln.ts              → start server with BrowserVM
 *   NO_DEMO=1 bun run xln.ts    → start server without demo prompt
 *   bun run xln.ts --no-demo    → same as above
 */

import { main } from './runtime/runtime';
import type { Env } from './runtime/types';
import { BrowserVMProvider } from './runtime/jadapter';
import { setBrowserVMJurisdiction } from './runtime/evm';
import { startRuntimeWsServer } from './runtime/networking/ws-server';

const initializeBrowserVM = async (env: Env): Promise<void> => {
  console.log('🔧 Initializing BrowserVM...');
  const browserVM = new BrowserVMProvider();
  await browserVM.init();
  (env as Env & { browserVM?: unknown }).browserVM = browserVM;
  setBrowserVMJurisdiction(env, browserVM.getDepositoryAddress(), browserVM);
  console.log(`✅ BrowserVM ready (Depository: ${browserVM.getDepositoryAddress()})`);
};

// Main execution
(async () => {
  try {
    // Start runtime first, then attach BrowserVM without scenario boot coupling.
    const env = await main();
    await initializeBrowserVM(env);

    if (env) {
      const noDemoFlag = process.env['NO_DEMO'] === '1' || process.argv.includes('--no-demo');

      const wsPort = process.env['WS_PORT'];
      if (wsPort) {
        const runtimeId = env.runtimeId || process.env['WS_RUNTIME_ID'] || 'hub';
        const host = process.env['WS_HOST'] || '0.0.0.0';
        const requireAuth = process.env['WS_REQUIRE_AUTH'] === '1';
        startRuntimeWsServer({
          host,
          port: Number(wsPort),
          serverId: runtimeId,
          requireAuth,
        });
      }

      if (!noDemoFlag) {
        console.log('✅ Node.js environment initialized.');
        console.log('💡 Demo removed - use scenarios/ahb.ts or scenarios/grid.ts instead');
        console.log('💡 To skip this message, use: NO_DEMO=1 bun run xln.ts or --no-demo flag');
      } else {
        console.log('✅ Node.js environment initialized (NO_DEMO mode)');
        console.log('💡 Use scenarios.ahb(env) or scenarios.grid(env) for demos');
      }
    }
  } catch (error) {
    console.error('❌ An error occurred:', error);
    process.exit(1);
  }
})();
