# Analysium — заметки для работы в проекте

Русскоязычный таск-трекер. Монорепозиторий npm workspaces:
`packages/contracts` (zod-схемы, DTO, права), `apps/api` (Fastify + Prisma + Postgres),
`apps/web` (React + Vite + Tailwind v4), `e2e` (Playwright). Подробности — в README.md,
выкладка — в DEPLOY.md.

## Правила от владельца

- Не делать лишних изменений: только то, о чём попросили.
- Визуальный стиль сохранять (палитра «Алабуги», рамки 2px, сплошные тени). Новые экраны —
  из существующих компонентов `apps/web/src/ui` и `apps/web/src/components`.
- Весь текст интерфейса — на русском, без англицизмов.
- Политику обработки данных не добавлять. Команда — 5 человек.
- Готовую работу коммитить и пушить в `main`. Точки сохранения (теги) — только по просьбе.
- Ориентир по механике — Weeek (weeek.net): как там работает, но в нашем оформлении.

## Разработка

```
npm install
npm run setup      # apps/api/.env, Postgres в Docker (порт 5433), схема и демо-данные
npm run dev        # web :5173, api :4000
```

Демо-вход: `alex@acme.test` / `demo1234`.

Проверки перед коммитом:

```
npm run typecheck
npm test                      # API, нужен запущенный Postgres
npx playwright test           # e2e; серверы поднимет сам, при уже запущенном npm run dev — с E2E_NO_SERVER=1
npm run build
```

Регистрация ограничена по частоте: если e2e падают на регистрации после нескольких прогонов
подряд, подождать 5 минут.

## Изменения схемы БД

Продакшен применяет файлы миграций (`prisma migrate deploy` при старте контейнера), поэтому
любое изменение `apps/api/prisma/schema.prisma` должно сопровождаться новой папкой в
`apps/api/prisma/migrations/`. Локальная база создана `db push`, поэтому миграцию готовить
через diff с теневой базой:

```
docker exec flowdesk-pg psql -U flowdesk -c "CREATE DATABASE flowdesk_shadow"
cd apps/api
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://flowdesk:flowdesk@localhost:5433/flowdesk_shadow --script
docker exec flowdesk-pg psql -U flowdesk -c "DROP DATABASE flowdesk_shadow"
```

Вывод положить в `prisma/migrations/<дата>_<название>/migration.sql`, затем
`npx prisma db push` (или `migrate deploy`) и `npx prisma generate`; dev-сервер API
перезапустить.

## Соглашения в коде

- Даты без времени хранятся полднем UTC (`YYYY-MM-DDT12:00:00.000Z`), флаги
  `startHasTime` / `dueHasTime` отмечают точное время.
- Булевы параметры запросов — через `queryBoolean` в contracts (не `z.coerce.boolean`).
- Подзадачи — один уровень, номер от родителя (`WEB-4.1`).
- Комментарии в коде — на английском, объясняют «почему».
- Тесты API — `apps/api/tests/integration`, e2e — `e2e/*.spec.ts`, названия на русском.

## Выкладка

На сервере: `cd ~/analysium && git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
