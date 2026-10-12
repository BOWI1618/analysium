import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Roles of the workspace's own: made by the owner in the table of permissions,
 * given to people in the list of members — of the workspace and of a project —
 * and in force for them at once.
 */

const password = 'password123';
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Логин', { exact: true }).fill(`e2e-${unique()}`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Название пространства').fill('Команда E2E');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, { timeout: 20_000 });
}

/** A colleague gets in by the owner's link and stays signed in, in a browser of their own. */
async function colleague(page: Page, browser: Browser, name: string) {
  await page.goto('/settings/workspace?section=members');
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  const link = (await page.getByLabel('Ссылка для входа').textContent())!.trim();

  const context = await browser.newContext();
  const mate = await context.newPage();
  await mate.goto(link);
  await mate.getByLabel('Ваше имя').fill(name);
  await mate.getByLabel('Логин', { exact: true }).fill(`mate-${unique()}`);
  await mate.getByLabel('Пароль').fill(password);
  await mate.getByRole('button', { name: 'Присоединиться' }).click();
  await expect(mate.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, { timeout: 20_000 });
  const id = (await (await mate.request.get('/api/v1/auth/session')).json()).user.id as string;
  return { mate, context, id };
}

async function createProject(page: Page, name: string) {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const response = await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
    data: { name, key: `R${unique().slice(-4).toUpperCase()}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

test.describe('роли и права', () => {
  test('владелец создаёт роль в таблице прав и выдаёт её; права меняются у человека сразу', async ({ page, browser }) => {
    await register(page, 'Владелец Ролей');
    const project = await createProject(page, 'Проект с ролями');
    const { mate, context } = await colleague(page, browser, 'Коллега Наблюдатель');

    // As a plain member the colleague may create tasks.
    await mate.goto(`/projects/${project.id}/board`);
    await expect(mate.getByRole('button', { name: /Создать задачу/ }).first()).toBeVisible({ timeout: 15_000 });

    /* ------------------------------------------------- the role, in the table */
    await page.goto('/settings/workspace?section=roles');
    await expect(page.getByRole('heading', { name: 'Роли и права' })).toBeVisible({ timeout: 15_000 });
    // The built-in roles are shown in the same table, with their ticks fixed.
    await page.getByRole('button', { name: /Показать права.*гость/i }).click();
    const guestTable = page.getByRole('table', { name: 'Права роли «гость»' });
    await expect(guestTable.getByLabel('Комментарии: изменение')).toBeChecked();
    await expect(guestTable.getByLabel('Задачи: изменение')).not.toBeChecked();
    await expect(guestTable.getByLabel('Задачи: изменение')).toBeDisabled();

    await page.getByRole('button', { name: 'Новая роль' }).click();
    const form = page.getByRole('form', { name: 'Новая роль' });
    await form.getByLabel('Название роли').fill('Наблюдатель');
    // Reading is what being let in means: it is ticked and cannot be taken away.
    await expect(form.getByLabel('Задачи: чтение')).toBeChecked();
    await expect(form.getByLabel('Задачи: чтение')).toBeDisabled();
    await form.getByLabel('Комментарии: изменение').check();
    await form.getByRole('button', { name: 'Создать роль' }).click();
    await expect(page.getByText('Роль «Наблюдатель» создана')).toBeVisible({ timeout: 15_000 });
    const roles = page.getByRole('list', { name: 'Роли в пространстве' });
    await expect(roles.getByText('Пока никому не выдана.')).toBeVisible();

    /* ------------------------------------------------------ given to a person */
    await page.goto('/settings/workspace?section=members');
    await page.getByLabel('Роль участника Коллега Наблюдатель').selectOption({ label: 'Наблюдатель' });
    await expect(page.getByText('Роль обновлена')).toBeVisible({ timeout: 15_000 });

    // In force at once: the colleague's open page stops offering what the role does not allow…
    await expect(mate.getByRole('button', { name: /Создать задачу/ })).toHaveCount(0, { timeout: 20_000 });
    // …and the server refuses it whatever the page shows.
    const refused = await mate.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Не создастся' } });
    expect(refused.status()).toBe(403);

    /* ------------------------------------------- a tick more, for all holders */
    await page.goto('/settings/workspace?section=roles');
    await expect(page.getByRole('list', { name: 'Роли в пространстве' }).getByText('Выдана: 1 человеку.')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Изменить роль «Наблюдатель»' }).click();
    const edit = page.getByRole('form', { name: 'Изменение роли' });
    await expect(edit.getByLabel('Комментарии: изменение')).toBeChecked();
    await edit.getByLabel('Задачи: изменение').check();
    await edit.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(page.getByText('Роль «Наблюдатель» сохранена')).toBeVisible({ timeout: 15_000 });

    await expect(mate.getByRole('button', { name: /Создать задачу/ }).first()).toBeVisible({ timeout: 20_000 });
    const allowed = await mate.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Теперь создаётся' } });
    expect(allowed.status()).toBe(201);

    // A role somebody holds is not deleted from under them.
    await page.getByRole('button', { name: 'Удалить роль «Наблюдатель»' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByText(/сейчас выдана людям/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Изменить роль «Наблюдатель»' })).toBeVisible();

    await context.close();
  });

  test('роль участника проекта меняется в списке; своя роль для проекта выбирается там же', async ({ page, browser }) => {
    await register(page, 'Владелец Проекта');
    const project = await createProject(page, 'Проект с участниками');
    const { context, id } = await colleague(page, browser, 'Коллега Проектный');
    await context.close();

    // A role for projects, made in the same table — without the rows that belong to the workspace.
    await page.goto('/settings/workspace?section=roles');
    await page.getByRole('radio', { name: 'В проекте' }).click();
    await page.getByRole('button', { name: 'Новая роль' }).click();
    const form = page.getByRole('form', { name: 'Новая роль' });
    await form.getByLabel('Название роли').fill('Тестировщик');
    await expect(form.getByLabel('Участники пространства: изменение')).toHaveCount(0);
    await form.getByLabel('Взять галочки из роли').selectOption({ label: 'наблюдатель' });
    await form.getByLabel('Задачи: изменение').check();
    await form.getByRole('button', { name: 'Создать роль' }).click();
    await expect(page.getByText('Роль «Тестировщик» создана')).toBeVisible({ timeout: 15_000 });

    await page.goto(`/projects/${project.id}/settings`);
    await page.getByRole('button', { name: 'Участники' }).click();
    await page.getByLabel('Добавить участника').selectOption({ label: 'Коллега Проектный' });
    await page.getByLabel('Роль', { exact: true }).selectOption({ label: 'наблюдатель' });
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();

    const role = page.getByLabel('Роль в проекте: Коллега Проектный');
    await expect(role).toHaveValue('VIEWER', { timeout: 15_000 });
    const roleOf = async () =>
      ((await (await page.request.get(`/api/v1/projects/${project.id}`)).json()).members as {
        userId: string;
        role: string;
        customRole: { name: string } | null;
      }[]).find((member) => member.userId === id)!;

    // Another built-in role, straight from the list.
    await role.selectOption({ label: 'ведущий' });
    await expect(page.getByText('Роль в проекте обновлена')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await roleOf()).role, { timeout: 15_000 }).toBe('LEAD');

    // And the role of the workspace's own.
    await role.selectOption({ label: 'Тестировщик' });
    await expect.poll(async () => (await roleOf()).customRole?.name ?? null, { timeout: 15_000 }).toBe('Тестировщик');
    await page.reload();
    await page.getByRole('button', { name: 'Участники' }).click();
    await expect(page.getByLabel('Роль в проекте: Коллега Проектный').locator('option:checked')).toHaveText('Тестировщик', {
      timeout: 15_000,
    });
  });
});
