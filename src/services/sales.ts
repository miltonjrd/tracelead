import { and, desc, eq, gte, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contacts, sales, type Client } from '../db/schema.js';
import { normalizePhone } from '../lib/format.js';
import { PanelError } from './panel.js';

export async function listSales(db: Db, clientId: number, since: number) {
  return db
    .select({ sale: sales, contact: contacts })
    .from(sales)
    .innerJoin(contacts, eq(contacts.id, sales.contactId))
    .where(and(eq(sales.clientId, clientId), gte(sales.soldAt, since)))
    .orderBy(desc(sales.soldAt));
}

export async function updateSale(
  db: Db,
  client: Client,
  saleId: number,
  input: { valorCentavos: number; soldAt: number; phone: string },
  now = Date.now(),
): Promise<void> {
  const sale = await db.query.sales.findFirst({ where: and(eq(sales.id, saleId), eq(sales.clientId, client.id)) });
  if (!sale) throw new PanelError('Venda não encontrada');
  const phone = normalizePhone(input.phone);
  if (!phone) throw new PanelError('Telefone inválido');
  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.clientId, client.id), eq(contacts.phone, phone)),
  });
  if (!contact) throw new PanelError(`Nenhum contato com o telefone ${phone}`);

  db.transaction((tx) => {
    tx.update(sales)
      .set({ valorCentavos: input.valorCentavos, soldAt: input.soldAt, contactId: contact.id, updatedAt: now })
      .where(eq(sales.id, sale.id))
      .run();
    if (contact.id !== sale.contactId) {
      tx.update(contacts).set({ status: 'vendeu', statusAt: now }).where(eq(contacts.id, contact.id)).run();
      reopenIfNoSales(tx, sale.contactId, sale.id, now);
    }
  });
}

export async function deleteSale(db: Db, clientId: number, saleId: number, now = Date.now()): Promise<void> {
  const sale = await db.query.sales.findFirst({ where: and(eq(sales.id, saleId), eq(sales.clientId, clientId)) });
  if (!sale) throw new PanelError('Venda não encontrada');
  db.transaction((tx) => {
    tx.delete(sales).where(eq(sales.id, sale.id)).run();
    reopenIfNoSales(tx, sale.contactId, sale.id, now);
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function reopenIfNoSales(tx: Tx, contactId: number, movedSaleId: number, now: number): void {
  const other = tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.contactId, contactId), ne(sales.id, movedSaleId)))
    .limit(1)
    .all();
  if (!other.length) {
    tx.update(contacts)
      .set({ status: 'aberto', statusAt: now })
      .where(and(eq(contacts.id, contactId), eq(contacts.status, 'vendeu')))
      .run();
  }
}
