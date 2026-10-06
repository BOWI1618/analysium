import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Work across people: handing out unassigned tasks and choosing who follows a
 * task. Each scenario needs a second person, who joins by an invite code the
 * way a real colleague would.
 */

// Two people sign up in each scenario before it even starts; on a cold start of the
// servers that alone has used up the default minute.
test.describe.configure({ timeout: 120_000 });

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

/** A colleague joins the owner's workspace from a browser of their own; returns their id. */
async function addColleague(page: Page, browser: Browser, name: string): Promise<string> {
  await page.goto('/settings/workspace');
  await page.getByRole('button', { name: 'Участники' }).click();
  await page.getByRole('button', { name: 'Создать код' }).click();
  const code = (await page.getByLabel('Код приглашения').textContent())!.trim();

  const context = await browser.newContext();
  const mate = await context.newPage();
  await mate.goto('/join');
  await mate.getByLabel('Код приглашения').fill(code);
  await mate.getByLabel('Ваше имя').fill(name);
  await mate.getByLabel('Почта для входа').fill(`mate-${unique()}@test.local`);
  await mate.getByLabel('Пароль').fill(password);
  await mate.getByRole('button', { name: 'Присоединиться' }).click();
  await expect(mate.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, { timeout: 20_000 });
  await context.close();

  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const members = await (await page.request.get(`/api/v1/workspaces/${session.workspaces[0].id}/members`)).json();
  return members.find((member: { user: { name: string } }) => member.user.name === name).user.id;
}

test.describe('распределение задач', () => {
  test('задачам без исполнителя задают срок и назначают выбранного сотрудника', async ({ page, browser }) => {
    await register(page, 'Планировщик Работ');
    const mateId = await addColleague(page, browser, 'Коллега Плановый');
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const workspaceId = session.workspaces[0].id;
    const create = (data: Record<string, unknown>) => page.request.post('/api/v1/issues', { data: { workspaceId, ...data } });
    await create({ title: 'Первая свободная' });
    await create({ title: 'Вторая свободная' });
    await create({ title: 'Третья свободная' });
    await create({ title: 'Уже у коллеги', assigneeId: mateId });

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Распределение/ }).click();
    await expect(page).toHaveURL(/\/planning$/);
    const pool = page.getByRole('region', { name: 'Задачи без исполнителя' });
    const person = page.locator('main aside');
    await expect(pool.getByText('3 задачи')).toBeVisible({ timeout: 15_000 });
    // Only what nobody has: the colleague's own task is not in the pool.
    await expect(pool.getByText('Уже у коллеги')).toHaveCount(0);

    // Whom the work goes to, with what they already carry.
    await person.getByRole('button', { name: 'Выберите сотрудника' }).click();
    await page.getByRole('menuitem', { name: /Коллега Плановый/ }).click();
    await expect(person.getByText('Уже у коллеги')).toBeVisible({ timeout: 15_000 });
    await expect(person.locator('dl > div').first()).toContainText('1');

    const row = (title: string) => pool.getByRole('row').filter({ hasText: title });
    await row('Первая свободная').getByRole('checkbox').check();
    await row('Вторая свободная').getByRole('checkbox').check();

    // One deadline for both, and they stay selected for the next step.
    const bar = page.getByRole('region', { name: 'Массовые действия' });
    await expect(bar).toContainText('Выбрано: 2');
    await bar.getByRole('button', { name: 'Срок' }).click();
    await page.getByLabel('Новый срок').fill('2031-03-15');
    await page.getByRole('button', { name: 'Задать' }).click();
    await expect(row('Первая свободная')).toContainText('15 мар', { timeout: 15_000 });
    await expect(row('Вторая свободная')).toContainText('15 мар');
    await expect(bar).toContainText('Выбрано: 2');

    await bar.getByRole('button', { name: 'Назначить: Коллега Плановый' }).click();
    await expect(pool.getByText('1 задача')).toBeVisible({ timeout: 15_000 });
    await expect(pool.getByText('Первая свободная')).toHaveCount(0);
    await expect(pool.getByText('Третья свободная')).toBeVisible();
    // What was handed out is now among the colleague's tasks, and counted.
    await expect(person.getByText('Первая свободная')).toBeVisible({ timeout: 15_000 });
    await expect(person.locator('dl > div').first()).toContainText('3');
    await expect(bar).toBeHidden();

    // «Без срока» keeps the tasks nobody has dated yet in view.
    // Next to the person panel the bar is narrow, so its facets sit behind one button.
    await pool.getByRole('button', { name: /^Фильтры/ }).click();
    await pool.getByRole('button', { name: 'Срок' }).click();
    await page.getByRole('menuitem', { name: 'Без срока' }).click();
    await page.keyboard.press('Escape');
    await expect(pool.getByText('Третья свободная')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/noDueDate=true/);
  });
});

