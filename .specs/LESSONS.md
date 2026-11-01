# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - When a library maps an unknown error to a generic code (Baileys: 500), read its source before treating that code as a permanent state like logout; wiping credentials needs a code that only means that.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `src/services` · harmful: 0
- features: whatsapp-baileys
- evidence: C17 / whatsappSessions.ts (src/services)
- last seen: 2026-11-01T00:54:49Z

### L-002 - A test for a resolution order must make the lower-priority source return a different value and assert it was not asked; a source that returns null passes under any order.
- signal: `weak_test` · recurrence: 1 feature(s) · scope: `test` · harmful: 0
- features: whatsapp-baileys
- evidence: C14 (test)
- last seen: 2026-11-01T00:54:49Z

### L-003 - A rule built in a task (limit on startup, restart-required reopen) that no criterion names has no check; append a criterion with an ID and a check when you add the rule.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: whatsapp-baileys
- evidence: tasks.md C28-C30 (spec)
- last seen: 2026-11-01T00:54:49Z

### L-004 - Test a time-window limit at the exact boundary and one millisecond past it, not only a day on each side.
- signal: `weak_test` · recurrence: 1 feature(s) · scope: `exports` · harmful: 0
- features: export-braid
- evidence: verification.md C7 (exportBraid.test.ts) (exports)
- last seen: 2026-11-01T01:42:40Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
