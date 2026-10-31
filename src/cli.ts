import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { clients } from './db/schema.js';
import { createClient, createUser, generatePassword, setPassword, updateClient } from './services/accounts.js';

const HELP = `Uso: npm run cli -- <comando> [opções]

  create-client  --name <nome> [--tz America/Sao_Paulo] [--ads-customer-id 123-456-7890]
                 [--phone-number-id <id do número na Cloud API>]
  update-client  --id <n> [--name] [--tz] [--ads-customer-id] [--phone-number-id]
  list-clients
  create-user    --username <u> --role admin|client [--client <id>] [--password <senha>]
  set-password   --username <u> [--password <senha>]
  google-auth    [--port 8085]   gera o GOOGLE_ADS_REFRESH_TOKEN (precisa de CLIENT_ID e CLIENT_SECRET no .env)

Sem --password, uma senha aleatória é gerada e mostrada uma vez.`;

const [command, ...rest] = process.argv.slice(2);
const { values: args } = parseArgs({
  args: rest,
  options: {
    name: { type: 'string' },
    id: { type: 'string' },
    tz: { type: 'string' },
    'ads-customer-id': { type: 'string' },
    'phone-number-id': { type: 'string' },
    username: { type: 'string' },
    role: { type: 'string' },
    client: { type: 'string' },
    password: { type: 'string' },
    port: { type: 'string' },
  },
});

function need(name: keyof typeof args): string {
  const v = args[name];
  if (!v) throw new Error(`Falta --${name}`);
  return v;
}

const config = loadConfig();

async function googleAuth(): Promise<void> {
  const { clientId, clientSecret } = config.googleAds;
  if (!clientId || !clientSecret) throw new Error('Defina GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET no .env');
  const port = Number(args.port ?? 8085);
  const redirectUri = `http://localhost:${port}/callback`;
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();

  console.log(`Abra no navegador e autorize com a conta que acessa o Google Ads:\n\n${url}\n`);
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', redirectUri);
      if (u.pathname !== '/callback') return void res.writeHead(404).end();
      const got = u.searchParams.get('code');
      const ok = got && u.searchParams.get('state') === state;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(ok ? 'Pronto, pode fechar esta aba e voltar ao terminal.' : 'Falhou: autorização negada ou state inválido.');
      server.close();
      ok ? resolve(got) : reject(new Error(u.searchParams.get('error') ?? 'state inválido'));
    });
    server.listen(port, 'localhost');
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
  });
  const data = (await res.json()) as { refresh_token?: string; error_description?: string };
  if (!data.refresh_token) throw new Error(`Sem refresh token: ${data.error_description ?? res.status}`);
  console.log(`Coloque no .env:\n\nGOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}\n`);
}

async function main(): Promise<void> {
  if (command === 'google-auth') return googleAuth();
  if (!command || command === 'help') return console.log(HELP);

  const db = openDb(config.databasePath);
  try {
    switch (command) {
      case 'create-client': {
        const c = await createClient(db, {
          name: need('name'),
          timezone: args.tz,
          googleAdsCustomerId: args['ads-customer-id'],
          whatsappPhoneNumberId: args['phone-number-id'],
        });
        console.log(`Cliente ${c.id} criado: ${c.name}\n\nSnippet para o site:\n<script src="${config.baseUrl}/t.js" data-client="${c.publicKey}" async></script>`);
        break;
      }
      case 'update-client': {
        const c = await updateClient(db, Number(need('id')), {
          name: args.name,
          timezone: args.tz,
          googleAdsCustomerId: args['ads-customer-id'],
          whatsappPhoneNumberId: args['phone-number-id'],
        });
        console.log(`Cliente ${c.id} atualizado:`, c);
        break;
      }
      case 'list-clients':
        console.table(await db.select().from(clients));
        break;
      case 'create-user': {
        const role = need('role');
        if (role !== 'admin' && role !== 'client') throw new Error('--role deve ser admin ou client');
        const password = args.password ?? generatePassword();
        const u = await createUser(db, {
          username: need('username'),
          password,
          role,
          clientId: args.client ? Number(args.client) : null,
        });
        console.log(`Usuário ${u.username} (${u.role}) criado.${args.password ? '' : `\nSenha: ${password}`}`);
        break;
      }
      case 'set-password': {
        const password = args.password ?? generatePassword();
        await setPassword(db, need('username'), password);
        console.log(`Senha alterada; sessões abertas foram encerradas.${args.password ? '' : `\nNova senha: ${password}`}`);
        break;
      }
      default:
        console.log(HELP);
        process.exitCode = 1;
    }
  } finally {
    db.$client.close();
  }
}

main().catch((err: Error) => {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
});
