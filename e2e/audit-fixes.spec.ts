import { expect, test, type Page } from '@playwright/test';

/**
 * Regressions from the usability review of 7 October: what the form shows is
 * what it saves, a selection never outlives the rows it was made on, a filter
 * survives a change of view, and a sprint can be filled from the backlog.
 */

const password = 'password123';
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Рабочая почта').fill(`e2e-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Название пространства').fill('Команда E2E');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, { timeout: 20_000 });
}

/** A project made through the API: these scenarios are about what happens inside one. */
async function createProject(page: Page, name: string, projectType = 'KANBAN'): Promise<string> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const response = await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
    data: { name, key: `P${unique().slice(-4).toUpperCase()}`, projectType },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

test.describe('форма новой задачи', () => {
  test('показывает тот статус, с которым задача будет создана', async ({ page }) => {
    await register(page, 'Проверяющий Статусы');
    const projectId = await createProject(page, 'Статусы по умолчанию');
    await page.goto(`/projects/${projectId}/list`);
    // The page knows its project once the project has loaded; only then does «Создать» open the form for it.
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });

    // Opened inside a project, the form shows its default status — the second
    // column — and not the first one, which it used to show and then not save.
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(form.getByRole('button', { name: 'К выполнению' })).toBeVisible({ timeout: 15_000 });
    await expect(form.getByRole('button', { name: 'Бэклог' })).toHaveCount(0);
    await form.getByLabel('Название задачи').fill('Статус как на экране');
    await form.getByRole('button', { name: 'Создать и открыть' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Изменить статус' })).toContainText('К выполнению', { timeout: 15_000 });
    await page.keyboard.press('Escape');

    // A status picked by hand is saved just the same.
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    await form.getByRole('button', { name: 'К выполнению' }).click();
    await page.getByRole('menuitem', { name: 'Бэклог' }).click();
    await form.getByLabel('Название задачи').fill('Статус выбран руками');
    await form.getByRole('button', { name: 'Создать и открыть' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Изменить статус' })).toContainText('Бэклог', { timeout: 15_000 });
  });
});

test.describe('список проекта', () => {
  test('выделение уходит вместе со строкой, а фильтр переходит на доску', async ({ page }) => {
    await register(page, 'Проверяющий Список');
    const projectId = await createProject(page, 'Выделение и фильтр');
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Особая задача' } });
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Обычная работа' } });

    await page.goto(`/projects/${projectId}/list`);
    const row = (title: string) => page.getByRole('row').filter({ hasText: title });
    await expect(row('Особая задача')).toBeVisible({ timeout: 15_000 });
    await row('Особая задача').getByRole('checkbox').check();
    const bar = page.getByRole('region', { name: 'Массовые действия' });
    await expect(bar).toContainText('Выбрано: 1');

    // A filter that hides the selected task takes it out of the selection:
    // the bar used to keep offering to change «Выбрано: 1» over an empty list.
    const filter = page.getByLabel('Фильтровать задачи');
    await filter.fill('такого-названия-нет');
    await expect(row('Особая задача')).toHaveCount(0, { timeout: 15_000 });
    await expect(bar).toBeHidden();

    // The filter goes along to another view of the same project.
    await filter.fill('Особая');
    await expect(row('Особая задача')).toBeVisible({ timeout: 15_000 });
    await expect(row('Обычная работа')).toHaveCount(0);
    await page.getByRole('link', { name: 'Доска' }).click();
    await expect(page).toHaveURL(/\/board\?.*search=/);
    await expect(page.getByText('Особая задача')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Обычная работа')).toHaveCount(0);
  });
});

test.describe('спринты', () => {
  test('задачи переносятся в спринт выбором, а стрелки в поле даты не уводят из него', async ({ page }) => {
    await register(page, 'Проверяющий Спринты');
    const projectId = await createProject(page, 'Наполнение спринта', 'SCRUM');
    const sprint = await page.request.post(`/api/v1/projects/${projectId}/sprints`, { data: { name: 'Спринт для переноса' } });
    expect(sprint.status()).toBe(201);
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Первая в спринт' } });
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Вторая в спринт' } });
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Остаётся в бэклоге' } });

    await page.goto(`/projects/${projectId}/backlog`);
    const row = (title: string) => page.getByRole('row').filter({ hasText: title });
    await expect(row('Первая в спринт')).toBeVisible({ timeout: 15_000 });
    // The empty sprint says how to fill it, and no longer promises dragging.
    await expect(page.getByText(/перенесите их сюда кнопкой «Спринт»/)).toBeVisible();
    await row('Первая в спринт').getByRole('checkbox').check();
    await row('Вторая в спринт').getByRole('checkbox').check();
    const bar = page.getByRole('region', { name: 'Массовые действия' });
    await expect(bar).toContainText('Выбрано: 2');

    // In the date field of the bar the arrows belong to the date: they used
    // to jump out of the field to the menu item below it.
    await bar.getByRole('button', { name: 'Срок' }).click();
    const due = page.getByLabel('Новый срок');
    await due.click();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(due).toBeFocused();
    await page.keyboard.press('Escape');

    // Two tasks into the sprint in one action, without opening either.
    await bar.getByRole('button', { name: 'Спринт' }).click();
    await page.getByRole('menuitem', { name: 'Спринт для переноса' }).click();
    await expect(bar).toBeHidden({ timeout: 15_000 });
    const section = page.locator('section').filter({ hasText: 'Спринт для переноса' }).first();
    await expect(section.getByText('Первая в спринт')).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText('Вторая в спринт')).toBeVisible();
    await expect(section.getByText('Остаётся в бэклоге')).toHaveCount(0);
  });
});
