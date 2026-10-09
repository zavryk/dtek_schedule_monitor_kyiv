# 🪫 DTEK schedule monitor

Перевірка **екстрених/аварійних** відключень на сайтах ДТЕК КЕМ (Київ) і ДТЕК КРЕМ (область)
для кількох адрес одним запуском. Основа — [mr-devboy/dtek-monitor](https://github.com/mr-devboy/dtek-monitor) (MIT).

Репозиторій лише збирає дані — Telegram-сповіщення шле окремий сервер.

## Як працює

```
сервер (раз на 5 хв)                         GitHub Actions
 dtek_emergency.py ── workflow_dispatch ──▶  розшифрувати адреси (TARGETS_KEY)
   шифрує адреси       inputs.targets        Chromium -> сайти ДТЕК
                                             artifact "result" (result.json)
   забирає artifact ◀────────────────────────┘
   шле нові/змінені відключення в Telegram
```

- Адреси приходять у `inputs.targets`, зашифровані `openssl enc -aes-256-cbc -pbkdf2 -a -A`;
  ключ — секрет `TARGETS_KEY`. У логах публічного репо видно лише шифротекст.
- `result.json` містить тільки `id` адрес, без самих адрес:

```json
{
  "checked_at": "2026-10-09T09:34:54.817Z",
  "targets": {
    "home": { "ok": true, "site": "kem", "emergency": null, "update_timestamp": "12:30 09.10.2026" },
    "dacha": {
      "ok": true, "site": "krem",
      "emergency": { "sub_type": "Аварійні ремонтні роботи", "start_date": "10:43 09.10.2026", "end_date": "14:44 09.10.2026" },
      "update_timestamp": "12:30 09.10.2026"
    }
  }
}
```

## Формат адрес

```json
[{ "id": "home", "site": "kem", "street": "вул. Приклад", "house": "1" },
 { "id": "dacha", "site": "krem", "city": "м. Приклад", "street": "вул. Приклад", "house": "2А" }]
```

`site`: `kem` — Київ, `krem` — Київська область. `city`, `street`, `house` — точно як на сайті ДТЕК.

## Локально

```sh
npm ci && npx playwright install chromium
TARGETS='[...]' node src/monitor.js   # результат у artifacts/result.json
```
