---
name: TraceLead
description: Rastreio de vendas WhatsApp × Google Ads, com painel mobile-first para a loja e área admin para o gestor.
colors:
  canvas: "#f6f7f5"
  surface: "#ffffff"
  surface-tint: "#eef0ec"
  ink: "#1c1f1d"
  ink-muted: "#5f665f"
  hairline: "#dde1dc"
  control-line: "#7f867f"
  ledger-green: "#15803d"
  ledger-green-deep: "#116632"
  alarm-red: "#b42318"
  ok-wash: "#e6f4ea"
  ok-ink: "#14532d"
  warn-wash: "#fdf3dc"
  warn-ink: "#7a4a00"
  error-wash: "#fbe9e7"
  error-ink: "#8a1c12"
  info-wash: "#e8f0fb"
  info-ink: "#1d4380"
typography:
  title:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
    letterSpacing: "0.06em"
  figure:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    fontFeature: "'tnum'"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.ledger-green-deep}"
  button-secondary:
    backgroundColor: "{colors.surface-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 18px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.alarm-red}"
    rounded: "{rounded.md}"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  badge:
    backgroundColor: "{colors.surface-tint}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: TraceLead

## Overview

**Creative North Star: "O Caderno de Vendas"**

O TraceLead parece uma anotação de balcão bem feita: papel claro, linhas finas, um único verde que marca o que foi vendido. A loja abre o painel entre um atendimento e outro, decide uma coisa por contato (vendeu ou não; a etapa do funil, como Orçamento, é só organização) e fecha. O gestor lê tabelas e números sem ser distraído. A interface é um instrumento, não uma vitrine.

A densidade é média e a hierarquia vem de peso, cor de texto e linhas finas, não de sombras ou decoração. Os componentes são firmes e tocáveis: alvos de 44px, cantos suaves, foco evidente, pensados para uma mão no celular e igualmente corretos no PC. O verde é a marca própria do produto, não uma imitação da identidade do WhatsApp.

Rejeita o visual de dashboard SaaS genérico: sem gradientes, sem cartões de métrica gigantes, sem ornamento de "startup".

**Key Characteristics:**
- Tema claro fixo (`color-scheme: light`); não há modo escuro.
- Um único acento (verde), usado para ação primária e estado ativo.
- Superfícies brancas sobre canvas cinza-esverdeado, separadas por linha fina.
- Alvos de toque de 44px; versão `small` de 36px só para ações secundárias densas.
- Números sempre tabulares, alinhados à direita.

## Colors

Paleta de papel e tinta com um verde de caderno: neutros levemente esverdeados e um acento saturado e escuro.

