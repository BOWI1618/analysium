import { expect, test, type Page } from '@playwright/test';

/**
 * Subprojects under a project in the sidebar, and what goes with the
 * sidebar's project list: its icons, its open-task figure, crossed-out
 * finished tasks, and the task types on offer once epics are gone.
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

async function createProject(page: Page, name: string): Promise<{ id: string; key: string }> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const response = await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
    data: { name, key: `P${unique().slice(-4).toUpperCase()}`, icon: 'rocket' },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test.describe('подпроекты', () => {
  test('подпроект создаётся из основного проекта и раскрывается под ним стрелкой', async ({ page }) => {
    await register(page, 'Проверяющий Подпроекты');
    const main = await createProject(page, 'Основной проект');

    await page.goto(`/projects/${main.id}`);
    await page.getByRole('button', { name: 'Подпроект', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/new\\?parent=${main.id}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('подпроект');
    // The parent is already chosen; the form says where the subproject will stand.
    await expect(page.getByLabel('В составе проекта')).toHaveValue(main.id);
    await page.getByLabel('Название').fill('Подготовка стенда');
    await page.getByRole('button', { name: 'Создать подпроект' }).click();

    // A project of its own: its own board and analytics.
    await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Аналитика' })).toBeVisible();
    expect(page.url()).not.toContain(main.id);

    // In the sidebar it stands under its project, and the branch is open because we are in it.
    const branch = page.getByRole('group', { name: 'Подпроекты «Основной проект»' });
    await expect(branch.getByRole('link', { name: /Подготовка стенда/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Свернуть подпроекты «Основной проект»' }).click();
    await expect(branch).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать подпроекты «Основной проект»' }).click();
    await expect(branch.getByRole('link', { name: /Подготовка стенда/ })).toBeVisible();

    // The way back up is in the breadcrumbs.
    await page.getByRole('link', { name: 'Основной проект' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${main.id}`));
  });
});

test.describe('список проектов в меню слева', () => {
  test('у проекта свой значок; цифра считает только задачи и уменьшается сразу, как задачу закрыли', async ({ page }) => {
    await register(page, 'Проверяющий Меню');
    const project = await createProject(page, 'Проект со счётчиком');
    const task = await (
      await page.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Закрываемая задача' } })
    ).json();
    await page.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Остаётся открытой' } });
    // Parts of a task are not counted next to the project.
    await page.request.post('/api/v1/issues', {
      data: { projectId: project.id, parentId: task.id, type: 'SUBTASK', title: 'Часть задачи' },
    });

    await page.goto(`/projects/${project.id}/board`);
    const inSidebar = page.locator('aside').getByRole('link', { name: /Проект со счётчиком/ });
    await expect(inSidebar).toContainText('2', { timeout: 15_000 });
    // The project's icon, not a colour chip.
    await expect(inSidebar.locator('svg')).toHaveCount(1);

    await page.getByRole('button', { name: `Отметить выполненной ${task.issueKey}` }).click();
    // No reload: the figure follows the task.
    await expect(inSidebar).toContainText('1', { timeout: 15_000 });
    await expect(inSidebar).not.toContainText('2');

    // In the list the finished task is crossed out, the open one is not.
    await page.getByRole('link', { name: 'Список' }).click();
    await expect(page.getByTitle('Закрываемая задача', { exact: true })).toHaveCSS('text-decoration-line', 'line-through', {
      timeout: 15_000,
    });
    await expect(page.getByTitle('Остаётся открытой', { exact: true })).toHaveCSS('text-decoration-line', 'none');
  });
});

test.describe('типы задач', () => {
  test('эпика в выборе типа нет, а подзадача добавляется к обычной задаче', async ({ page }) => {
    await register(page, 'Проверяющий Типы');
    const project = await createProject(page, 'Без эпиков');
    const task = await (
      await page.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Задача с частями' } })
    ).json();

    await page.goto(`/projects/${project.id}/list`);
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByRole('button', { name: /^Задача/ }).click();
    const types = page.getByRole('menu', { name: 'Изменить тип задачи' });
    await expect(types.getByRole('menuitem', { name: 'Задача' })).toBeVisible();
    await expect(types.getByRole('menuitem', { name: 'Эпик' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(form.getByLabel('Эпик', { exact: true })).toHaveCount(0);

    // The case from the report: a subtask of a project's task is created.
    const created = await page.request.post('/api/v1/issues', {
      data: { projectId: project.id, parentId: task.id, type: 'SUBTASK', title: 'Ролевая модель' },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).issueKey).toBe(`${task.issueKey}.1`);
  });
});

test.describe('цвет проекта', () => {
  test('кроме предложенных цветов можно выбрать любой свой', async ({ page }) => {
    await register(page, 'Проверяющий Цвета');
    await page.goto('/projects/new');
    await page.getByLabel('Название').fill('Проект своего цвета');
    // The last square opens the full palette; the colour picked becomes the chosen one.
    await page.getByLabel('Свой цвет').fill('#8a2be2');
    await expect(page.getByText('#8a2be2')).toBeVisible();
    await page.getByRole('button', { name: 'Создать проект' }).click();
    await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+/, { timeout: 15_000 });

    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const projects = await (await page.request.get(`/api/v1/workspaces/${session.workspaces[0].id}/projects`)).json();
    expect(projects.find((project: { name: string }) => project.name === 'Проект своего цвета').color).toBe('#8a2be2');

    // A palette colour is still one click away, in the settings too.
    await page.getByRole('link', { name: 'Настройки' }).click();
    await page.getByRole('button', { name: 'Цвет: Зелёный' }).click();
    await expect(page.getByRole('button', { name: 'Цвет: Зелёный' })).toHaveAttribute('aria-pressed', 'true');
  });
});
