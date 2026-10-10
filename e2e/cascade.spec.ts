import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * «Распределение → Мой пул и подчинённые»: the reporting line is written
 * down in the register of departments, and tasks go one step down it — by a
 * button, in a batch, or by dragging. Who may hand what to whom is held by
 * the server and covered there; here the screen itself is driven.
 */

// Three people sign up before a scenario starts; on a cold start that alone takes the default minute.
test.describe.configure({ timeout: 180_000 });

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

/** A colleague joins by an invite code from a browser of their own; returns their id. */
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

/** A project with its backlog status, and a way to put tasks into someone's backlog. */
async function setUpProject(page: Page) {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const workspaceId = session.workspaces[0].id as string;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, {
      data: { name: 'Работы отдела', key: `C${unique().slice(-4).toUpperCase()}` },
    })
  ).json();
  const backlog = (project.statuses as { id: string; category: string }[]).find((status) => status.category === 'BACKLOG')!;
  const pooled = async (title: string, assigneeId: string) =>
    (await (
      await page.request.post('/api/v1/issues', {
        data: { projectId: project.id, title, assigneeId, statusId: backlog.id },
      })
    ).json()) as { id: string; issueKey: string };
  return { workspaceId, me: session.user.id as string, project, pooled };
}

test.describe('распределение по подчинённости', () => {
  test('администратор записывает должности и руководителей; задачи идут из пула подчинённым кнопкой, пакетом и перетаскиванием', async ({
    page,
    browser,
  }) => {
    await register(page, 'Главный Специалист');
    const firstId = await addColleague(page, browser, 'Ведущий Первый');
    await addColleague(page, browser, 'Ведущий Второй');
    const { me, pooled } = await setUpProject(page);

    /* ---------------------------------------------- the register of departments */
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Отделы' }).click();
    await page.getByRole('button', { name: 'Новый отдел' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый отдел' });
    await dialog.getByLabel('Название').fill('Отдел анализа');
    await dialog.getByRole('button', { name: 'Сотрудники отдела: 0' }).click();
    for (const name of ['Главный Специалист', 'Ведущий Первый', 'Ведущий Второй']) {
      await page.getByRole('menuitem').filter({ hasText: name }).click();
    }
    await page.keyboard.press('Escape');
    await dialog.getByLabel('Должность: Главный Специалист').fill('Главный специалист');
    for (const name of ['Ведущий Первый', 'Ведущий Второй']) {
      await dialog.getByLabel(`Должность: ${name}`).fill('Ведущий специалист');
      await dialog.getByLabel(`Непосредственный руководитель: ${name}`).selectOption({ label: 'Руководитель: Главный Специалист' });
    }
    // A ring is refused where it was entered, and nothing is saved.
    await dialog.getByLabel('Непосредственный руководитель: Главный Специалист').selectOption({ label: 'Руководитель: Ведущий Первый' });
    await dialog.getByRole('button', { name: 'Создать отдел' }).click();
    await expect(dialog.getByRole('alert')).toContainText('круг', { timeout: 15_000 });
    await dialog.getByLabel('Непосредственный руководитель: Главный Специалист').selectOption({ label: 'Без руководителя' });
    await dialog.getByRole('button', { name: 'Создать отдел' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Структура отдела' }).click();
    const tree = page.getByRole('list', { name: 'Структура отдела «Отдел анализа»' });
    await expect(tree.getByRole('listitem').first()).toContainText('Главный Специалист');
    await expect(tree.getByRole('listitem').first().getByRole('listitem')).toHaveCount(2);

    /* --------------------------------------------------------------- the pool */
    const byButton = await pooled('Уйдёт кнопкой', me);
    const firstOfBatch = await pooled('Первая из пакета', me);
    const secondOfBatch = await pooled('Вторая из пакета', me);
    await pooled('Уйдёт перетаскиванием', me);
    await pooled('Останется у меня', me);
    // Somebody else's task is not in my pool, whoever created it.
    await pooled('Уже у ведущего', firstId);

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Распределение/ }).click();
    await expect(page).toHaveURL(/\/planning$/);
    const pool = page.getByRole('region', { name: 'Пул задач' });
    const first = page.getByRole('region', { name: 'Задачи сотрудника: Ведущий Первый' });
    const second = page.getByRole('region', { name: 'Задачи сотрудника: Ведущий Второй' });
    const card = (scope: typeof pool, title: string) => scope.getByRole('article').filter({ hasText: title });

    await expect(pool.getByRole('heading', { level: 1 })).toContainText('Мой пул задач');
    await expect(pool.getByRole('heading', { level: 1 })).toContainText('5 задач', { timeout: 15_000 });
    await expect(pool).toContainText('Главный специалист');
    await expect(card(pool, 'Уже у ведущего')).toHaveCount(0);
    await expect(card(first, 'Уже у ведущего')).toBeVisible();
    await expect(first).toContainText('Ведущий специалист');

    // One task, by the button — the way that works from the keyboard and on a phone.
    await pool.getByRole('button', { name: `Передать ${byButton.issueKey}` }).click();
    await page.getByRole('menuitem', { name: /Ведущий Первый/ }).click();
    await expect(card(first, 'Уйдёт кнопкой')).toBeVisible({ timeout: 15_000 });
    await expect(card(pool, 'Уйдёт кнопкой')).toHaveCount(0);
    await expect(pool.getByRole('heading', { level: 1 })).toContainText('4 задачи', { timeout: 15_000 });

    // Several at once.
    await pool.getByRole('checkbox', { name: `Выбрать ${firstOfBatch.issueKey}` }).check();
    await pool.getByRole('checkbox', { name: `Выбрать ${secondOfBatch.issueKey}` }).check();
    const batch = page.getByRole('region', { name: 'Передача выбранных задач' });
    await expect(batch).toContainText('Выбрано: 2');
    await batch.getByRole('button', { name: 'Передать выбранные' }).click();
    await page.getByRole('menuitem', { name: /Ведущий Второй/ }).click();
    await expect(card(second, 'Первая из пакета')).toBeVisible({ timeout: 15_000 });
    await expect(card(second, 'Вторая из пакета')).toBeVisible();
    await expect(batch).toHaveCount(0);

    // And by dragging the card into the person's column.
    const from = (await card(pool, 'Уйдёт перетаскиванием').boundingBox())!;
    const to = (await second.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(card(second, 'Уйдёт перетаскиванием')).toBeVisible({ timeout: 15_000 });
    await expect(card(pool, 'Уйдёт перетаскиванием')).toHaveCount(0);

    // The same task all along: it is in the other person's list under the same key, in the same status.
    const moved = await (await page.request.get(`/api/v1/issues/${byButton.id}`)).json();
    expect(moved).toMatchObject({ issueKey: byButton.issueKey, assignee: { id: firstId }, status: { category: 'BACKLOG' } });

    // Between my own people, and back to myself.
    await second.getByRole('button', { name: `Передать ${firstOfBatch.issueKey}` }).click();
    await page.getByRole('menuitem', { name: /Ведущий Первый/ }).click();
    await expect(card(first, 'Первая из пакета')).toBeVisible({ timeout: 15_000 });
    await second.getByRole('button', { name: `Передать ${secondOfBatch.issueKey}` }).click();
    await page.getByRole('menuitem', { name: 'Вернуть себе' }).click();
    await expect(card(pool, 'Вторая из пакета')).toBeVisible({ timeout: 15_000 });

    /* --------------------------------------------------- looking into a branch */
    await first.getByRole('button', { name: 'Работы и ветка' }).click();
    await expect(page).toHaveURL(/view=/);
    await expect(page.getByText('Просмотр работ сотрудника.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: 'Цепочка подчинённости' })).toContainText('Ведущий Первый');
    await expect(pool.getByRole('heading', { level: 1 })).toContainText('Пул задач: Ведущий Первый');
    await expect(card(pool, 'Уйдёт кнопкой')).toBeVisible({ timeout: 15_000 });
    // Looked at, not acted in: nothing here can be handed over or picked.
    await expect(pool.getByRole('button', { name: /^Передать/ })).toHaveCount(0);
    await expect(pool.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Создать себе задачу' })).toHaveCount(0);
    await page.getByRole('button', { name: 'К моему пулу' }).click();
    await expect(pool.getByRole('heading', { level: 1 })).toContainText('Мой пул задач');

    /* ------------------------------------------------------- a task for myself */
    await pool.getByRole('button', { name: 'Создать себе задачу' }).click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByRole('button', { name: 'Проект: без проекта' }).click();
    await page.getByRole('menuitem', { name: /Работы отдела/ }).click();
    // Mine from the start, and in the project's own backlog.
    await expect(form.getByRole('button', { name: 'Главный Специалист' })).toBeVisible({ timeout: 15_000 });
    await expect(form.getByRole('button', { name: 'Бэклог' })).toBeVisible();
    await form.getByLabel('Название задачи').fill('Создал себе сам');
    await form.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(card(pool, 'Создал себе сам')).toBeVisible({ timeout: 15_000 });

    // The other states are a way of looking, not a change: the task is still in the backlog.
    await pool.getByRole('radio', { name: 'В работе' }).click();
    await expect(card(pool, 'Создал себе сам')).toHaveCount(0);
    await expect(pool.getByText('В работе ничего нет')).toBeVisible({ timeout: 15_000 });
    await pool.getByRole('radio', { name: 'Бэклог' }).click();
    await expect(card(pool, 'Создал себе сам')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('распределение на телефоне', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('вместо трёх колонок — «Мой пул / Подчинённые» и выбор сотрудника; задача передаётся кнопкой', async ({ page, browser }) => {
    // The team is brought together at a desk; the phone is for what follows.
    await page.setViewportSize({ width: 1280, height: 720 });
    await register(page, 'Мобильный Руководитель');
    const firstId = await addColleague(page, browser, 'Подчинённый Первый');
    const secondId = await addColleague(page, browser, 'Подчинённый Второй');
    const { workspaceId, me, pooled } = await setUpProject(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const department = await page.request.post(`/api/v1/workspaces/${workspaceId}/departments`, {
      data: {
        name: 'Отдел на телефоне',
        memberIds: [me, firstId, secondId],
        structure: [
          { userId: me, position: 'Руководитель группы', managerId: null },
          { userId: firstId, position: 'Специалист', managerId: me },
          { userId: secondId, position: 'Специалист', managerId: me },
        ],
      },
    });
    expect(department.status()).toBe(201);
    const task = await pooled('Передаётся с телефона', me);

    await page.goto('/planning');
    const pool = page.getByRole('region', { name: 'Пул задач' });
    await expect(pool.getByRole('article').filter({ hasText: 'Передаётся с телефона' })).toBeVisible({ timeout: 15_000 });
    // One thing at a time: the people are behind the switch, not squeezed in beside the pool.
    await expect(page.getByRole('region', { name: /Задачи сотрудника/ })).toHaveCount(0);

    await pool.getByRole('button', { name: `Передать ${task.issueKey}` }).tap();
    await page.getByRole('menuitem', { name: /Подчинённый Второй/ }).tap();
    await expect(pool.getByRole('article').filter({ hasText: 'Передаётся с телефона' })).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('radio', { name: /Подчинённые/ }).tap();
    const column = page.getByRole('region', { name: /Задачи сотрудника/ });
    await expect(column).toHaveCount(1);
    await column.getByLabel('Чьи задачи показать в колонке').selectOption({ label: 'Подчинённый Второй' });
    await expect(page.getByRole('region', { name: 'Задачи сотрудника: Подчинённый Второй' }).getByRole('article')).toContainText(
      'Передаётся с телефона',
      { timeout: 15_000 },
    );
    // Nothing runs past the edge of the screen.
    const box = (await page.getByRole('region', { name: 'Задачи сотрудника: Подчинённый Второй' }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});
