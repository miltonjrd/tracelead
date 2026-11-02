---
target: painel da loja
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-02T17-41-23Z
slug: src-views-panel-ts
---
# Critique /painel (src/views/panel.ts), terceira rodada: 26/40 Bom
Method: dual-agent. Especificidade 3/5. (Revisor mais rigoroso; P1 da rodada anterior resolvidos.)
P1: confirmação de sucesso fora da tela em listas longas (delight, harden)
P1: contatos abertos expiram em 7 dias sem aviso (clarify)
P1: texto do QR pressupõe segundo aparelho (onboard)
P2: Vendeu/Não comprou sem hierarquia, risco de toque errado (layout)
P2: estado vazio do primeiro uso incorreto (onboard)
Detector: 20 avisos em app.css (3 Roboto deliberado, 1 fallback mono, 16 font-size fora do DESIGN.md).
