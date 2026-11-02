---
target: painel da loja
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-02T16-45-55Z
slug: src-views-panel-ts
---
# Critique /painel (src/views/panel.ts) — 22/40 Aceitável
Method: dual-agent. Especificidade: genérico 2/5.
P1: marcar não move o cartão nem atualiza a contagem (harden, animate)
P1: saúde da conexão do WhatsApp escondida (clarify, onboard)
P1: contraste de borda dos controles ~1.3:1 e foco inconsistente (audit, harden)
P2: formulário de venda sem Cancelar/R$/foco; valor perdido em erro (clarify, polish)
P2: identidade genérica, hierarquia plana (distill, layout, bolder)
Detector: 18 avisos em app.css (3 Roboto deliberado, 1 fallback mono, 14 font-size fora do DESIGN.md).
