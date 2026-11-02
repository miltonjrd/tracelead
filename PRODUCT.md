# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Cliente (dono ou atendente da loja):** usa o `/painel` no celular (instalável como app) ou no PC. Job: ver os contatos que chegaram do anúncio e marcar "Vendeu" + valor ou "Não comprou", rapidamente, no meio do atendimento. Conecta o WhatsApp escaneando um QR code.
- **Admin (gestor de tráfego):** usa o `/admin`, principalmente no desktop. Job: ler o relatório semanal, corrigir vendas, gerar os CSVs "Lead WhatsApp" e "Venda WhatsApp" para o Google Ads, acompanhar backup, conexão do WhatsApp e sincronização de gasto.

## Product Purpose
Ligar anúncio → conversa no WhatsApp → venda e devolver leads e vendas ao Google Ads como conversões offline, para o gestor otimizar campanhas por venda real e não só por clique. Sucesso: o cliente marca o resultado de cada contato com esforço mínimo e o gestor exporta conversões corretas.

## Positioning
Três coisas juntas que um concorrente teria dificuldade em copiar: (1) sem integração pesada, só um `t.js` no site e um QR code do WhatsApp, sem CRM nem Cloud API; (2) fecha o ciclo até a venda com valor, não só o lead; (3) simplicidade para a loja, que só toca em Vendeu/Não comprou.

## Operating Context
`t.js` guarda `gclid`/UTMs e acrescenta um ref curto à mensagem do WhatsApp. A conexão Baileys (QR) ou a Cloud API da Meta lê o ref e liga o telefone ao clique. Exportação manual de CSV para o Google Ads; gasto por campanha via API; backup diário. Stack: Node 22, Fastify, HTMX, SQLite (Drizzle), Caddy, Docker.

## Capabilities and Constraints
- O texto das conversas nunca é guardado; a interface não deve sugerir o contrário.
- Todo o texto da interface em português do Brasil.
- `/painel` é mobile-first, mas precisa funcionar bem no PC.
- Tema claro fixo (decisão recente, sem modo escuro).
- Server-rendered com HTMX, sem framework de front-end.

## Brand Commitments
Nome: TraceLead (renomeado de tracker no commit c7ef87b). Ícone em `public/icon.svg`. Fonte atual: Roboto (`@fontsource/roboto`), escolha deliberada do último commit.

## Evidence on Hand
Sem depoimentos, clientes de referência ou métricas públicas; não inventar.

## Product Principles
- A loja só decide uma coisa por contato: vendeu ou não; o resto é invisível para ela.
- Dados exportados ao Google Ads têm de ser corretos e auditáveis antes de serem rápidos.
- Privacidade por padrão: guardar o mínimo, nunca o conteúdo das conversas.
- O estado do sistema (conexão, backup, sincronização) deve ser legível de relance pelo gestor.

## Accessibility & Inclusion
Uso por lojistas em celular, muitas vezes com uma mão; alvos de toque generosos e texto legível. Sem padrão formal exigido.
