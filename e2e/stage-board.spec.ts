import { expect, test, type Page } from '@playwright/test';

/**
 * Kanban by stage on «Мои задачи» and «Задачи сотрудника»: tasks from every
 * project laid out by stage, a card dropped into a stage takes that stage's
 * status in its own project.
 */

test.describe.configure({ timeout: 120_000 });

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Логин', { exact: true }).fill(`e2e-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByLabel('Название пространства').fill('Команда E2E');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, { timeout: 20_000 });
}

test('канбан по стадиям в «Моих задачах» и «Задачах сотрудника», перенос карточки меняет статус', async ({ page }) => {
  await register(page, 'Канбан Стадий');
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const workspaceId = session.workspaces[0].id;
  const me = session.user.id;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, { data: { name: 'Канбан проект' } })
  ).json();
  // A new project's backlog column is orange.
  expect(project.statuses.find((s: { category: string }) => s.category === 'BACKLOG').color).toBe('#d97706');

  const issue = await (
    await page.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Карточка для переноса', assigneeId: me } })
  ).json();

  await page.goto('/my-work');
  await page.getByRole('radio', { name: 'Канбан' }).click();
  const todo = page.getByRole('region', { name: 'Колонка «К выполнению»' });
  const inWork = page.getByRole('region', { name: 'Колонка «В работе»' });
  await expect(todo.getByText('Карточка для переноса')).toBeVisible({ timeout: 15_000 });
  await expect(todo.getByText('Канбан проект')).toBeVisible();

  const card = (await todo.getByText('Карточка для переноса').boundingBox())!;
  const target = (await inWork.boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 10 });
  await page.mouse.up();

  await expect(inWork.getByText('Карточка для переноса')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).status.category, { timeout: 15_000 })
    .toBe('STARTED');

  // «Задачи сотрудника» has the same board.
  await page.goto('/employee-work');
  await page.getByRole('radio', { name: 'Канбан' }).click();
  await expect(page.getByRole('region', { name: 'Колонка «В работе»' }).getByText('Карточка для переноса')).toBeVisible({ timeout: 15_000 });
});
