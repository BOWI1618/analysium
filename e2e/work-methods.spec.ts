import { expect, test, type Page } from '@playwright/test';

/**
 * How work is done in the board, the list, the Gantt chart and the task
 * itself: titles typed straight into a column or the list, tasks closed with
 * a checkbox, columns set up from their own menu, a task without dates placed
 * on the chart with a click, a task duplicated.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function setup(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill('Работа Командная');
  await page.getByLabel('Рабочая почта').fill(`work-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByLabel('Название пространства').fill('Работа');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Работа', { timeout: 20_000 });
  const workspaceId = (await (await page.request.get('/api/v1/auth/session')).json()).workspaces[0].id;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, { data: { name: 'Сайт', projectType: 'KANBAN' } })
  ).json();
  return project.id as string;
}

const issues = async (page: Page, projectId: string) =>
  (await (await page.request.get(`/api/v1/projects/${projectId}/issues?includeDone=true&limit=100`)).json()).items as {
    id: string;
    title: string;
    issueKey: string;
    dueDate: string | null;
    status: { name: string; category: string };
  }[];

test.describe('работа с задачами', () => {
  test('доска: задача вводится в колонке, закрывается галочкой, колонка переименовывается из меню', async ({ page }) => {
    const projectId = await setup(page);
    await page.goto(`/projects/${projectId}/board`);

    await page.getByRole('button', { name: 'Добавить задачу', exact: true }).nth(1).click();
    await page.keyboard.type('Первая из колонки');
    await page.keyboard.press('Enter');
    // The field stays open for the next title.
    await page.keyboard.type('Вторая из колонки');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await issues(page, projectId)).map((i) => i.title).sort()).toEqual([
      'Вторая из колонки',
      'Первая из колонки',
    ]);
    const first = (await issues(page, projectId)).find((i) => i.title === 'Первая из колонки')!;
    expect(first.status.name).toBe('К выполнению');

    await page.getByRole('button', { name: `Отметить выполненной ${first.issueKey}` }).click();
    await expect
      .poll(async () => (await issues(page, projectId)).find((i) => i.id === first.id)!.status.category)
      .toBe('COMPLETED');

    await page.getByRole('button', { name: 'Действия с колонкой «Бэклог»' }).click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Идеи');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Колонка «Идеи»' })).toBeVisible();
  });

  test('список: задача вводится строкой сверху, список группируется по приоритету', async ({ page }) => {
    const projectId = await setup(page);
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Срочная правка', priority: 'URGENT' } });
    await page.goto(`/projects/${projectId}/list`);

    await page.getByLabel('Новая задача').fill('Из строки списка');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Из строки списка')).toBeVisible();

    await page.getByRole('button', { name: 'Группировка' }).click();
    await page.getByRole('menuitem', { name: 'Приоритет' }).click();
    await expect(page.getByRole('heading', { name: 'Срочный' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Средний' })).toBeVisible();
  });

  test('Гант: задача без дат ставится на день щелчком по её строке', async ({ page }) => {
    const projectId = await setup(page);
    const created = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Пока без дат' } })).json();
    await page.goto(`/projects/${projectId}/gantt`);

    const slot = page.getByTitle(`Поставить ${created.issueKey} на этот день`);
    await expect(slot).toBeVisible({ timeout: 15_000 });
    const box = (await slot.boundingBox())!;
    // The row runs the whole timeline, wider than the screen: click near its start.
    await page.mouse.click(box.x + 200, box.y + box.height / 2);

    await expect.poll(async () => (await issues(page, projectId))[0]!.dueDate, { timeout: 15_000 }).not.toBeNull();
  });

  test('карточка: задача дублируется вместе с подзадачей', async ({ page }) => {
    const projectId = await setup(page);
    const source = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Отчёт' } })).json();
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Цифры', type: 'SUBTASK', parentId: source.id } });

    await page.goto(`/issue/${source.issueKey}`);
    await page.getByRole('button', { name: 'Действия с задачей' }).click();
    await page.getByRole('menuitem', { name: 'Дублировать задачу' }).click();
    await page.getByLabel('Название копии').fill('Отчёт, копия');
    await page.getByRole('button', { name: 'Дублировать', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Отчёт, копия' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Цифры')).toBeVisible();
  });

  test('мои задачи: состояние выбирается фильтром, ширина столбца меняется перетаскиванием', async ({ page }) => {
    const projectId = await setup(page);
    const me = (await (await page.request.get('/api/v1/auth/session')).json()).user.id;
    const project = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
    const done = project.statuses.find((s: { category: string }) => s.category === 'COMPLETED');
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Уже сделано', assigneeId: me, statusId: done.id } });
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Ещё в работе', assigneeId: me } });

    await page.goto('/my-work');
    await expect(page.getByText('Ещё в работе')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Уже сделано')).toBeHidden();

    // Only the finished ones, not everything.
    await page.getByRole('button', { name: 'Состояние' }).click();
    await page.getByRole('option', { name: 'Завершены' }).or(page.getByRole('menuitem', { name: 'Завершены' })).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Уже сделано')).toBeVisible();
    await expect(page.getByText('Ещё в работе')).toBeHidden();

    const grip = page.getByRole('separator', { name: 'Ширина столбца «Метки»' });
    const header = grip.locator('..');
    const before = (await header.boundingBox())!.width;
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(before + 100);
  });
});
