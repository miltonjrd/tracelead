# whatsapp-baileys proofs

**HEAD**: 797d0b0
**Tree**: clean
**Shell**: /bin/sh
**Result**: 32 pass, 0 fail

| Check | Proof | Result |
| --- | --- | --- |
| C1 | `run unit / ✔ painel mostra o qr code de um cliente baileys` | pass |
| C2 | `run unit / ✔ sessão aberta mostra conectado e o número` | pass |
| C3 | `run unit / ✔ qr novo substitui o anterior` | pass |
| C4 | `run unit / ✔ painel e admin mostram conectado` | pass |
| C5 | `run unit / ✔ desconectar apaga o login e mostra desconectado` | pass |
| C6 | `run unit / ✔ sexta conexão é recusada pelo limite` | pass |
| C7 | `run unit / ✔ loja não acessa a conexão de outro cliente` | pass |
| C8 | `run unit / ✔ mensagem baileys com ref liga ao clique` | pass |
| C9 | `run unit / ✔ mensagem baileys sem ref cria contato sem clique` | pass |
| C10 | `run unit / ✔ texto da mensagem baileys não é guardado` | pass |
| C11 | `run unit / ✔ ignora grupo, status e mensagem da própria loja` | pass |
| C12 | `run unit / ✔ ignora histórico (append)` | pass |
| C13 | `run unit / ✔ mensagem repetida gera um contato só` | pass |
| C14 | `run unit / ✔ lid sem telefone é ignorado e lid resolvido é aceito` | pass |
| C15 | `run unit / ✔ reinício reabre a sessão salva sem qr` | pass |
| C16 | `run unit / ✔ queda de rede reconecta com espera crescente até 60 s` | pass |
| C17 | `run unit / ✔ logout pelo celular apaga o login e não reconecta` | pass |
| C18 | `run unit / ✔ admin mostra cliente desconectado por logout` | pass |
| C19 | `run unit / ✔ falha ao reabrir um cliente não derruba os outros` | pass |
| C20 | `run unit / ✔ cliente cloud usa o webhook e não abre sessão` | pass |
| C21 | `run unit / ✔ webhook de cliente baileys é ignorado` | pass |
| C22 | `run unit / ✔ cli troca o modo do whatsapp` | pass |
| C23 | `run unit / ✔ cli recusa modo inválido` | pass |
| C24 | `run unit / ✔ admin só cobra segredos da meta de cliente cloud` | pass |
| C25 | `run unit / ✔ qr não escaneado em 2 minutos expira` | pass |
| C26 | `run unit / ✔ duas conexões da mesma loja usam um socket` | pass |
| C27 | `run unit / ✔ login salvo corrompido pede qr novo` | pass |
| C28 | `run unit / ✔ close 500 mantém o login e reconecta com espera` | pass |
| C29 | `run unit / ✔ depois do scan o close 515 reabre com o login salvo` | pass |
| C30 | `run unit / ✔ reinício acima do limite reabre só até o limite` | pass |
| Build | `npm run build` | pass |
| Build | `npm run typecheck` | pass |

## Output

`Run unit` - exit 0

```
✔ qr não escaneado em 2 minutos expira (19.25627ms)
✔ duas conexões da mesma loja usam um socket (10.187546ms)
✔ login salvo corrompido pede qr novo (11.888281ms)
✔ mensagem recebida na sessão vira contato e reconcile fecha cliente que saiu do modo baileys (13.992216ms)
✔ close 500 mantém o login e reconecta com espera (20.299215ms)
✔ reinício acima do limite reabre só até o limite (46.100279ms)
✔ tela de conexão mostra cada estado (1.647323ms)
ℹ tests 61
ℹ suites 0
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7801.769668
```
