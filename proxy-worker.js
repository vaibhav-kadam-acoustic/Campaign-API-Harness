/**
 * Acoustic Campaign API Proxy — Cloudflare Worker
 *
 * Handles three call types:
 *   1. OAuth token fetch  (Content-Type: application/x-www-form-urlencoded)
 *   2. XML API calls      (Content-Type: text/xml;charset=UTF-8, Bearer token)
 *   3. REST API calls     (Content-Type: application/json, Bearer token)
 *
 * Deploy steps (2 min, free account):
 *   1. Open deploy-worker.html in the Campaign-API-Harness repo
 *   2. Enter your Cloudflare Account ID and an "Edit Workers" API token
 *   3. Click Deploy — copy the *.workers.dev URL shown
 *   4. Paste that URL into the "Proxy" field in the Campaign API Harness
 *
 * The harness POSTs JSON to this worker:
 *   { endpoint, method, token?, contentType, body? }
 */

const ALLOWED_ORIGINS = [
  'https://vaibhav-kadam-acoustic.github.io',
  'https://campaign-api-harness.acoustic.com',
  'http://localhost',
  'http://127.0.0.1',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonError(msg, status, origin) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonError('Invalid JSON body', 400, origin);
    }

    const { endpoint, method = 'POST', token, contentType = 'application/json', body } = payload;

    if (!endpoint) {
      return jsonError('Missing endpoint', 400, origin);
    }

    // Build upstream headers
    const headers = { 'Content-Type': contentType };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Build upstream request options
    const upstreamInit = { method, headers };
    if (body && method !== 'GET' && method !== 'HEAD') {
      upstreamInit.body = body;
    }

    let upstream;
    try {
      upstream = await fetch(endpoint, upstreamInit);
    } catch (err) {
      return jsonError(`Upstream fetch failed: ${err.message}`, 502, origin);
    }

    const responseText = await upstream.text();

    // Preserve the upstream Content-Type for proper XML/JSON handling on the client
    const upstreamCT = upstream.headers.get('Content-Type') || 'text/plain';

    return new Response(responseText, {
      status: upstream.status,
      headers: {
        'Content-Type': upstreamCT,
        ...corsHeaders(origin),
      },
    });
  },
};