test.describe('наблюдатели', () => {
  test('выбираются при создании задачи и меняются в карточке', async ({ page, browser }) => {
    await register(page, 'Автор Наблюдений');
    await addColleague(page, browser, 'Коллега Следящий');

    await page.goto('/');
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const create = page.getByRole('dialog', { name: 'Новая задача' });
    await create.getByLabel('Название задачи').fill('Задача с наблюдателем');
    await create.getByRole('button', { name: 'Наблюдатели: нет' }).click();
    await page.getByRole('menuitem').filter({ hasText: 'Коллега Следящий' }).click();
    await page.keyboard.press('Escape');
    await expect(create.getByRole('button', { name: 'Наблюдатели: 1' })).toBeVisible();
    await create.getByRole('button', { name: 'Создать и открыть' }).click();
    await expect(create).toBeHidden({ timeout: 15_000 });

    // The author and the colleague picked in the form.
    await page.getByRole('button', { name: 'Наблюдатели: 2' }).click({ timeout: 15_000 });
    const list = page.getByRole('list', { name: 'Кто следит за задачей' });
    await expect(list).toContainText('Коллега Следящий');
    await expect(list).toContainText('подписан(а)');
    await expect(list).toContainText('автор');

    // A subscription can be taken away; the author stays.
    await page.getByRole('button', { name: 'Убрать из наблюдателей: Коллега Следящий' }).click();
    await expect(list).not.toContainText('Коллега Следящий', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Наблюдатели: 1' })).toBeVisible({ timeout: 15_000 });

    // And given back from the same list.
    await page.getByLabel('Добавить наблюдателя').fill('Следящ');
    await page.getByRole('menuitem').filter({ hasText: 'Коллега Следящий' }).click();
    await expect(list).toContainText('Коллега Следящий', { timeout: 15_000 });
  });
});

test.describe('отделы', () => {
  test('администратор собирает отдел, руководитель видит задачи его сотрудников', async ({ page, browser }) => {
    await register(page, 'Глава Отдела');
    const mateId = await addColleague(page, browser, 'Сотрудник Отдельный');
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const workspaceId = session.workspaces[0].id;
    const create = (data: Record<string, unknown>) => page.request.post('/api/v1/issues', { data: { workspaceId, ...data } });
    await create({ title: 'Задача сотрудника отдела', assigneeId: mateId, dueDate: '2020-02-02T12:00:00.000Z' });
    // The lead's own task: they run the department but are not listed in it.
    await create({ title: 'Задача вне отдела', assigneeId: session.user.id });

    // The register of departments is kept in the workspace settings.
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Отделы' }).click();
    await page.getByRole('button', { name: 'Новый отдел' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый отдел' });
    await dialog.getByLabel('Название').fill('Аналитика');
    await dialog.getByRole('button', { name: 'Руководитель: не назначен' }).click();
    await page.getByRole('menuitem', { name: /Глава Отдела/ }).click();
    await dialog.getByRole('button', { name: 'Сотрудники отдела: 0' }).click();
    await page.getByRole('menuitem').filter({ hasText: 'Сотрудник Отдельный' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Сотрудники отдела: 1' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Создать отдел' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible();
    await expect(page.getByText('Руководитель: Глава Отдела')).toBeVisible();

    // The lead's screen: the department's people with their figures, and their tasks only.
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Отдел/ }).click();
    await expect(page).toHaveURL(/\/department-work$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Аналитика');
    const people = page.getByRole('list', { name: 'Сотрудники отдела' });
    await expect(people).toContainText('Сотрудник Отдельный');
    await expect(people).toContainText('активных 1', { timeout: 15_000 });
    await expect(people).toContainText('просрочено 1');
    await expect(page.getByText('Задача сотрудника отдела')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Задача вне отдела')).toHaveCount(0);

    // From a person in the department to everything that person has.
    await people.getByRole('link', { name: 'Все задачи: Сотрудник Отдельный' }).click();
    await expect(page).toHaveURL(/\/employee-work\?user=/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Сотрудник Отдельный');
  });
});
