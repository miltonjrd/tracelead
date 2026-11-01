import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { FetchLike } from './jobs/googleAds.js';
import { html } from './lib/html.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes, sessionHook } from './routes/auth.js';
import { panelRoutes } from './routes/panel.js';
import { staticRoutes } from './routes/static.js';
import { trackingRoutes } from './routes/tracking.js';
import type { SessionUser } from './services/auth.js';
import type { WhatsAppSessions } from './services/whatsappSessions.js';
import { page } from './views/layout.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export interface AppDeps {
  config: Config;
  db: Db;
  sessions: WhatsAppSessions;
  logger?: FastifyServerOptions['logger'];
  fetchImpl?: FetchLike;
}

export async function buildApp({ config, db, sessions, logger = false, fetchImpl }: AppDeps) {
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 1024 * 1024 });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('user', null);
  app.addHook('onRequest', sessionHook(db, config));
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'same-origin');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header('Content-Security-Policy', CSP).header('Cache-Control', 'no-store');
    }
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    if (req.url.startsWith('/painel') || req.url.startsWith('/admin')) {
      return reply
        .code(status)
        .type('text/html')
        .send(page({ title: 'Erro', user: req.user, body: html`<h1>Algo deu errado</h1><p>Tente de novo. Se continuar, avise o gestor.</p>` }));
    }
    return reply.code(status).send({ error: status >= 500 ? 'erro interno' : err.message });
  });

  await app.register(staticRoutes);
  await app.register(trackingRoutes, { db, config });
  await app.register(authRoutes, { db, config });
  await app.register(panelRoutes, { db, sessions });
  await app.register(adminRoutes, { db, config, sessions, fetchImpl });

  return app;
}
