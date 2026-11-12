# TraceLead — vendas do WhatsApp × Google Ads

Liga **anúncio → conversa no WhatsApp → venda** e devolve leads e vendas ao Google Ads como conversões offline.

- `t.js` no site do cliente guarda o `gclid`/UTMs e, no clique do botão de WhatsApp, acrescenta um ref curto à mensagem (`(ref. 4F7KX)`).
- A conexão com o WhatsApp lê o ref e liga o telefone ao clique: por padrão a loja escaneia um QR code (Baileys); a Cloud API da Meta continua disponível como modo alternativo. O texto das conversas não é guardado.
- O cliente marca "Vendeu" + valor ou "Não comprou" no painel (`/painel`, instalável como app no celular). "Orçamento" guarda numa lista separada quem já recebeu proposta e ainda vai decidir. O filtro "De / até" (ou os atalhos Ontem · 7 dias · 30 dias) mostra os contatos de dias anteriores, pela data do primeiro contato.
- O admin (`/admin`) vê o relatório semanal, corrige vendas, gera os CSVs "Lead WhatsApp" e "Venda WhatsApp" e acompanha backup e sincronização de gasto.

Stack: Node 22+ · Fastify · HTMX · SQLite (Drizzle ORM) · Caddy · Docker Compose.

## Rodar localmente

```bash
npm install
cp .env.example .env          # para testar local, só IP_HASH_SECRET já basta
npm run cli -- create-client --name "Cliente Teste"
npm run cli -- create-user --username admin --role admin
npm run cli -- create-user --username loja --role client --client 1
npm run dev                    # http://localhost:3000
npm test
```

## Deploy na VPS (Locaweb)

1. **DNS:** registro A `track.seudominio.com.br` → IP da VPS.
2. **VPS:** instale Docker e o plugin Compose; libere as portas 80 e 443.
3. **Código e configuração:**
   ```bash
   git clone <repo> tracelead && cd tracelead
   cp .env.example .env && nano .env    # TRACK_DOMAIN, BASE_URL, IP_HASH_SECRET (openssl rand -hex 32)
   docker compose up -d --build
   ```
   O Caddy emite o certificado HTTPS sozinho na primeira requisição.
4. **Cliente e usuários** (dentro do container, a CLI é `node dist/cli.js`):
   ```bash
   docker compose exec app node dist/cli.js create-client --name "Nome do cliente"
   docker compose exec app node dist/cli.js create-user --username admin --role admin
   docker compose exec app node dist/cli.js create-user --username loja --role client --client 1
   ```
   Sem `--password`, a senha é gerada e mostrada uma vez. Para trocar: `set-password --username loja`.
5. **Monitoramento:** no UptimeRobot, crie um monitor HTTP(S) para `https://track.seudominio.com.br/health` a cada 5 minutos.

Atualizar: `git pull && docker compose up -d --build` (as migrações do banco rodam sozinhas na inicialização).

## WhatsApp

Cada cliente tem um modo de conexão (`clients.whatsapp_mode`). O padrão para clientes novos é `baileys`.

### Baileys (padrão): a loja escaneia um QR code

1. A loja entra no painel e abre **WhatsApp** (`/painel/whatsapp`), ao lado do título da lista de contatos.
2. Toca em **Conectar WhatsApp**, e no celular vai em *WhatsApp → Aparelhos conectados → Conectar um aparelho* e aponta a câmera para o QR. O QR vale por 2 minutos; depois aparece **Gerar novo QR**.
3. Pronto: o painel mostra **Conectado** e o número. A conexão volta sozinha depois de um deploy ou queda de rede. Se a loja remover o aparelho pelo celular, aparece **Desconectado** e é preciso escanear de novo.
4. O gestor vê o estado em Admin → Sistema e pode **Desconectar**.

O TraceLead só recebe mensagens: não envia nada, não aparece como online e ignora grupos, status e conversas antigas.

`BAILEYS_MAX_SESSIONS` (padrão 5) limita quantas lojas ficam conectadas ao mesmo tempo no processo.

**Atenção:**
- O Baileys é uma biblioteca **não oficial** (simula o WhatsApp Web) e usa a versão `7.0.0-rc14`, ainda candidata a lançamento. O WhatsApp pode mudar o protocolo e derrubar as conexões até a biblioteca ser atualizada, e o uso não oficial pode levar ao **banimento do número da loja**.
- O login do WhatsApp fica na tabela `whatsapp_auth` do banco, então **quem tiver uma cópia do banco ou do backup pode se passar pelo aparelho conectado**. Trate o backup como segredo.
- A dependência `libsignal` do Baileys é GPL-3.0. O app roda só na sua VPS e não é distribuído; se isso mudar, peça uma revisão jurídica.
- O mapeamento entre o ID interno (LID) e o telefone vem do próprio WhatsApp. Se uma mensagem chegar sem telefone resolvido, ela é ignorada e o log registra `lid-sem-telefone`.

