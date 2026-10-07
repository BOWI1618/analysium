import { expect, test, type Page } from '@playwright/test';

/**
 * What was left of the usability review of 7 October after its first round:
 * all fields and a draft in the create form, saved views with names and
 * owners, the status new tasks get, filling a sprint from the list, and the
 * four tabs of an employee on a phone.
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

async function createProject(page: Page, name: string, projectType = 'KANBAN'): Promise<string> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const response = await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
    data: { name, key: `P${unique().slice(-4).toUpperCase()}`, projectType },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

const draftInBrowser = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('flowdesk.issue-draft.'));
    return key ? (JSON.parse(localStorage.getItem(key)!) as { title: string; recurrence: string | null }) : null;
  });

test.describe('форма новой задачи', () => {
  test('«Все поля» попадают в задачу, а набранное переживает перезагрузку страницы', async ({ page }) => {
    await register(page, 'Проверяющий Черновик');
    const projectId = await createProject(page, 'Черновики');
    await page.goto(`/projects/${projectId}/list`);
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByLabel('Название задачи').fill('Отчёт для руководства');
    await form.getByRole('button', { name: /Все поля/ }).click();
    await form.getByLabel('Оценка, баллы').fill('5');
    await form.getByLabel('Повтор').selectOption({ label: 'Каждую неделю' });
    // What «повтор» means is said where it is chosen.
    await expect(form.getByText(/Повтор срабатывает после закрытия/)).toBeVisible();
    await expect.poll(async () => (await draftInBrowser(page))?.recurrence, { timeout: 10_000 }).toBe('WEEKLY');

    // The page goes away with the form open — a reload, a closed tab, a phone that slept.
    page.on('dialog', (dialog) => void dialog.accept());
    await page.reload();
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    await expect(form.getByText(/Восстановлен несохранённый черновик/)).toBeVisible({ timeout: 15_000 });
    await expect(form.getByLabel('Название задачи')).toHaveValue('Отчёт для руководства');
    // The extra fields open by themselves when something is in them.
    await expect(form.getByLabel('Оценка, баллы')).toHaveValue('5');
    await expect(form.getByLabel('Повтор')).toHaveValue('WEEKLY');

    await form.getByRole('button', { name: 'Создать и открыть' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    // In the task's card the recurrence is the one chosen in the form.
    await expect(page.getByLabel('Повтор', { exact: true })).toHaveValue('WEEKLY', { timeout: 15_000 });
    // A created task is not a draft any more.
    expect(await draftInBrowser(page)).toBeNull();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    await expect(form.getByLabel('Название задачи')).toHaveValue('');
    await expect(form.getByText(/Восстановлен несохранённый черновик/)).toHaveCount(0);
  });

  test('черновик можно отбросить и начать заново', async ({ page }) => {
    await register(page, 'Проверяющий Сброс');
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByLabel('Название задачи').fill('Это не понадобится');
    await expect.poll(async () => (await draftInBrowser(page))?.title, { timeout: 10_000 }).toBe('Это не понадобится');

    page.on('dialog', (dialog) => void dialog.accept());
    await page.reload();
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    await expect(form.getByLabel('Название задачи')).toHaveValue('Это не понадобится', { timeout: 15_000 });
    await form.getByRole('button', { name: 'Начать заново' }).click();
    await expect(form.getByLabel('Название задачи')).toHaveValue('');
    expect(await draftInBrowser(page)).toBeNull();
  });
});

test.describe('сохранённые виды', () => {
  test('вид сохраняется под своим названием, открывается одним нажатием, переименовывается и удаляется', async ({ page }) => {
    await register(page, 'Проверяющий Виды');
    const projectId = await createProject(page, 'Сохранённые виды');
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Срочная работа' } });
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Обычная работа' } });

    await page.goto(`/projects/${projectId}/list`);
    const row = (title: string) => page.getByRole('row').filter({ hasText: title });
    await expect(row('Срочная работа')).toBeVisible({ timeout: 15_000 });
    const filter = page.getByLabel('Фильтровать задачи');
    await filter.fill('Срочная');
    await expect(row('Обычная работа')).toHaveCount(0, { timeout: 15_000 });

    // Saved through a dialog of the product, personal unless said otherwise.
    await page.getByRole('button', { name: 'Виды', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Сохранить текущий вид…' }).click();
    const saving = page.getByRole('dialog', { name: 'Сохранить вид' });
    await expect(saving.getByText('Вид будет виден только вам.')).toBeVisible();
    await saving.getByLabel('Название').fill('Только срочное');
    await saving.getByRole('button', { name: 'Сохранить' }).click();
    await expect(saving).toBeHidden({ timeout: 15_000 });
    // The view on the screen is named on the button.
    await expect(page.getByRole('button', { name: 'Только срочное' })).toBeVisible({ timeout: 15_000 });

    // Back to everything, then to the view with one choice.
    await filter.fill('');
    await expect(row('Обычная работа')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Виды', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Только срочное' }).click();
    await expect(row('Обычная работа')).toHaveCount(0, { timeout: 15_000 });
    await expect(row('Срочная работа')).toBeVisible();

    // Renamed and deleted in the same place.
    await page.getByRole('button', { name: 'Только срочное' }).click();
    await page.getByRole('menuitem', { name: 'Управлять видами…' }).click();
    const managing = page.getByRole('dialog', { name: 'Сохранённые виды' });
    const name = managing.getByLabel('Название вида «Только срочное»');
    await name.fill('Срочное на неделю');
    await name.press('Enter');
    await expect(managing.getByLabel('Название вида «Срочное на неделю»')).toBeVisible({ timeout: 15_000 });
    await managing.getByRole('button', { name: 'Удалить вид «Срочное на неделю»' }).click();
    await page.getByRole('button', { name: 'Удалить вид', exact: true }).click();
    await expect(managing.getByText('Видов не осталось')).toBeVisible({ timeout: 15_000 });
  });

  test('вид экрана сотрудника открывается из палитры команд', async ({ page }) => {
    await register(page, 'Проверяющий Палитру');
    await page.goto('/employee-work?view=all');
    await expect(page.getByRole('button', { name: 'Виды', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Виды', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Сохранить текущий вид…' }).click();
    const saving = page.getByRole('dialog', { name: 'Сохранить вид' });
    await saving.getByLabel('Название').fill('Вся моя работа');
    await saving.getByRole('button', { name: 'Сохранить' }).click();
    await expect(saving).toBeHidden({ timeout: 15_000 });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Командная палитра' });
    await palette.getByLabel('Поиск', { exact: true }).fill('Вся моя');
    await palette.getByText('Вид: Вся моя работа').click();
    // The person and the tab of the view are in the address again.
    await expect(page).toHaveURL(/\/employee-work\?.*view=all/, { timeout: 15_000 });
    await expect(page).toHaveURL(/user=/);
    await expect(page.getByRole('button', { name: 'Вся моя работа' })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('настройки проекта', () => {
  test('статус для новых задач выбирается в настройках, и форма показывает именно его', async ({ page }) => {
    await register(page, 'Проверяющий Настройки');
    const projectId = await createProject(page, 'Статус для новых');

    await page.goto(`/projects/${projectId}/settings`);
    await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('button', { name: 'Статусы' }).click();
    const backlog = page.getByLabel('Новые задачи попадают в «Бэклог»');
    await expect(backlog).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Новые задачи попадают в «К выполнению»')).toBeChecked();
    // A closing column cannot take new tasks.
    await expect(page.getByLabel('Новые задачи попадают в «Готово»')).toBeDisabled();
    await backlog.check();
    await expect(backlog).toBeChecked({ timeout: 15_000 });

    await page.goto(`/projects/${projectId}/list`);
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(form.getByRole('button', { name: 'Бэклог' })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('список проекта со спринтами', () => {
  test('задачи отправляются в спринт прямо из списка', async ({ page }) => {
    await register(page, 'Проверяющий Список');
    const projectId = await createProject(page, 'Спринт из списка', 'SCRUM');
    const sprint = await (
      await page.request.post(`/api/v1/projects/${projectId}/sprints`, { data: { name: 'Ближайший спринт' } })
    ).json();
    const first = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'В спринт из списка' } })).json();
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Останется в пуле' } });

    await page.goto(`/projects/${projectId}/list`);
    const row = (title: string) => page.getByRole('row').filter({ hasText: title });
    await expect(row('В спринт из списка')).toBeVisible({ timeout: 15_000 });
    await row('В спринт из списка').getByRole('checkbox').check();
    const bar = page.getByRole('region', { name: 'Массовые действия' });
    await bar.getByRole('button', { name: 'Спринт' }).click();
    await page.getByRole('menuitem', { name: 'Ближайший спринт' }).click();
    await expect(bar).toBeHidden({ timeout: 15_000 });

    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${first.id}`)).json()).sprintId, { timeout: 15_000 })
      .toBe(sprint.id);
  });
});

test.describe('экран сотрудника на телефоне', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('все четыре вкладки видны без прокрутки вбок', async ({ page }) => {
    await register(page, 'Мобильный Сотрудник');
    await page.goto('/employee-work');
    // «Все» used to sit past the right edge with nothing to say it was there.
    for (const name of [/^Активные/, /^Просроченные/, /^Завершённые/, /^Все$/]) {
      const tab = page.getByRole('button', { name });
      await expect(tab).toBeVisible({ timeout: 15_000 });
      const box = (await tab.boundingBox())!;
      expect(box.x, String(name)).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, String(name)).toBeLessThanOrEqual(390);
    }
  });
});

test.describe('распределение по неделям', () => {
  test('показывает, у кого сколько работы и когда она в срок; число открывает свой список', async ({ page }) => {
    await register(page, 'Плановик Недель');
    const projectId = await createProject(page, 'Недели');
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const me = session.user.id as string;
    // Today by the calendar of the machine the browser runs on: always inside the current week.
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T12:00:00.000Z`;
    const first = await (
      await page.request.post('/api/v1/issues', { data: { projectId, title: 'Срок сегодня', assigneeId: me, dueDate: today } })
    ).json();
    const second = await (
      await page.request.post('/api/v1/issues', { data: { projectId, title: 'Ждёт первую', assigneeId: me } })
    ).json();
    await page.request.post(`/api/v1/projects/${projectId}/dependencies`, {
      data: { predecessorId: first.id, successorId: second.id },
    });

    await page.goto('/planning');
    await page.getByRole('button', { name: 'По неделям' }).click();
    await expect(page).toHaveURL(/mode=weeks/);
    const table = page.getByRole('table', { name: 'Активные задачи сотрудников по неделям' });
    await expect(table.getByRole('link', { name: 'Плановик Недель: активные: 2' })).toBeVisible({ timeout: 15_000 });
    await expect(table.getByRole('link', { name: 'Плановик Недель: без срока: 1' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /эта неделя/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /следующая/ })).toBeVisible();

    // The figure of this week opens the list of exactly the tasks it counted.
    await table.locator('tbody tr').first().locator('td').nth(3).getByRole('link').click();
    await expect(page).toHaveURL(/\/employee-work\?.*dueAfter=/, { timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: 'Срок сегодня' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: 'Ждёт первую' })).toHaveCount(0);

    // Without the dates: the second task says in its row what it waits for.
    await page.goto('/employee-work');
    const waiting = page.getByRole('row').filter({ hasText: 'Ждёт первую' });
    await expect(waiting.getByText(`ждёт ${first.issueKey}`)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('шаблоны задач', () => {
  test('примеры добавляются в настройках, шаблон заполняет форму, подзадачи создаются вместе с задачей', async ({ page }) => {
    await register(page, 'Проверяющий Шаблоны');
    const projectId = await createProject(page, 'Шаблонный проект');

    // The administrator starts from the four examples rather than from a blank form.
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Шаблоны задач' }).click();
    await page.getByRole('button', { name: 'Добавить примеры' }).click();
    const list = page.getByRole('list', { name: 'Шаблоны задач' });
    await expect(list.getByRole('heading', { name: 'Подготовить ТЗ' })).toBeVisible({ timeout: 20_000 });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list.getByRole('listitem').filter({ hasText: 'Регулярная проверка' })).toContainText('повтор каждую неделю');

    // In the create form a template fills the fields; the text stays editable.
    await page.goto(`/projects/${projectId}/list`);
    await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByRole('button', { name: 'Шаблон', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Подготовить ТЗ' }).click();
    await expect(form.getByLabel('Название задачи')).toHaveValue('Подготовить ТЗ');
    await expect(form.getByText(/Вместе с задачей создадутся подзадачи/)).toContainText('Собрать требования');
    await expect(form.getByRole('button', { name: 'Шаблон: Подготовить ТЗ' })).toBeVisible();
    await form.getByLabel('Название задачи').fill('Подготовить ТЗ на стенд');
    await form.getByRole('button', { name: 'Создать и открыть' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    // The task opens with the three parts the template brought.
    for (const part of ['Собрать требования', 'Написать черновик', 'Согласовать с заказчиком']) {
      await expect(page.getByText(part).first()).toBeVisible({ timeout: 15_000 });
    }
  });
});