### Primary
- **Verde de Caderno** (#15803d): botão primário, link, item ativo da navegação (barra de 3px), anel de foco (45% de opacidade), `theme-color` e fundo do ícone do app.
- **Verde Profundo** (#116632): hover do botão primário.

### Neutral
- **Canvas Esverdeado** (#f6f7f5): fundo da página.
- **Papel** (#ffffff): cartões, tabelas, campos, barra lateral.
- **Papel Sombreado** (#eef0ec): botão secundário, hover da navegação, contadores, selo neutro, blocos de código.
- **Tinta** (#1c1f1d): texto principal.
- **Tinta Apagada** (#5f665f): metadados, rótulos, cabeçalhos de tabela.
- **Linha Fina** (#dde1dc): bordas decorativas e divisores (cartões, tabelas).
- **Linha de Controle** (#7f867f): borda de campos e botões secundários; passa de 3:1 (WCAG 1.4.11).

### Semantic
- **Alarme** (#b42318): ação destrutiva (contorno e texto, nunca preenchido).
- **Ok** (fundo #e6f4ea, texto #14532d): venda registrada, anúncio, conectado.
- **Atenção** (fundo #fdf3dc, texto #7a4a00): pendências e avisos.
- **Erro** (fundo #fbe9e7, texto #8a1c12): falhas e mensagens de erro.
- **Info** (fundo #e8f0fb, texto #1d4380): origens não pagas (site, Maps, indicação).

### Named Rules
**A Regra do Verde Único.** O verde marca ação e estado ativo; nunca decoração. Se tudo é verde, nada é.
**A Regra do Par Fundo/Texto.** Cada cor semântica vem como par (fundo claro + texto escuro da mesma família); nunca texto semântico sobre branco para estados longos.

## Typography

**Font:** Roboto (400, 500, 700, auto-hospedada via @fontsource), com `system-ui` como reserva.

**Character:** Neutra e legível, escolhida de propósito para clareza em telas pequenas. A personalidade vem da disciplina de pesos, não do desenho da fonte.

### Hierarchy
- **Title** (700, 1.35rem, 1.25): título de página (`h1`).
- **Subtitle** (700, 1rem): título de cartão (`h3`) e marca na barra lateral (1.15rem).
- **Body** (400, 16px, 1.5): texto geral; 0.9rem para tabelas e 0.85rem para metadados.
- **Label** (600, 0.75–0.8rem, 0.05–0.06em, caixa alta): títulos de seção e cabeçalhos de tabela, em Tinta Apagada.
- **Figure** (700, 1.3rem, tabular): valores nos blocos de resumo.

### Named Rules
**A Regra dos Números Tabulares.** Todo valor monetário ou contagem usa `font-variant-numeric: tabular-nums` e alinha à direita em tabelas.

## Layout

Admin e painel compartilham uma casca de duas colunas: barra lateral fixa de 220px e conteúdo fluido com contêiner de até 960px. Telas sem usuário (login) usam coluna única centralizada de 380px.

Abaixo de 760px a casca vira bloco: a barra lateral passa a topo fixo, a navegação vira linha rolável horizontal sem barra e o item ativo é sublinhado (2px) em vez de marcado à esquerda. Grades usam `auto-fit` com mínimos (150px, 240px) em vez de breakpoints; os blocos de resumo passam de 2 para 3 colunas a partir de 720px.

Ritmo de espaçamento: 4, 8, 12, 16 e 28px. Cartões sucessivos separam-se por 12px; seções por 28px acima do título.

## Elevation & Depth

Plano por padrão, com uma exceção: o aviso fixo (toast) flutua sobre a página e por isso tem sombra própria (`0 4px 16px rgb(0 0 0 / 0.12)`). A profundidade vem de borda fina (1px Linha Fina) e contraste entre canvas e papel. Há uma única sombra ambiente (`0 1px 2px rgb(0 0 0 / 0.06)`), aplicada a cartões e à aba ativa do controle segmentado; nada flutua.

### Named Rules
**A Regra do Plano.** Superfícies não levantam em hover nem em repouso. Estado se comunica por cor, peso e anel de foco, não por sombra.

## Shapes

Cantos suaves e consistentes: 12px em cartões, tabelas e blocos; 10px em botões, campos e caixas de aviso; 8px em itens de navegação e blocos de código; pílula (999px) só para selos e contadores. Bordas de 1px; tracejada apenas em estados vazios.

## Components

### Buttons
- **Shape:** cantos de 10px, altura mínima de 44px (36px na versão pequena), peso 600.
- **Primary:** fundo Verde de Caderno, texto branco, padding 0 18px; hover escurece para Verde Profundo.
- **Secondary:** fundo Papel Sombreado, borda Linha Fina, texto Tinta.
- **Danger:** transparente com borda e texto Alarme.
- **Link:** sem fundo, sublinhado, cor primária.
- **Estados:** desabilitado a 45% de opacidade; durante requisição HTMX, 60% e sem cliques; foco com anel de 3px em verde a 45%, deslocado 2px.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Papel, borda Linha Fina, sombra ambiente.
- **Internal Padding:** 14px 16px.
- **Cartão de contato:** cabeçalho com nome e telefone, metadados em Tinta Apagada, depois grade de duas ações (Vendeu / Não comprou). "Vendeu" expande em linha inteira para pedir o valor.

### Inputs / Fields
- **Style:** fundo Papel, borda Linha Fina, 10px, altura mínima de 44px, padding 0 12px.
- **Focus:** mesmo anel verde de 3px dos botões.
- **Rótulos:** acima do campo, 0.85–0.9rem, Tinta Apagada.

### Badges
- Pílula pequena (0.75rem, 600). Neutro por padrão; variantes Ok, Atenção, Erro e Info seguem o par fundo/texto.

### Navigation
- **Desktop:** lista vertical na barra lateral; item em Tinta Apagada, hover em Papel Sombreado, ativo em Papel Sombreado com peso 500 e barra interna de 3px em verde à esquerda. Rodapé da barra com usuário e "Sair".
- **Mobile:** linha horizontal rolável; ativo sublinhado em verde.

### Tables
- Dentro de contêiner com borda e canto de 12px, rolagem horizontal. Cabeçalho em rótulo caixa alta; linhas separadas por Linha Fina; colunas numéricas à direita e tabulares.

### Connection Chip
- Pílula de 36px no cabeçalho do painel: verde "WhatsApp conectado", âmbar enquanto conecta, vermelha "WhatsApp desconectado". Sempre é link para a tela de conexão; desconectado também mostra um aviso `role="alert"` e o vazio manda conectar.

### Aviso de Marcação (toast)
- Região `aria-live` fixa na base da tela, visível de qualquer ponto da lista. Anuncia o resultado ("Venda de R$ 150,00 registrada."), traz "Desfazer" para Vendeu e Não comprou, recebe o foco e some sozinha em 8s (erros ficam). O cartão marcado entra na lista nova com uma única animação de 480ms (ease-out exponencial, desligada com `prefers-reduced-motion`).

### Caderno do dia (Marcados hoje)
- Lista em linhas pautadas dentro de um contêiner de 12px: nome à esquerda, resultado em algarismos tabulares à direita ("Vendeu R$ 150,00" ou "Não comprou") e "Desfazer". Fecha com uma linha dupla (3px double, #7f867f) e "Total do dia · N vendas" com o valor. Contatos pendentes continuam sendo cartões; só os resolvidos viram linhas.

### Filtro de período
- Na barra de busca, "De / até" (dois `input type="date"`, nunca futuros) e, abaixo, os atalhos Hoje · Ontem · 7 dias · 30 dias no mesmo estilo do segmented control. O corte é pela data do primeiro contato — a mesma que ordena as listas.
- Com período ativo, as três listas passam a mostrar aquele intervalo em vez da janela de 7 dias e do dia corrente: "Marcados hoje" vira "Marcados", "Total do dia" vira "Total do período", e uma linha sob o título explica o corte com "Voltar para hoje". Busca, origem e paginação continuam valendo dentro do período.

### Funil
- Cada contato em aberto tem um seletor de etapa (coluna "Etapa") e a busca ganha o filtro "Todas as etapas". As etapas são da loja e se gerenciam em `/painel/funil`; "Orçamento" já vem criada e substituiu o antigo botão e a lista de Orçamentos. A etapa aparece como pílula no caderno do dia.

### Aviso de expiração
- Contatos abertos a menos de 2 dias de sair da janela de 7 dias mostram "Sai da lista em N dias" (ou "hoje") em âmbar no cartão. A janela conta do que for mais recente — a última mensagem ou a última marcação.

### Marca
- Ícone do app (24px) ao lado do nome TraceLead na barra lateral e no login.

### Estado pendente e falha
- Botões de envio viram "Salvando…" e ficam desabilitados durante a requisição. Se ela falhar, o texto volta e o aviso mostra, em vermelho e com `role="alert"`, "Não deu para salvar. Confira a conexão e toque de novo."

### Origem do contato
- Recolhida num `<details>` com resumo "Alterar origem (atual)"; o seletor só aparece ao abrir. O cartão mantém uma decisão principal: Vendeu / Não comprou.

### Segmented Control
- Trilho Papel Sombreado de 10px com 3px de respiro; opção ativa em Papel com sombra ambiente e peso 600.

### QR Code (peça própria)
- Cartão branco centralizado de até 280px com o QR sempre escuro sobre claro (`#fff`), nunca invertido.

## Do's and Don'ts

### Do:
- **Do** manter o tema claro fixo e `color-scheme: light`.
- **Do** usar o verde (#15803d) só para ação primária e estado ativo.
- **Do** garantir 44px de altura em todo alvo de toque primário.
- **Do** separar superfícies com borda de 1px (#dde1dc) e usar #7f867f em bordas de controles antes de pensar em sombra.
- **Do** escrever todo texto de interface em português do Brasil.
- **Do** alinhar números à direita e em algarismos tabulares.

### Don't:
- **Don't** usar gradientes, cartões de métrica gigantes ou ornamento de dashboard SaaS genérico.
- **Don't** copiar a identidade visual do WhatsApp; o verde é da marca TraceLead.
- **Don't** sugerir, com ícones ou rótulos, que o conteúdo das conversas é guardado.
- **Don't** usar sombras de elevação ou hover que levantem superfícies; a única exceção é o toast fixo.
- **Don't** preencher o botão destrutivo em vermelho; ele fica em contorno.
- **Don't** criar modo escuro nem alternância de tema.
