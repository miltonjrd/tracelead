export interface Config {
  production: boolean;
  port: number;
  host: string;
  baseUrl: string;
  trustProxy: boolean;
  databasePath: string;
  backupDir: string;
  backupKeep: number;
  rcloneRemote: string;
  ipHashSecret: string;
  enableJobs: boolean;
  jobsTimezone: string;
  conversionNames: { lead: string; venda: string };
  meta: { appSecret: string; verifyToken: string };
  googleAds: {
    developerToken: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    loginCustomerId: string;
    apiVersion: string;
  };
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const get = (name: string, fallback = '') => env[name]?.trim() || fallback;

  const ipHashSecret = get('IP_HASH_SECRET', production ? '' : 'dev-only-secret');
  if (production && !ipHashSecret) throw new Error('IP_HASH_SECRET é obrigatório em produção');

  const baseUrl = get('BASE_URL', 'http://localhost:3000').replace(/\/$/, '');

  return {
    production,
    port: Number(get('PORT', '3000')),
    host: get('HOST', '0.0.0.0'),
    baseUrl,
    trustProxy: get('TRUST_PROXY', 'false') === 'true',
    databasePath: get('DATABASE_PATH', './data/tracker.db'),
    backupDir: get('BACKUP_DIR', './data/backups'),
    backupKeep: Number(get('BACKUP_KEEP', '14')),
    rcloneRemote: get('RCLONE_REMOTE'),
    ipHashSecret,
    enableJobs: get('ENABLE_JOBS', 'true') === 'true',
    jobsTimezone: get('JOBS_TZ', 'America/Sao_Paulo'),
    conversionNames: {
      lead: get('CONVERSION_NAME_LEAD', 'Lead WhatsApp'),
      venda: get('CONVERSION_NAME_VENDA', 'Venda WhatsApp'),
    },
    meta: {
      appSecret: get('META_APP_SECRET'),
      verifyToken: get('META_VERIFY_TOKEN'),
    },
    googleAds: {
      developerToken: get('GOOGLE_ADS_DEVELOPER_TOKEN'),
      clientId: get('GOOGLE_ADS_CLIENT_ID'),
      clientSecret: get('GOOGLE_ADS_CLIENT_SECRET'),
      refreshToken: get('GOOGLE_ADS_REFRESH_TOKEN'),
      loginCustomerId: get('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/\D/g, ''),
      apiVersion: get('GOOGLE_ADS_API_VERSION', 'v25'),
    },
  };
}

export function googleAdsConfigured(config: Config): boolean {
  const g = config.googleAds;
  return Boolean(g.developerToken && g.clientId && g.clientSecret && g.refreshToken);
}
