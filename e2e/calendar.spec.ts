import { expect, test, type Page } from '@playwright/test';

/**
 * The project calendar: a week of day columns, a day by the hour, a month.
 * Tasks move between days by dragging, get a time from the hour they are
 * created at, and close with the checkbox on the card.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const wholeDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Date(`${ymd(d)}T12:00:00.000Z`).toISOString();
};

async function setup(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill('Календарь Командный');
  await page.getByLabel('Рабочая почта').fill(`calendar-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByLabel('Название пространства').fill('Календарь');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Календарь', { timeout: 20_000 });
  const workspaceId = (await (await page.request.get('/api/v1/auth/session')).json()).workspaces[0].id;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, { data: { name: 'Планы', projectType: 'KANBAN' } })
  ).json();
  return project.id as string;
}

test.describe('календарь', () => {
  test('неделя: задача переносится на другой день и закрывается галочкой', async ({ page }) => {
    const projectId = await setup(page);
    // Monday of this week and the day after, so both columns are in the week on screen.
    const created = await page.request.post('/api/v1/issues', {
      data: { projectId, title: 'Сверить акты', dueDate: wholeDay(0) },
    });
    const issue = await created.json();
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Опорная задача', dueDate: wholeDay(new Date().getDay() === 0 ? -1 : 1) } });

    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'Неделя' }).click();
    const card = page.getByRole('button', { name: /Сверить акты/ });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.dragTo(page.getByRole('button', { name: /Опорная задача/ }));
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).dueDate, { timeout: 15_000 })
      .not.toBe(issue.dueDate);

    await page.getByRole('button', { name: `Отметить выполненной ${issue.issueKey}` }).click();
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).status.category, { timeout: 15_000 })
      .toBe('COMPLETED');
  });

  test('день по часам: клик по часу создаёт задачу с этим временем', async ({ page }) => {
    const projectId = await setup(page);
    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'День' }).click();
    await page.getByRole('button', { name: 'Следующий' }).or(page.getByRole('button', { name: 'Вперёд' })).first().click();

    // 09:00 on the hour grid: the grid opens at the start of the working day.
    const grid = page.locator('.cursor-cell').first();
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid.click({ position: { x: 200, y: 9 * 56 + 10 } });

    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(dialog.getByLabel('Срок: время')).toHaveValue('10:00');
    await dialog.getByLabel('Название задачи').fill('Планёрка');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();

    const block = page.getByRole('button', { name: /Планёрка, 09:00–10:00/ });
    await expect(block).toBeVisible({ timeout: 15_000 });
    const box = await block.boundingBox();
    expect(Math.round(box!.height / 10)).toBe(Math.round((56 - 2) / 10));
  });

  test('без срока: задачу из панели можно поставить на час', async ({ page }) => {
    const projectId = await setup(page);
    const issue = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Разобрать почту' } })).json();

    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'День' }).click();
    await page.getByRole('button', { name: 'Вперёд' }).click();
    await page.getByRole('button', { name: 'Без срока' }).click();
    const panel = page.getByRole('complementary', { name: 'Задачи без срока' });
    const card = panel.getByRole('button', { name: /Разобрать почту/ });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.dragTo(page.locator('.cursor-cell').first(), { targetPosition: { x: 200, y: 14 * 56 + 5 } });
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).startHasTime, { timeout: 15_000 })
      .toBe(true);
    const placed = await (await page.request.get(`/api/v1/issues/${issue.id}`)).json();
    expect(new Date(placed.startDate).getHours()).toBe(14);
    expect(new Date(placed.dueDate).getHours()).toBe(15);
    await expect(panel.getByRole('button', { name: /Разобрать почту/ })).toHaveCount(0);
  });
});
