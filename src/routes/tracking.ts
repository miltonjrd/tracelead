import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { InvalidClick, recordClick } from '../services/tracking.js';
import { processWebhook, validSignature } from '../services/whatsapp.js';

export async function trackingRoutes(app: FastifyInstance, opts: { db: Db; config: Config }): Promise<void> {
  const { db, config } = opts;

  // Sent from the client's site, so any origin is accepted; the script posts text/plain via
  // sendBeacon, which needs no CORS preflight.
  app.options('/click', async (_req, reply) =>
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'POST')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .code(204)
      .send(),
  );

  app.post('/click', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return reply.code(400).send({ error: 'json inválido' });
      }
    }
    try {
      const click = await recordClick(db, body, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        ipHashSecret: config.ipHashSecret,
      });
      if (!click) return reply.code(404).send({ error: 'cliente desconhecido' });
    } catch (err) {
      if (err instanceof InvalidClick) return reply.code(400).send({ error: err.message });
      throw err;
    }
    return reply.code(204).send();
  });

  await app.register(async (hooks) => {
    // The signature covers the exact bytes Meta sent, so keep the raw body.
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as typeof req & { rawBody: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    });

    hooks.get<{ Querystring: Record<string, string | undefined> }>('/webhook', async (req, reply) => {
      const q = req.query;
      if (q['hub.mode'] === 'subscribe' && config.meta.verifyToken && q['hub.verify_token'] === config.meta.verifyToken) {
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      }
      return reply.code(403).send('Token de verificação inválido');
    });

    hooks.post('/webhook', async (req, reply) => {
      if (!config.meta.appSecret) return reply.code(503).send('META_APP_SECRET não configurado');
      const raw = (req as typeof req & { rawBody?: string }).rawBody ?? '';
      if (!validSignature(raw, req.headers['x-hub-signature-256'], config.meta.appSecret)) {
        return reply.code(401).send('Assinatura inválida');
      }
      const result = await processWebhook(db, req.body);
      if (result.unknownPhoneNumberIds.length) {
        req.log.warn({ phoneNumberIds: result.unknownPhoneNumberIds }, 'webhook de número sem cliente cadastrado');
      }
      return reply.send('ok');
    });
  });

  app.get('/health', async (_req, reply) => {
    db.$client.prepare('select 1').get();
    return reply.header('Cache-Control', 'no-store').send({ ok: true });
  });
}
