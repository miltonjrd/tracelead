import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { clients, type Client } from '../db/schema.js';
import { formatMoney, parseMoney } from '../lib/format.js';
import {
  getPanelRow,
  hasAnyContact,
  isOrigem,
  listPanel,
  markNotBought,
  markSold,
  PanelError,
  reopen,
  setOrigem,
} from '../services/panel.js';
import QRCode from 'qrcode';
import { SessionLimitError, type WhatsAppSessions } from '../services/whatsappSessions.js';
import { page } from '../views/layout.js';
import { avisoRegion, contactCard, contactLists, ledgerRow, panelPage } from '../views/panel.js';
import { connectionHealth } from '../services/connectionHealth.js';
import { whatsappPage, whatsappStatus } from '../views/whatsapp.js';
import { isHtmx, requireRole } from './auth.js';

type ContactReq = FastifyRequest<{ Params: { id: string }; Body: Record<string, string | undefined> }>;

export async function panelRoutes(app: FastifyInstance, opts: { db: Db; sessions: WhatsAppSessions }): Promise<void> {
  const { db, sessions } = opts;
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
    return reply.type('text/html').send(page({ title: 'Contatos', user: req.user, body: panelPage(data, client, now, sessions.status(client.id), await hasAnyContact(db, client.id), await connectionHealth(db, client, sessions.status(client.id), sessions.lastEventAt(client.id))) }));
  });

  /** Current connection state of the store's own client; the QR comes out as inline SVG. */
  async function connection(client: Client, error?: string) {
    const status = sessions.status(client.id);
    const qrSvg = status.state === 'aguardando_qr' ? await QRCode.toString(status.qr, { type: 'svg', margin: 0 }) : undefined;
    const health = await connectionHealth(db, client, status, sessions.lastEventAt(client.id));
    return { status, qrSvg, error, health };
  }

  app.get('/painel/whatsapp', async (req, reply) => {
    const client = await currentClient(req);
    const { status, qrSvg, health } = await connection(client);
    return reply.type('text/html').send(page({ title: 'WhatsApp', user: req.user, body: whatsappPage(client, status, qrSvg, health) }));
  });

  app.get('/painel/whatsapp/estado', async (req, reply) => {
    const client = await currentClient(req);
    const { status, qrSvg, health } = await connection(client);
    return reply.type('text/html').send(whatsappStatus(client, status, qrSvg, undefined, health).value);
  });

  function whatsappAction(path: string, run: (client: Client) => Promise<void>) {
    app.post(path, async (req, reply) => {
      const client = await currentClient(req);
      let error: string | undefined;
      try {
        if (client.whatsappMode === 'baileys') await run(client);
      } catch (err) {
        if (!(err instanceof SessionLimitError)) throw err;
        error = err.message;
      }
      if (!isHtmx(req) && !error) return reply.redirect('/painel/whatsapp', 303);
      const { status, qrSvg, health } = await connection(client, error);
      if (isHtmx(req)) return reply.type('text/html').send(whatsappStatus(client, status, qrSvg, error, health).value);
      return reply.type('text/html').send(page({ title: 'WhatsApp', user: req.user, body: whatsappPage(client, status, qrSvg, health) }));
    });
  }
  whatsappAction('/painel/whatsapp/conectar', (client) => sessions.connect(client.id));
  whatsappAction('/painel/whatsapp/desconectar', (client) => sessions.disconnect(client.id));

  /** HTMX gets the re-rendered card; a plain form post (no JS) goes back to the list. */
  function action(
    path: string,
    run: (client: Client, contactId: number, req: ContactReq) => Promise<string | void>,
    opts: { moves?: boolean; undoable?: boolean } = {},
  ) {
    app.post(path, async (req: ContactReq, reply: FastifyReply) => {
      const client = await currentClient(req);
      const contactId = Number(req.params.id);
      let error: string | undefined;
      let message: string | void = undefined;
      try {
        message = await run(client, contactId, req);
      } catch (err) {
        if (!(err instanceof PanelError)) throw err;
        error = err.message;
      }
      if (!isHtmx(req)) return reply.redirect('/painel', 303);
      if (opts.moves && !error) {
        // The mark moved the contact between lists: re-render both lists (and counts) and announce it.
        const now = Date.now();
        const data = await listPanel(db, client, now);
        const status = sessions.status(client.id);
        const off = client.whatsappMode === 'baileys' && status.state !== 'conectado';
        const lists = contactLists(data, client, now, { movedId: contactId, whatsappOff: off });
        const aviso = avisoRegion(message || undefined, true, opts.undoable ? contactId : undefined).value.replace(
          '<p ',
          '<p hx-swap-oob="true" ',
        );
        return reply
          .header('HX-Retarget', '#painel-lista')
          .header('HX-Reswap', 'outerHTML')
          .type('text/html')
          .send(lists.value + aviso);
      }
      const row = await getPanelRow(db, client.id, contactId);
      if (!row) return reply.code(404).send('Contato não encontrado');
      const body =
        row.contact.status === 'aberto'
          ? contactCard(row, client, Date.now(), error).value
          : ledgerRow(row, client, error).value;
      // A card swap that succeeded (origin change) still reports, so focus and screen readers are not left behind.
      const aviso =
        !error && message
          ? avisoRegion(message, true).value.replace('<p ', '<p hx-swap-oob="true" ')
          : '';
      return reply.type('text/html').send(body + aviso);
    });
  }

  action('/painel/contatos/:id/venda', async (client, id, req) => {
    const cents = parseMoney(req.body?.valor);
    if (cents === null) throw new PanelError('Digite o valor da venda, por exemplo 150 ou 1.250,90.');
    await markSold(db, client.id, id, cents, req.user!.id);
    return `Venda de ${formatMoney(cents, client.currency)} registrada.`;
  }, { moves: true, undoable: true });
  action('/painel/contatos/:id/nao-comprou', async (client, id) => {
    await markNotBought(db, client.id, id);
    return 'Contato marcado como não comprou.';
  }, { moves: true, undoable: true });
  action('/painel/contatos/:id/reabrir', async (client, id) => {
    await reopen(db, client.id, id);
    return 'Contato voltou para "Para marcar".';
  }, { moves: true });
  action('/painel/contatos/:id/origem', async (client, id, req) => {
    const origem = req.body?.origem;
    if (!isOrigem(origem) || origem === 'anuncio') throw new PanelError('Origem inválida');
    await setOrigem(db, client.id, id, origem, { overrideTracked: false });
    return 'Origem atualizada.';
  });
}
