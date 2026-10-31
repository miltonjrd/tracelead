import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');
const require = createRequire(import.meta.url);

interface Asset {
  body: Buffer;
  type: string;
  version: string;
}

function load(path: string, type: string): Asset {
  const body = readFileSync(path);
  return { body, type, version: createHash('sha256').update(body).digest('hex').slice(0, 10) };
}

const versioned: Record<string, Asset> = {
  'app.css': load(resolve(publicDir, 'app.css'), 'text/css; charset=utf-8'),
  'app.js': load(resolve(publicDir, 'app.js'), 'text/javascript; charset=utf-8'),
  'icon.svg': load(resolve(publicDir, 'icon.svg'), 'image/svg+xml'),
  'htmx.min.js': load(require.resolve('htmx.org/dist/htmx.min.js'), 'text/javascript; charset=utf-8'),
};

const rootFiles: Record<string, { asset: Asset; cache: string }> = {
  '/t.js': { asset: load(resolve(publicDir, 't.js'), 'text/javascript; charset=utf-8'), cache: 'public, max-age=300' },
  '/sw.js': { asset: load(resolve(publicDir, 'sw.js'), 'text/javascript; charset=utf-8'), cache: 'no-cache' },
  '/manifest.webmanifest': {
    asset: load(resolve(publicDir, 'manifest.webmanifest'), 'application/manifest+json'),
    cache: 'public, max-age=3600',
  },
};

/** URL with a content hash, so the file can be cached forever and still update on deploy. */
export function assetUrl(name: keyof typeof versioned): string {
  return `/static/${name}?v=${versioned[name]!.version}`;
}

export async function staticRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>('/static/:name', async (req, reply) => {
    const asset = versioned[req.params.name];
    if (!asset) return reply.code(404).send('Não encontrado');
    return reply.type(asset.type).header('Cache-Control', 'public, max-age=31536000, immutable').send(asset.body);
  });
  for (const [path, { asset, cache }] of Object.entries(rootFiles)) {
    app.get(path, async (_req, reply) => {
      const r = reply.type(asset.type).header('Cache-Control', cache);
      // The tracking script is loaded from the client's own site.
      if (path === '/t.js') r.header('Access-Control-Allow-Origin', '*').header('Cross-Origin-Resource-Policy', 'cross-origin');
      return r.send(asset.body);
    });
  }
}
