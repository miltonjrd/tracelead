import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { html } from '../lib/html.js';
import { authenticate, createSession, deleteSession, resolveSession, SESSION_TTL_MS } from '../services/auth.js';
import { flash, page } from '../views/layout.js';

export const SESSION_COOKIE = 'sid';

export function setSessionCookie(reply: FastifyReply, token: string, config: Config): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function isHtmx(req: FastifyRequest): boolean {
  return req.headers['hx-request'] === 'true';
}

function homeFor(user: FastifyRequest['user']): string {
  if (!user) return '/login';
  return user.role === 'admin' ? '/admin' : '/painel';
}

/** Also rejects cross-site form posts (CSRF) beyond what the SameSite=Lax cookie already blocks. */
export function requireRole(role: 'admin' | 'client') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      if (isHtmx(req)) return reply.header('HX-Redirect', '/login').code(401).send();
      return reply.redirect('/login', 303);
    }
    if (req.user.role !== role) return reply.redirect(homeFor(req.user), 303);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && origin !== 'null') {
        let host: string | null = null;
        try {
          host = new URL(origin).host;
        } catch {}
        if (host !== req.headers.host) return reply.code(403).send('Origem não permitida');
      }
    }
  };
}

export function sessionHook(db: Db, config: Config) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await resolveSession(db, token);
    if (!session) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    req.user = session.user;
    if (session.renewed) setSessionCookie(reply, token, config);
  };
}

function loginPage(error?: string) {
  return page({
    title: 'Entrar',
    body: html`<form method="post" action="/login" class="card auth">
      <h1>Entrar</h1>
      ${flash('erro', error)}
      <label>Usuário<input name="username" autocomplete="username" autocapitalize="none" required autofocus></label>
      <label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit">Entrar</button>
    </form>`,
  });
}

export async function authRoutes(app: FastifyInstance, opts: { db: Db; config: Config }): Promise<void> {
  const { db, config } = opts;

  app.get('/', async (req, reply) => reply.redirect(homeFor(req.user), 303));

  app.get('/login', async (req, reply) => {
    if (req.user) return reply.redirect(homeFor(req.user), 303);
    return reply.type('text/html').send(loginPage());
  });

  app.post<{ Body: { username?: string; password?: string } }>(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { username, password } = req.body ?? {};
      const user =
        typeof username === 'string' && typeof password === 'string' && username && password
          ? await authenticate(db, username, password)
          : null;
      if (!user) return reply.code(401).type('text/html').send(loginPage('Usuário ou senha incorretos.'));
      setSessionCookie(reply, await createSession(db, user.id), config);
      return reply.redirect(user.role === 'admin' ? '/admin' : '/painel', 303);
    },
  );

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/login', 303);
  });
}
