import type { RequestHandler } from './$types';

/**
 * RPC Proxy - Forward HTTPS requests to HTTP Hardhat nodes
 *
 * Frontend runs on HTTPS (required for VR/WebXR)
 * Hardhat runs on HTTP (simpler, standard)
 * This proxy bridges the gap
 *
 * Usage from frontend:
 *   fetch('/rpc/ethereum', { method: 'POST', body: jsonRpcPayload })
 *   [RIGHTWARDS] proxies to http://localhost:8545
 */

const RPC_ENDPOINTS: Record<string, string> = {
  ethereum: 'http://localhost:8545',
  polygon: 'http://localhost:8546',
  arbitrum: 'http://localhost:8547'
};

export const POST: RequestHandler = async ({ params, request }) => {
  const network = params.path || 'ethereum';
  const targetUrl = RPC_ENDPOINTS[network];

  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: `Unknown network: ${network}` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Forward request to HTTP Hardhat node
    const body = await request.text();

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body
    });

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('RPC proxy error:', error);
    return new Response(
      JSON.stringify({
        error: 'RPC request failed',
        details: error instanceof Error ? error.message : String(error)
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET: RequestHandler = async () => {
  return new Response(
    JSON.stringify({
      error: 'RPC proxy requires POST requests',
      availableNetworks: Object.keys(RPC_ENDPOINTS)
    }),
    { status: 405, headers: { 'Content-Type': 'application/json' } }
  );
};
