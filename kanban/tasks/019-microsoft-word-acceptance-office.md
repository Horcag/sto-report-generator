---
id: 19
title: Починить зависание локальной Microsoft Word acceptance после восстановления Office
status: done
priority: critical
created: 2026-09-22T06:46:52.097476538+04:00
updated: 2026-09-22T15:04:28.231743741+04:00
started: 2026-09-22T07:09:27.100138366+04:00
completed: 2026-09-22T15:04:28.151782551+04:00
tags:
    - word
    - acceptance
    - windows
    - renderer
class: standard
---

accept-word зависает внутри powershell/Word COM без manifest, accepted DOCX и PDF. Точный процесс текущего запуска остановлен после read-only проверки; прежняя сессия также фиксировала зависание на Repaginate/ExportAsFixedFormat и проблемы printer path. Нужно диагностировать поэтапно, не останавливать Word по имени, и получить реальный receipt.

[[2026-09-22]] Tue 07:54
PR #21: bounded stage/overall watchdog, atomic diagnostics receipt, exact PID ownership/cleanup, transactional outputs, CI receipt gate. Verification: format/lint/typecheck/test:coverage passed (80.52%); live run fails safely at preflight.license in ~13 s and leaves no Word process. Controlled COM diagnosis reached document.pdf-export and hung there.

[[2026-09-22]] Tue 15:04
Resolved by merged PR #22 (master 5317a20). Fresh local acceptance through npm run accept:word succeeded: status=accepted, completedMode=background, processCleanupVerified=true, 8 pages before/after reopen, valid 8-page PDF, DOCX/PDF SHA-256 values matched the manifest. Office activation still reports NOTIFICATIONS/0xC004F009, but capability verification succeeds and the warning is recorded without falsifying acceptance. PR #21 closed as superseded.
