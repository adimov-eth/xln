import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const port = 18080 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
let serverProc: ReturnType<typeof Bun.spawn> | null = null;

const waitForHealth = async (timeoutMs = 90_000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // server booting
    }
    await Bun.sleep(300);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
};

const expectNot404 = (status: number, endpoint: string): void => {
  expect(status, `${endpoint} should exist`).not.toBe(404);
};

describe('Server API smoke', () => {
  beforeAll(async () => {
    serverProc = Bun.spawn(['bun', 'runtime/server.ts', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        USE_ANVIL: 'false',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await waitForHealth();
  }, 120_000);

  afterAll(async () => {
    if (!serverProc) return;
    serverProc.kill();
    await serverProc.exited;
  });

  test('GET endpoints', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    const healthJson = await health.json();
    expect(healthJson).toBeObject();

    for (const endpoint of ['/api/state', '/api/clients', '/api/debug/events', '/api/debug/entities', '/api/tokens']) {
      const res = await fetch(`${baseUrl}${endpoint}`);
      expectNot404(res.status, endpoint);
    }
  });

  test('POST endpoints exist', async () => {
    const postCases: Array<[string, Record<string, unknown>]> = [
      ['/api/debug/reset', {}],
      ['/api/faucet/erc20', { to: '0x0000000000000000000000000000000000000001', amount: '1', token: 'USDC' }],
      ['/api/faucet/gas', { to: '0x0000000000000000000000000000000000000001', amount: '1' }],
      ['/api/faucet/reserve', { entityId: '0x1', tokenId: 1, amount: '1' }],
      ['/api/faucet/offchain', { fromEntityId: '0x1', toEntityId: '0x2', tokenId: 1, amount: '1' }],
      ['/api/rpc', { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }],
      ['/rpc', { jsonrpc: '2.0', id: 2, method: 'eth_chainId', params: [] }],
    ];

    for (const [endpoint, body] of postCases) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expectNot404(res.status, endpoint);
    }
  });
});
