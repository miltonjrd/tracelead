import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Portable to Postgres: explicit PKs, epoch-ms integers for timestamps, no SQLite-only types.

export const clients = sqliteTable('clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull().unique(),
  googleAdsCustomerId: text('google_ads_customer_id'),
  // Per-client Google Ads credentials/names; null falls back to the server-wide GOOGLE_ADS_* / CONVERSION_NAME_* env.
  googleAdsDeveloperToken: text('google_ads_developer_token'),
  googleAdsClientId: text('google_ads_client_id'),
  googleAdsClientSecret: text('google_ads_client_secret'),
  googleAdsRefreshToken: text('google_ads_refresh_token'),
  googleAdsLoginCustomerId: text('google_ads_login_customer_id'),
  conversionNameLead: text('conversion_name_lead'),
  conversionNameVenda: text('conversion_name_venda'),
  whatsappPhoneNumberId: text('whatsapp_phone_number_id').unique(),
  whatsappMode: text('whatsapp_mode', { enum: ['baileys', 'cloud'] }).notNull().default('baileys'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  currency: text('currency').notNull().default('BRL'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').references(() => clients.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'client'] }).notNull(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    renewedAt: integer('renewed_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const clicks = sqliteTable(
  'clicks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    ref: text('ref').notNull(),
    gclid: text('gclid'),
    gbraid: text('gbraid'),
    wbraid: text('wbraid'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),
    landingUrl: text('landing_url'),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    campaignId: text('campaign_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('clicks_client_ref_idx').on(t.clientId, t.ref),
    index('clicks_client_gclid_idx').on(t.clientId, t.gclid),
    index('clicks_client_created_idx').on(t.clientId, t.createdAt),
  ],
);

export const ORIGENS = ['anuncio', 'site', 'maps', 'indicacao', 'passou_na_frente', 'desconhecida'] as const;
export type Origem = (typeof ORIGENS)[number];

export const CONTACT_STATUS = ['aberto', 'vendeu', 'nao_comprou'] as const;
export type ContactStatus = (typeof CONTACT_STATUS)[number];

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    phone: text('phone').notNull(),
    name: text('name'),
    firstMessageAt: integer('first_message_at').notNull(),
    lastMessageAt: integer('last_message_at').notNull(),
    origem: text('origem', { enum: ORIGENS }).notNull(),
    clickId: integer('click_id').references(() => clicks.id),
    campanha: text('campanha'),
    status: text('status', { enum: CONTACT_STATUS }).notNull().default('aberto'),
    statusAt: integer('status_at').notNull(),
    exportadaEm: integer('exportada_em'),
  },
  (t) => [
    uniqueIndex('contacts_client_phone_idx').on(t.clientId, t.phone),
    index('contacts_client_last_msg_idx').on(t.clientId, t.lastMessageAt),
  ],
);

export const sales = sqliteTable(
  'sales',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    contactId: integer('contact_id')
      .notNull()
      .references(() => contacts.id),
    valorCentavos: integer('valor_centavos').notNull(),
    soldAt: integer('sold_at').notNull(),
    marcadoPor: integer('marcado_por').references(() => users.id),
    exportadaEm: integer('exportada_em'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('sales_client_sold_idx').on(t.clientId, t.soldAt),
    index('sales_contact_idx').on(t.contactId),
  ],
);

// One row per conversion line written to a file; gclid/time/value are frozen so a file
// downloads identically later even if the sale is corrected afterwards.
export const exports = sqliteTable(
  'exports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    tipo: text('tipo', { enum: ['lead', 'venda'] }).notNull(),
    referenciaId: integer('referencia_id').notNull(),
    arquivo: text('arquivo').notNull(),
    gclid: text('gclid'),
    gbraid: text('gbraid'),
    wbraid: text('wbraid'),
    conversaoEm: integer('conversao_em').notNull(),
    valorCentavos: integer('valor_centavos'),
    status: text('status', { enum: ['gerado', 'importado'] }).notNull().default('gerado'),
    exportadoEm: integer('exportado_em').notNull(),
  },
  (t) => [index('exports_client_arquivo_idx').on(t.clientId, t.arquivo)],
);

export const adSpend = sqliteTable(
  'ad_spend',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    date: text('date').notNull(),
    campaignId: text('campaign_id').notNull(),
    campaignName: text('campaign_name').notNull(),
    costMicros: integer('cost_micros').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('ad_spend_client_date_campaign_idx').on(t.clientId, t.date, t.campaignId)],
);

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    job: text('job', { enum: ['backup', 'ad_spend'] }).notNull(),
    clientId: integer('client_id').references(() => clients.id),
    status: text('status', { enum: ['rodando', 'ok', 'erro'] }).notNull(),
    detail: text('detail'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('job_runs_job_started_idx').on(t.job, t.startedAt)],
);

/** Baileys login state (creds + signal keys), one row per key, per client. */
export const whatsappAuth = sqliteTable(
  'whatsapp_auth',
  {
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.key] })],
);

export type Client = typeof clients.$inferSelect;
export type User = typeof users.$inferSelect;
export type Click = typeof clicks.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Sale = typeof sales.$inferSelect;
