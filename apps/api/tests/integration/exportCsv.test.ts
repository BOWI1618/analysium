import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createIssue, createProject, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';

let app: FastifyInstance;
let owner: TestUser;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Выгрузка Табличная', workspaceName: 'Таблицы' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('выгрузка задач в таблицу', () => {
  it('отдаёт CSV для Excel: метка кодировки, «;», подзадачи с родителем, формулы остаются текстом', async () => {
    const project = await createProject(app, owner, { key: 'TBL' });
    const parent = await createIssue(app, owner, project.id, {
      title: 'Отчёт; квартал',
      dueDate: '2026-09-30T12:00:00.000Z',
    });
    await createIssue(app, owner, project.id, { title: 'Собрать цифры', type: 'SUBTASK', parentId: parent.id });
    await createIssue(app, owner, project.id, { title: '=СУММ(1;2)' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues/export`,
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(encodeURIComponent('TBL-задачи-'));

    const body = response.body;
    expect(body.startsWith('﻿')).toBe(true);
    const lines = body.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'Ключ;Задача;Родительская задача;Тип;Статус;Приоритет;Исполнитель;Автор;Метки;Эпик;Начало;Срок;Создана;Завершена',
    );
    expect(lines).toHaveLength(4);

    const row = (key: string) => lines.find((line) => line.startsWith(`${key};`))!;
    expect(row(parent.issueKey)).toContain('"Отчёт; квартал"');
    expect(row(parent.issueKey)).toContain(';30.09.2026;');
    expect(row(`${parent.issueKey}.1`)).toContain(`Собрать цифры;${parent.issueKey};Подзадача`);
    expect(body).toContain(`"'=СУММ(1;2)"`);
  });

  it('чужой проект не выгружается', async () => {
    const project = await createProject(app, owner, { key: 'OWN' });
    const stranger = await registerUser(app, { name: 'Посторонний' });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues/export`,
      headers: { cookie: stranger.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
