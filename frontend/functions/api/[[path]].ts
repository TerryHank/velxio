const DEFAULT_BACKEND_ORIGIN = 'http://38.76.201.240:8002';

interface Env {
  BACKEND_ORIGIN?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: Env;
}

export function buildUpstreamUrl(origin: string, requestUrl: string): string {
  const incoming = new URL(requestUrl);
  const upstreamOrigin = origin.replace(/\/+$/, '');
  const upstreamPath = incoming.pathname === '/api/health' ? '/health' : incoming.pathname;
  return `${upstreamOrigin}${upstreamPath}${incoming.search}`;
}

export async function onRequest(context: PagesFunctionContext): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(
    context.env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN,
    context.request.url,
  );
  const headers = new Headers(context.request.headers);
  headers.delete('host');

  const method = context.request.method.toUpperCase();
  const upstreamRequest = new Request(upstreamUrl, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : context.request.body,
    redirect: 'manual',
  });

  return fetch(upstreamRequest);
}
