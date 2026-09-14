const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function apiError(status, code, message) {
  return json({ error: { code, message, host: 'CLOUDFLARE' } }, status);
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function proxyApi(request, env, url) {
  const upstreamBase = normalizeOrigin(env.SUPABASE_FUNCTION_URL);
  if (!upstreamBase) {
    return apiError(503, 'BACKEND_NOT_CONFIGURED', 'Supabase function URL is not configured on the Cloudflare gateway');
  }

  const suffix = url.pathname.replace(/^\/api/, '') || '/health';
  const upstreamUrl = new URL(upstreamBase + suffix);
  upstreamUrl.search = url.search;

  const headers = new Headers(request.headers);
  headers.set('x-am-gateway', 'cloudflare');
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;

  const upstream = await fetch(upstreamUrl, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('x-am-gateway', 'cloudflare');
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.delete('set-cookie');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function serveAdmin(request, env, url) {
  if (!env.ASSETS) return apiError(503, 'ADMIN_ASSETS_MISSING', 'Admin static assets are not bound');
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/index.html';
  assetUrl.search = '';
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-cache');
  headers.set('x-frame-options', 'DENY');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'am-studio-cloudflare-gateway',
        host: 'CLOUDFLARE',
        backendConfigured: Boolean(normalizeOrigin(env.SUPABASE_FUNCTION_URL)),
        providerDelivery: 'DISABLED',
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyApi(request, env, url);
    }

    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return serveAdmin(request, env, url);
    }

    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    return apiError(404, 'NOT_FOUND', 'Route not found');
  },
};
