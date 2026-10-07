# API — как подготовить миграцию

Правило из корневого `CLAUDE.md`: любое изменение `prisma/schema.prisma` сопровождается новой
папкой в `prisma/migrations/`.

Локальная база создана `db push`, поэтому миграцию готовить через diff с теневой базой:

```
docker exec flowdesk-pg psql -U flowdesk -c "CREATE DATABASE flowdesk_shadow"
cd apps/api
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://flowdesk:flowdesk@localhost:5433/flowdesk_shadow --script
docker exec flowdesk-pg psql -U flowdesk -c "DROP DATABASE flowdesk_shadow"
```

Вывод положить в `prisma/migrations/<дата>_<название>/migration.sql`, затем
`npx prisma db push` (или `migrate deploy`) и `npx prisma generate`; dev-сервер API
перезапустить.
