import { expect, test, type Page } from '@playwright/test';

/**
 * Subprojects under a project — in the sidebar, on the projects page and in
 * every menu a project is chosen from — and their tasks on the screens of the
 * project above. With it, what goes with the sidebar's project list: its
 * icons, its open-task figure, crossed-out finished tasks, and the task types
 * on offer once epics are gone.
 */

const password = 'password123';
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Логин', { exact: true }).fill(`e2e-${unique()}@test.local`);
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

async function createSubproject(page: Page, parentId: string, name: string, icon = 'calendar-days'): Promise<{ id: string; key: string }> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const response = await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
    data: { name, key: `S${unique().slice(-4).toUpperCase()}`, icon, parentId },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test.describe('дерево проектов', () => {
  test('страница «Проекты» — список: подпроекты раскрываются под проектом стрелкой', async ({ page }) => {
    await register(page, 'Проверяющий Список');
    const main = await createProject(page, 'Сайт компании');
    const blog = await createSubproject(page, main.id, 'Блог сайта');
    await createSubproject(page, main.id, 'Лендинг акции');
    await createProject(page, 'Отдельный проект');

    await page.goto('/projects');
    const list = page.getByRole('list', { name: 'Проекты' });
    await expect(list.getByRole('link', { name: 'Сайт компании' })).toBeVisible({ timeout: 15_000 });
    await expect(list.getByRole('link', { name: 'Отдельный проект' })).toBeVisible();
    // Folded at first: the page opens as a short list of projects, and says how many stand under each.
    await expect(list.getByText('2 подпроекта')).toBeVisible();
    await expect(list.getByRole('link', { name: 'Блог сайта' })).toHaveCount(0);

    await list.getByRole('button', { name: 'Показать подпроекты «Сайт компании»' }).click();
    const branch = list.getByRole('list', { name: 'Подпроекты «Сайт компании»' });
    await expect(branch.getByRole('link', { name: 'Блог сайта' })).toBeVisible();
    await expect(branch.getByRole('link', { name: 'Лендинг акции' })).toBeVisible();
    // A project of its own is not among them.
    await expect(branch.getByRole('link', { name: 'Отдельный проект' })).toHaveCount(0);

    // What is open stays open between visits.
    await page.reload();
    await expect(branch.getByRole('link', { name: 'Блог сайта' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Свернуть подпроекты', exact: true }).click();
    await expect(branch).toHaveCount(0);
    await page.getByRole('button', { name: 'Раскрыть подпроекты', exact: true }).click();

    // The whole line opens the project.
    await branch.getByRole('link', { name: 'Блог сайта' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${blog.id}`));
  });

  test('проект выбирается одним и тем же деревом: в форме задачи, в карточке и в фильтре', async ({ page }) => {
    await register(page, 'Проверяющий Выбор');
    const main = await createProject(page, 'Сайт компании');
    const blog = await createSubproject(page, main.id, 'Блог сайта');
    await createProject(page, 'Отдельный проект');
    const task = await (
      await page.request.post('/api/v1/issues', { data: { projectId: main.id, title: 'Переезжает в подпроект' } })
    ).json();

    // The form of a new task.
    await page.goto(`/projects/${main.id}/list`);
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByRole('button', { name: 'Проект: Сайт компании' }).click();
    const menu = page.getByRole('menu', { name: 'Выбрать проект' });
    const under = menu.getByRole('group', { name: 'Подпроекты «Сайт компании»' });
    await expect(under.getByRole('menuitem', { name: /Блог сайта/ })).toBeVisible();
    await expect(under.getByRole('menuitem', { name: /Отдельный проект/ })).toHaveCount(0);
    // The arrow folds the branch, as in the sidebar.
    await menu.getByRole('button', { name: 'Свернуть подпроекты «Сайт компании»' }).click();
    await expect(under).toHaveCount(0);
    await menu.getByRole('button', { name: 'Показать подпроекты «Сайт компании»' }).click();
    // Typing the project's name brings its subprojects with it.
    await menu.getByLabel('Поиск проекта').fill('сайт комп');
    await expect(under.getByRole('menuitem', { name: /Блог сайта/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Отдельный проект/ })).toHaveCount(0);
    await under.getByRole('menuitem', { name: /Блог сайта/ }).click();
    await expect(form.getByRole('button', { name: 'Проект: Блог сайта' })).toBeVisible();
    page.on('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Escape');

    // The card of a task: «Перенести в проект» offers the same tree.
    await page.goto(`/issue/${task.issueKey}`);
    await page.getByRole('button', { name: 'Перенести в проект' }).click();
    const transfer = page.getByRole('menu', { name: 'Выбрать проект' });
    await expect(transfer.getByRole('group', { name: 'Подпроекты «Сайт компании»' }).getByRole('menuitem', { name: /Блог сайта/ })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('Escape');

    // The «Проект» filter of a list across projects.
    await page.goto('/planning?mode=pool');
    const facet = page.getByRole('button', { name: 'Проект', exact: true });
    await expect(facet.or(page.getByRole('button', { name: /^Фильтры/ })).first()).toBeVisible({ timeout: 15_000 });
    if (!(await facet.isVisible())) await page.getByRole('button', { name: /^Фильтры/ }).click();
    await facet.click();
    const filter = page.getByRole('menu', { name: 'Проект' });
    await filter.getByRole('group', { name: 'Подпроекты «Сайт компании»' }).getByRole('menuitem', { name: 'Блог сайта' }).click();
    await expect(page).toHaveURL(new RegExp(`projectId=${blog.id}`));
  });
});

test.describe('основной проект вместе с подпроектами', () => {
  test('на доске и в списке проекта стоят и задачи подпроектов — со значком подпроекта', async ({ page }) => {
    await register(page, 'Проверяющий Семью');
    const main = await createProject(page, 'Сайт компании');
    const blog = await createSubproject(page, main.id, 'Блог сайта');
    await page.request.post('/api/v1/issues', { data: { projectId: main.id, title: 'Задача самого проекта' } });
    const theirs = await (
      await page.request.post('/api/v1/issues', { data: { projectId: blog.id, title: 'Задача из блога' } })
    ).json();

    await page.goto(`/projects/${main.id}/board`);
    // The card itself: on a board it sits inside a draggable wrapper that reads as a button too.
    const own = page.locator('article').filter({ hasText: 'Задача самого проекта' });
    const foreign = page.locator('article').filter({ hasText: 'Задача из блога' });
    await expect(own).toBeVisible({ timeout: 15_000 });
    await expect(foreign).toBeVisible();
    // Whose it is reads off the card: the subproject's icon, and only on what is not the project's own.
    await expect(foreign.getByRole('img', { name: 'Подпроект: Блог сайта' })).toBeVisible();
    await expect(own.getByRole('img', { name: /^Подпроект:/ })).toHaveCount(0);

    // The same in the list.
    await page.getByRole('link', { name: 'Список' }).click();
    await expect(page.getByTitle('Задача из блога', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTitle('Задача самого проекта', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Подпроект: Блог сайта' })).toHaveCount(1);

    // Closed from the board of the project above, the task gets the «done» of its own subproject.
    await page.getByRole('link', { name: 'Доска' }).click();
    await page.getByRole('button', { name: `Отметить выполненной ${theirs.issueKey}` }).click();
    const blogDone = ((await (await page.request.get(`/api/v1/projects/${blog.id}`)).json()).statuses as { id: string; category: string }[]).find(
      (status) => status.category === 'COMPLETED',
    )!;
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${theirs.id}`)).json()).statusId, { timeout: 15_000 })
      .toBe(blogDone.id);
    // And still stands on this board, now in its «Готово».
    await expect(foreign).toBeVisible();

    // The subproject opened by itself shows its own tasks, with no marks.
    await page.goto(`/projects/${blog.id}/board`);
    await expect(foreign).toBeVisible({ timeout: 15_000 });
    await expect(own).toHaveCount(0);
    await expect(page.getByRole('img', { name: /^Подпроект:/ })).toHaveCount(0);
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
