import { performance } from 'node:perf_hooks';
import { applyServerFrame } from '../core/reducer';
import type { Input, ServerState, ServerFrame } from '../core/types';

export type Context = {
  state: ServerState;
  height: bigint;
};

const now = () => BigInt(Math.floor(performance.now()));

export const ingest = async (
  ctx: Context,
  batch: Input[],
): Promise<{ context: Context; serverFrame: ServerFrame }> => {
  const nextHeight = ctx.height + 1n;
  const { next, serverFrame } = await applyServerFrame(ctx.state, batch, now, nextHeight);

  // ---- MVP storage / WAL stub ----
  console.info(
    `⛓️  committed serverFrame #${serverFrame.height} root=${Buffer.from(serverFrame.root)
      .toString('hex')
      .slice(0, 16)}… inputsRoot=${Buffer.from(serverFrame.inputsRoot)
      .toString('hex')
      .slice(0, 16)}…`,
  );

  return {
    context: {
      state: next,
      height: nextHeight,
    },
    serverFrame,
  };
};

// Helper function to create initial context
export const createInitialContext = (): Context => ({
  state: new Map(),
  height: 0n,
});
