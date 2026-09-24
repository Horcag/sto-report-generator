---
id: 9
title: Удаленный Microsoft renderer без локального Word
status: done
priority: medium
created: 2026-09-02T08:06:41.372913919+04:00
updated: 2026-09-24T20:18:37.652370242+04:00
started: 2026-09-24T20:18:37.655696403+04:00
completed: 2026-09-24T20:18:37.655696403+04:00
tags:
    - renderer
    - cloud
class: standard
---

Исследовать Microsoft Graph/OneDrive conversion и self-hosted Windows renderer. Зафиксировать гарантии, auth/privacy и отсутствие обещания pixel-identical без доказательства.

[[2026-09-24]] Thu 20:18
24.09.2026: исследованы Microsoft Graph v1.0 DOCX→PDF и self-hosted Windows Word. Контракт, permissions, privacy, гарантии и отсутствие доказанной desktop-identical пагинации описаны в docs/architecture/remote-microsoft-renderer.md. Сетевой renderer в CLI не добавлен: карточка была исследовательской.
