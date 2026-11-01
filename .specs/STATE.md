# State

## Decisions

### AD-001
- **Decision**: Every WhatsApp message source enters through `handleInboundMessage`; `clients.whatsapp_mode` (`baileys` | `cloud`) picks the source per client, and Baileys runs in-process with its auth state in SQLite.
- **Reason**: 1 to 5 stores, single-process app with SQLite; a separate worker or Evolution/WAHA would bring back the setup the feature removes.
- **Trade-off**: A Baileys failure shares the HTTP process; moving to a worker later means extracting `WhatsAppSessions`.
- **Scope**: whatsapp-baileys and any future WhatsApp source.
- **Date**: 2026-10-31
- **Status**: active

## Handoff