### Cloud API da Meta (modo `cloud`, desligado por padrão)

Para um cliente usar a Cloud API: `docker compose exec app node dist/cli.js update-client --id 1 --whatsapp-mode cloud` (a sessão Baileys dele é encerrada em até 1 minuto). Clientes que já tinham Phone number ID viraram `cloud` na migração. Depois:

1. Em developers.facebook.com, crie um app do tipo Business com o produto WhatsApp e conecte o número do cliente pelo fluxo de **coexistência** (o número continua no app WhatsApp Business).
2. Em WhatsApp → Configuração → Webhook:
   - URL de callback: `https://track.seudominio.com.br/webhook`
   - Verify token: o mesmo valor de `META_VERIFY_TOKEN` no `.env`
   - Assine o campo **messages**.
3. Copie o **App secret** (Configurações → Básico) para `META_APP_SECRET`.
4. Copie o **Phone number ID** do número e cadastre:
   `docker compose exec app node dist/cli.js update-client --id 1 --phone-number-id <ID>`
5. `docker compose up -d` para recarregar o `.env`. Em Admin → Sistema aparece o que está faltando.

O webhook só processa clientes em modo `cloud`; para voltar ao QR: `update-client --id 1 --whatsapp-mode baileys`.

## Google Ads

**Conversões (upload manual no MVP):**
1. Em Metas → Conversões, crie duas ações do tipo *Importação → cliques de anúncios*: **Lead WhatsApp** (sem valor) e **Venda WhatsApp** (com valor). Os nomes precisam ser iguais a `CONVERSION_NAME_LEAD` e `CONVERSION_NAME_VENDA`.
2. Em Admin → Exportações, gere o arquivo, baixe, envie em Conversões → Uploads e marque como importado.
3. Antes do primeiro envio, compare o CSV com o modelo que o próprio Google Ads oferece para download (colunas e formato de data e fuso).

**Gasto por campanha (API):**
1. Na sua conta de administrador (MCC), em Ferramentas → Central da API, peça o **developer token** com acesso a contas reais. A aprovação pode levar dias.
2. No Google Cloud Console, ative a Google Ads API e crie um **ID do cliente OAuth do tipo "App para computador"**. Copie o ID e o secret para `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`.
3. Na sua máquina (precisa de navegador): `npm run cli -- google-auth`. Copie o `GOOGLE_ADS_REFRESH_TOKEN` gerado para o `.env` da VPS.
4. `GOOGLE_ADS_LOGIN_CUSTOMER_ID` = ID da MCC (se você acessa a conta do cliente por ela).
5. Cadastre o ID da conta do cliente: `update-client --id 1 --ads-customer-id 123-456-7890`.
6. Em Admin → Sistema, use "Sincronizar agora" para testar. Depois roda sozinho todo dia às 6h e relê os últimos 7 dias. Também liga cada `gclid` à campanha (via `click_view`), o que dá a campanha certa no relatório mesmo sem UTM.

A versão da API fica em `GOOGLE_ADS_API_VERSION` (padrão `v25`); o Google desliga versões antigas cerca de um ano após o lançamento.

## Site do cliente

Copie o snippet de Admin → Sistema e cole antes do `</body>` em todas as páginas:

```html
<script src="https://track.seudominio.com.br/t.js" data-client="CHAVE_DO_CLIENTE" async></script>
```

Os links existentes para `wa.me` e `api.whatsapp.com` passam a ser rastreados sozinhos. O texto já presente no link é mantido; se não houver, entra a mensagem padrão (mude com `data-message="..."`).

## Backup

Todo dia às 3h é gravada uma cópia em `/app/data/backups` (volume `app_data`), mantendo as últimas `BACKUP_KEEP`. Para mandar para fora da VPS, configure um remote do rclone por variáveis no `.env` (exemplo no `.env.example`) e `RCLONE_REMOTE`.

Restaurar: pare o app, troque `/app/data/tracker.db` pelo arquivo de backup e suba de novo.

## Postgres no futuro

O schema (`src/db/schema.ts`) usa só tipos portáveis: PKs explícitas, timestamps em epoch ms e `client_id` em todas as tabelas. Para migrar, reescreva o schema com `drizzle-orm/pg-core` (timestamps como `bigint`), troque o driver em `src/db/client.ts` e copie os dados. As consultas já usam `await`. Os poucos blocos `db.transaction` síncronos (específicos do SQLite) viram `async`.
