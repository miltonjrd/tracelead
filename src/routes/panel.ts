import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { clients, type Client } from '../db/schema.js';
import { parseMoney } from '../lib/format.js';
import {
  getPanelRow,
  isOrigem,
  listPanel,
  markNotBought,
  markSold,
  PanelError,
  reopen,
  setOrigem,
} from '../services/panel.js';
import { page } from '../views/layout.js';
import { contactCard, panelPage } from '../views/panel.js';
import { isHtmx, requireRole } from './auth.js';

type ContactReq = FastifyRequest<{ Params: { id: string }; Body: Record<string, string | undefined> }>;

export async function panelRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;
  app.addHook('preHandler', requireRole('client'));

  async function currentClient(req: FastifyRequest): Promise<Client> {
    const client = await db.query.clients.findFirst({ where: eq(clients.id, req.user!.clientId!) });
    if (!client) throw new Error('Usuário sem cliente');
    return client;
  }

  app.get('/painel', async (req, reply) => {
    const client = await currentClient(req);
    const now = Date.now();
    const data = await listPanel(db, client, now);
    return reply.type('text/html').send(page({ title: 'Contatos', user: req.user, body: panelPage(data, client, now) }));
  });

  /** HTMX gets the re-rendered card; a plain form post (no JS) goes back to the list. */
  function action(path: string, run: (client: Client, contactId: number, req: ContactReq) => Promise<void>) {
    app.post(path, async (req: ContactReq, reply: FastifyReply) => {
      const client = await currentClient(req);
      const contactId = Number(req.params.id);
      let error: string | undefined;
      try {
        await run(client, contactId, req);
      } catch (err) {
        if (!(err instanceof PanelError)) throw err;
        error = err.message;
      }
      if (!isHtmx(req)) return reply.redirect('/painel', 303);
      const row = await getPanelRow(db, client.id, contactId);
      if (!row) return reply.code(404).send('Contato não encontrado');
      return reply.type('text/html').send(contactCard(row, client, Date.now(), error).value);
    });
  }

  action('/painel/contatos/:id/venda', async (client, id, req) => {
    const cents = parseMoney(req.body?.valor);
    if (cents === null) throw new PanelError('Digite o valor da venda, por exemplo 150 ou 1.250,90.');
    await markSold(db, client.id, id, cents, req.user!.id);
  });
  action('/painel/contatos/:id/nao-comprou', (client, id) => markNotBought(db, client.id, id));
  action('/painel/contatos/:id/reabrir', (client, id) => reopen(db, client.id, id));
  action('/painel/contatos/:id/origem', async (client, id, req) => {
    const origem = req.body?.origem;
    if (!isOrigem(origem) || origem === 'anuncio') throw new PanelError('Origem inválida');
    await setOrigem(db, client.id, id, origem, { overrideTracked: false });
  });
}
