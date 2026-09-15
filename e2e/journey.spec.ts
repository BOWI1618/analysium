import { expect, test, type Page } from '@playwright/test';

/**
 * The core journey the product is judged on:
 * register → workspace → project → create issue → assign → move through
 * statuses → comment → complete.
 *
 * It runs against the real API and database, so a regression anywhere in the
 * stack (permissions, ranking, activity, realtime cache updates) shows up here.
 */

const password = 'password123';
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function register(page: Page, name: string) {
  const email = `e2e-${unique()}@test.local`;

  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Рабочая почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Название пространства').fill('Команда E2E');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, {
    timeout: 20_000,
  });
  return email;
}

async function createProject(page: Page, name: string) {
  await page.goto('/projects/new');
  await page.getByLabel('Название').fill(name);
  // Not the default icon: names longer than eight characters were once refused.
  await page.getByRole('button', { name: 'Иконка «Сообщение»' }).click();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  // `/projects/new` itself matches a bare `/projects/<segment>` pattern, which
  // let this wait succeed before the redirect — exclude it explicitly.
  await expect(page).toHaveURL(/\/projects\/(?!new(?:[/?]|$))[^/?]+/, { timeout: 20_000 });
}

test.describe('основной сценарий', () => {
  test('от регистрации до завершённой задачи', async ({ page }) => {
    await test.step('регистрация создаёт пространство', async () => {
      await register(page, 'Ольга Тестова');
      await expect(page.getByRole('button', { name: 'Команда E2E' })).toBeVisible();
    });

    await test.step('создание проекта открывает его доску', async () => {
      await createProject(page, 'Проект E2E');
      await page.getByRole('link', { name: 'Доска' }).click();
      await expect(page.getByRole('region', { name: /Колонка «Бэклог»/ })).toBeVisible();
    });

    await test.step('пустая доска предлагает создать задачу', async () => {
      await expect(page.getByText('Перетащите задачу сюда или создайте новую.').first()).toBeVisible();
    });

    await test.step('задача создаётся с клавиатуры по Ctrl+Alt+N', async () => {
      await page.locator('body').click();
      await page.keyboard.press('Control+Alt+n');
      const dialog = page.getByRole('dialog', { name: 'Новая задача' });
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Название задачи').fill('Починить оплату картой');
      await dialog.getByRole('button', { name: 'Создать', exact: true }).click();

      // The card itself, not the "created" toast that repeats the title.
      await expect(page.getByLabel(/-1: Починить оплату картой$/)).toBeVisible({ timeout: 15_000 });
    });

    await test.step('карточка открывается и назначается на себя', async () => {
      await page.getByRole('button', { name: /Починить оплату картой/ }).first().click();
      const panel = page.getByRole('dialog', { name: 'Детали задачи' });
      await expect(panel).toBeVisible();

      await panel.getByRole('button', { name: 'Изменить исполнителя' }).first().click();
      await page.getByRole('menuitem', { name: /Ольга/ }).first().click();
      await expect(panel.getByText('Ольга Тестова').first()).toBeVisible();
    });

    await test.step('статус меняется и попадает в историю', async () => {
      const panel = page.getByRole('dialog', { name: 'Детали задачи' });

      await panel.getByRole('button', { name: 'Изменить статус' }).first().click();
      await page.getByRole('menuitem', { name: 'В работе' }).click();
      await expect(panel.getByText('В работе').first()).toBeVisible();

      await panel.getByRole('tab', { name: 'История' }).click();
      await expect(panel.getByText(/сменил\(а\) статус/)).toBeVisible();
    });

    await test.step('комментарий сохраняется', async () => {
      const panel = page.getByRole('dialog', { name: 'Детали задачи' });
      await panel.getByRole('tab', { name: 'Комментарии' }).click();

      const editor = panel.locator('.ProseMirror').last();
      await editor.click();
      await editor.fill('Воспроизвёл на стенде, чиню.');

      await panel.getByRole('button', { name: 'Отправить' }).click();
      // Scoped to the posted list: for a moment after the click the same text
      // also sits in the draft editor, which would make a panel-wide lookup
      // ambiguous rather than merely slow.
      const posted = panel.getByRole('list', { name: 'Комментарии' });
      await expect(posted.getByText('Воспроизвёл на стенде, чиню.')).toBeVisible({ timeout: 15_000 });
    });

    await test.step('задача завершается и уходит в «Готово»', async () => {
      const panel = page.getByRole('dialog', { name: 'Детали задачи' });
      await panel.getByRole('button', { name: 'Изменить статус' }).first().click();
      await page.getByRole('menuitem', { name: 'Готово' }).click();

      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();

      const doneColumn = page.getByRole('region', { name: /Колонка «Готово»/ });
      await expect(doneColumn.getByText('Починить оплату картой')).toBeVisible({ timeout: 15_000 });
    });

    await test.step('завершённая задача видна в аналитике', async () => {
      await page.getByRole('link', { name: 'Аналитика' }).click();
      await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible();
      await expect(page.getByText('Завершено').first()).toBeVisible();
    });
  });

  test('поиск находит задачу по названию', async ({ page }) => {
    await register(page, 'Пётр Поиск');
    await createProject(page, 'Поисковый проект');

    await page.locator('body').click();
    await page.keyboard.press('Control+Alt+n');
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.getByLabel('Название задачи').fill('Уникальная формулировка для поиска');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Командная палитра' });
    await expect(palette).toBeVisible();

    await palette.getByLabel('Поиск', { exact: true }).fill('Уникальная формулировка');
    await expect(palette.getByText('Уникальная формулировка для поиска')).toBeVisible({ timeout: 15_000 });
  });

  test('гость не может создавать задачи', async ({ page, browser }) => {
    // The owner sets up a project and invites a guest.
    await register(page, 'Хозяин Пространства');
    await createProject(page, 'Закрытый проект');
    const projectId = new URL(page.url()).pathname.split('/')[2]!;

    const guestEmail = `guest-${unique()}@test.local`;
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Участники' }).click();
    await page.getByLabel('Роль').first().selectOption('GUEST');
    await page.getByRole('button', { name: 'Создать код' }).click();

    // The code is shown once, on creation — the only moment it exists in plain.
    const codeBox = page.getByLabel('Код приглашения');
    await expect(codeBox).toBeVisible({ timeout: 15_000 });
    const code = (await codeBox.textContent())!.trim();

    // The guest joins from a browser of their own, choosing their own details.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto('/join');
    await guest.getByLabel('Код приглашения').fill(code);
    await guest.getByLabel('Ваше имя').fill('Гость Пространства');
    await guest.getByLabel('Почта для входа').fill(guestEmail);
    await guest.getByLabel('Пароль').fill('guest12345');
    await guest.getByRole('button', { name: 'Присоединиться' }).click();
    await expect(guest.getByRole('heading', { level: 1 })).toContainText('Гость', { timeout: 20_000 });

    // Signed in, but a guest outside the project must not be able to add work
    // to it. Asserted against the API, which is where the rule is enforced.
    const attempt = await guest.request.post('/api/v1/issues', {
      headers: { 'x-requested-with': 'flowdesk' },
      data: { projectId, title: 'Не должно создаться' },
    });
    expect([403, 404]).toContain(attempt.status());

    await guestContext.close();
  });
});

test.describe('первый запуск без демо-данных', () => {
  test('новое пространство без проектов: задача назначается коллеге и он работает с ней', async ({
    page,
    browser,
  }) => {
    // A brand-new workspace, exactly as on a real server: no projects, nobody else.
    await register(page, 'Владелец Команды');

    // Code for a teammate.
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Участники' }).click();
    await page.getByRole('button', { name: 'Создать код' }).click();
    const code = (await page.getByLabel('Код приглашения').textContent())!.trim();

    // The teammate joins from their own browser.
    const mateEmail = `mate-${unique()}@test.local`;
    const mateContext = await browser.newContext();
    const mate = await mateContext.newPage();
    await mate.goto('/join');
    await mate.getByLabel('Код приглашения').fill(code);
    await mate.getByLabel('Ваше имя').fill('Коллега Второй');
    await mate.getByLabel('Почта для входа').fill(mateEmail);
    await mate.getByLabel('Пароль').fill(password);
    await mate.getByRole('button', { name: 'Присоединиться' }).click();
    await expect(mate.getByRole('heading', { level: 1 })).toContainText('Коллега', { timeout: 20_000 });

    // Still no project anywhere. The owner creates a task and assigns it to
    // the teammate — both used to be impossible: a task needed a project, and
    // only a project's explicit roster was offered as assignees.
    await page.goto('/');
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const create = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(create.getByLabel('Проект')).toHaveValue('');
    await create.getByLabel('Название задачи').fill('Задача для коллеги');
    await create.getByRole('button', { name: 'Исполнитель' }).click();
    await page.getByRole('menuitem', { name: /Коллега Второй/ }).click();
    // A label that does not exist yet is created right from the label list.
    await create.getByRole('button', { name: 'Метки' }).click();
    await page.getByPlaceholder('Найти или создать…').fill('срочно');
    await page.getByPlaceholder('Найти или создать…').press('Enter');
    await expect(page.getByRole('menuitem', { name: 'срочно' })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(create.getByText('срочно')).toBeVisible();
    await expect(create.getByPlaceholder('Оценка')).toHaveCount(0);
    await create.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(create).toBeHidden({ timeout: 15_000 });

    // Tasks without a project have a home of their own in the sidebar.
    await expect(page.getByRole('link', { name: /Без проекта/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Its labels are managed like any project's: settings hold only statuses and labels.
    await page.getByRole('link', { name: /Без проекта/ }).first().click();
    await page.getByRole('link', { name: 'Настройки' }).click();
    await expect(page.getByRole('button', { name: 'Основное' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Статусы' })).toBeVisible();
    // The only label here is the one created from the task form: no starter set.
    await expect(page.getByRole('button', { name: /^Удалить метку/ })).toHaveCount(1);
    await page.getByLabel('Новая метка').fill('временная');
    await page.getByRole('button', { name: 'Добавить метку' }).click();
    await page.getByRole('button', { name: 'Удалить метку «временная»' }).click();
    await expect(page.getByRole('button', { name: 'Удалить метку «временная»' })).toBeHidden({ timeout: 15_000 });

    // The teammate finds it in their own work and moves it on.
    await mate.goto('/my-work');
    await mate.getByText('Задача для коллеги').click();
    await expect(mate.getByRole('button', { name: 'Изменить метки' })).toContainText('срочно');
    await mate.getByRole('button', { name: 'Изменить статус' }).click();
    await mate.getByRole('menuitem', { name: 'В работе' }).click();
    await expect(mate.getByRole('button', { name: 'Изменить статус' })).toContainText('В работе', {
      timeout: 15_000,
    });

    // They can talk about it…
    // The comment editor is the last rich-text field in the issue.
    await mate.locator('[contenteditable="true"]').last().click();
    await mate.keyboard.type('Взял в работу, сегодня сделаю');
    await mate.getByRole('button', { name: 'Отправить' }).click();
    await expect(mate.getByRole('list', { name: 'Комментарии' }).getByText('Взял в работу, сегодня сделаю')).toBeVisible({
      timeout: 15_000,
    });

    // …and add work of their own.
    await mate.keyboard.press('Escape');
    await mate.getByRole('button', { name: /Создать задачу/ }).first().click();
    const mateCreate = mate.getByRole('dialog', { name: 'Новая задача' });
    await mateCreate.getByLabel('Название задачи').fill('Задача от коллеги');
    await mateCreate.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(mateCreate).toBeHidden({ timeout: 15_000 });

    await mateContext.close();
  });
});

test.describe('сброс пароля', () => {
  test('администратор сбрасывает пароль, человек входит без него и задаёт новый', async ({ page, browser }) => {
    await register(page, 'Админ Сброса');
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Участники' }).click();
    await page.getByRole('button', { name: 'Создать код' }).click();
    const code = (await page.getByLabel('Код приглашения').textContent())!.trim();

    const mateEmail = `forgot-${unique()}@test.local`;
    const mateContext = await browser.newContext();
    const mate = await mateContext.newPage();
    await mate.goto('/join');
    await mate.getByLabel('Код приглашения').fill(code);
    await mate.getByLabel('Ваше имя').fill('Забыл Пароль');
    await mate.getByLabel('Почта для входа').fill(mateEmail);
    await mate.getByLabel('Пароль').fill(password);
    await mate.getByRole('button', { name: 'Присоединиться' }).click();
    await expect(mate.getByRole('heading', { level: 1 })).toContainText('Забыл', { timeout: 20_000 });

    await page.reload();
    await page.getByRole('button', { name: 'Участники' }).click();
    await page.getByRole('button', { name: 'Сбросить пароль: Забыл Пароль' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Сбросить пароль' }).click();
    await expect(page.getByText('Пароль сброшен').first()).toBeVisible({ timeout: 15_000 });

    // Signed out on their device; the address alone gets them in.
    await mate.goto('/login');
    await mate.getByLabel('Почта').fill(mateEmail);
    await mate.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(mate.getByRole('heading', { name: 'Новый пароль' })).toBeVisible({ timeout: 15_000 });
    await mate.getByLabel('Новый пароль').fill('fresh12345');
    await mate.getByLabel('Повторите пароль').fill('fresh12345');
    await mate.getByRole('button', { name: 'Сохранить и войти' }).click();
    await expect(mate.getByRole('heading', { level: 1 })).toContainText('Забыл', { timeout: 20_000 });

    // And the new password is the one that works from now on.
    const fresh = await browser.newContext();
    const again = await fresh.newPage();
    await again.goto('/login');
    await again.getByLabel('Почта').fill(mateEmail);
    await again.getByLabel('Пароль').fill('fresh12345');
    await again.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(again.getByRole('heading', { level: 1 })).toContainText('Забыл', { timeout: 20_000 });

    await fresh.close();
    await mateContext.close();
  });
});

test.describe('перенос задачи', () => {
  test('задача без проекта переносится в проект и получает его номер', async ({ page }) => {
    await register(page, 'Перенос Задач');

    // A task without a project, created from the API with the page's session.
    const workspaceId = (await (await page.request.get('/api/v1/auth/session')).json()).workspaces[0].id;
    const created = await page.request.post('/api/v1/issues', {
      data: { workspaceId, title: 'Потом разберёмся куда' },
    });
    const task = await created.json();

    await createProject(page, 'Алабуга Старт');
    const projectId = new URL(page.url()).pathname.split('/')[2]!;

    await page.goto(`/projects/${task.projectId}/list`);
    await page.getByText('Потом разберёмся куда').click();
    const panel = page.getByRole('dialog', { name: 'Детали задачи' });
    await panel.getByLabel('Перенести в проект').selectOption({ label: 'Алабуга Старт' });

    const ask = page.getByRole('dialog', { name: /Перенести .* в «Алабуга Старт»\?/ });
    await expect(ask).toContainText('Старая ссылка на задачу продолжит работать');
    const transferred = page.waitForResponse((r) => r.url().includes('/transfer'));
    await ask.getByRole('button', { name: 'Перенести' }).click();
    const reply = await transferred;
    expect(reply.status(), await reply.text()).toBe(200);

    await expect(page.getByText('Новый номер: AS-1')).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByLabel('Перенести в проект')).toHaveValue(projectId);
    await expect(panel.getByText('AS-1').first()).toBeVisible();

    // It lives in the project now, and the old key still opens it.
    await page.keyboard.press('Escape');
    await page.goto(`/projects/${projectId}/list`);
    await expect(page.getByText('Потом разберёмся куда')).toBeVisible({ timeout: 15_000 });
    await page.goto(`/issue/${task.issueKey}`);
    await expect(page.getByText('Потом разберёмся куда').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('подзадачи и спринты', () => {
  test('подзадачи раскрываются в списке, из подзадачи есть путь назад, спринты включаются переключателем', async ({ page }) => {
    await register(page, 'Главный По Подзадачам');
    await createProject(page, 'Разбор задач');
    const projectId = new URL(page.url()).pathname.split('/')[2]!;
    const me = (await (await page.request.get('/api/v1/auth/session')).json()).user.id;

    const parent = await (
      await page.request.post('/api/v1/issues', { data: { projectId, title: 'Большая задача' } })
    ).json();
    await page.request.post('/api/v1/issues', {
      data: { projectId, title: 'Кусочек работы', type: 'SUBTASK', parentId: parent.id, assigneeId: me },
    });

    await test.step('в списке подзадача разворачивается под задачей', async () => {
      await page.goto(`/projects/${projectId}/list`);
      await expect(page.getByText('Большая задача')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Кусочек работы')).toHaveCount(0);
      await page.getByRole('button', { name: `Показать подзадачи ${parent.issueKey}` }).click();
      const group = page.getByRole('rowgroup', { name: `Подзадачи ${parent.issueKey}` });
      await expect(group.getByText('Кусочек работы')).toBeVisible();
      await page.getByRole('button', { name: `Свернуть подзадачи ${parent.issueKey}` }).click();
      await expect(page.getByText('Кусочек работы')).toHaveCount(0);
    });

    await test.step('из подзадачи можно вернуться к задаче', async () => {
      await page.getByRole('button', { name: `Показать подзадачи ${parent.issueKey}` }).click();
      await page.getByText('Кусочек работы').click();
      const panel = page.getByRole('dialog', { name: 'Детали задачи' });
      await panel.getByRole('button', { name: /Подзадача задачи/ }).click();
      await expect(panel.getByRole('heading', { name: 'Большая задача' }).or(panel.getByText('Большая задача').first())).toBeVisible();
      await expect(panel.getByRole('button', { name: /Подзадача задачи/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    await test.step('подзадача, назначенная мне, видна в «Моих задачах» с ключом задачи', async () => {
      await page.goto('/my-work');
      await expect(page.getByText('Кусочек работы')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(`${parent.issueKey} ›`)).toBeVisible();
    });

    await test.step('если задача тоже в списке, подзадача не повторяется отдельной строкой', async () => {
      await page.request.patch(`/api/v1/issues/${parent.id}`, { data: { assigneeId: me } });
      await page.reload();
      await expect(page.getByText('Большая задача')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Кусочек работы')).toHaveCount(0);
      await page.getByRole('button', { name: `Показать подзадачи ${parent.issueKey}` }).click();
      await expect(page.getByText('Кусочек работы')).toHaveCount(1);
    });

    await test.step('спринты включаются в настройках проекта', async () => {
      await page.goto(`/projects/${projectId}/settings`);
      await expect(page.getByRole('link', { name: 'Бэклог' })).toHaveCount(0);
      await page.getByLabel('Работать спринтами').check();
      await page.getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByRole('link', { name: 'Бэклог' })).toBeVisible({ timeout: 15_000 });
    });
  });
});

test.describe('несохранённые данные', () => {
  test('закрытие формы с введёнными данными спрашивает, пустая закрывается сразу', async ({ page }) => {
    await register(page, 'Осторожный Пользователь');

    await test.step('новая задача: Escape и «Отмена» спрашивают', async () => {
      const create = page.getByRole('dialog', { name: 'Новая задача' });
      const ask = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });

      // Nothing typed: closes without a question.
      await page.getByRole('button', { name: 'Создать задачу' }).first().click();
      await expect(create).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(create).toBeHidden();

      await page.getByRole('button', { name: 'Создать задачу' }).first().click();
      await create.getByLabel('Название задачи').fill('Черновик, который жалко');
      await page.keyboard.press('Escape');
      await expect(ask).toBeVisible();
      await expect(ask).toContainText('Введённые данные не сохранятся.');
      await ask.getByRole('button', { name: 'Продолжить' }).click();
      await expect(ask).toBeHidden();
      await expect(create.getByLabel('Название задачи')).toHaveValue('Черновик, который жалко');

      await create.getByRole('button', { name: 'Отмена' }).click();
      await ask.getByRole('button', { name: 'Не сохранять' }).click();
      await expect(create).toBeHidden();
    });

    await test.step('новый проект: уход со страницы спрашивает', async () => {
      await page.goto('/projects/new');
      await page.getByLabel('Название').fill('Незаконченный проект');
      await page.getByRole('link', { name: /Главная/ }).click();
      const ask = page.getByRole('dialog', { name: 'Уйти без сохранения?' });
      await ask.getByRole('button', { name: 'Остаться' }).click();
      await expect(page).toHaveURL(/\/projects\/new$/);
      await expect(page.getByLabel('Название')).toHaveValue('Незаконченный проект');

      await page.getByRole('link', { name: /Главная/ }).click();
      await ask.getByRole('button', { name: 'Уйти' }).click();
      await expect(page).toHaveURL(/\/$/);
    });

    await test.step('созданный проект открывается без вопросов', async () => {
      await createProject(page, 'Готовый проект');
    });

    await test.step('недописанный комментарий не теряется при закрытии задачи', async () => {
      const response = await page.request.post('/api/v1/issues', {
        data: { projectId: new URL(page.url()).pathname.split('/')[2], title: 'Задача с черновиком' },
      });
      const issue = await response.json();
      await page.goto(`/projects/${issue.projectId}/list`);
      await page.getByText('Задача с черновиком').click();
      const panel = page.getByRole('dialog', { name: 'Детали задачи' });
      await panel.locator('[contenteditable="true"]').last().click();
      await page.keyboard.type('Ещё думаю');
      await page.keyboard.press('Escape');
      const ask = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });
      await ask.getByRole('button', { name: 'Продолжить' }).click();
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Ещё думаю')).toBeVisible();

      await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await ask.getByRole('button', { name: 'Не сохранять' }).click();
      await expect(panel).toBeHidden();
    });
  });
});

test.describe('мобильная версия', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('боковое меню закрывается после перехода', async ({ page }) => {
    await register(page, 'Мобильный Пользователь');

    await page.getByRole('button', { name: 'Открыть меню' }).tap();
    const closeMenu = page.getByRole('button', { name: 'Закрыть меню' });
    await expect(closeMenu).toBeVisible();

    // A link in the drawer navigates and must take the drawer away with it —
    // it used to stay open on top of the page it had just opened.
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Мои задачи/ }).tap();
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(closeMenu).toBeHidden();

    // The case from the bug report: settings opened from the workspace menu
    // inside the drawer. Menu items navigate in code, not through a link, and
    // that path left the drawer open over the settings page.
    await page.getByRole('button', { name: 'Открыть меню' }).tap();
    await expect(closeMenu).toBeVisible();
    await page.getByRole('button', { name: /пространство/ }).first().tap();
    await page.getByRole('menuitem', { name: 'Настройки пространства' }).tap();
    await expect(page).toHaveURL(/\/settings\/workspace$/);
    await expect(closeMenu).toBeHidden();

    // And the explicit close button works on its own.
    await page.getByRole('button', { name: 'Открыть меню' }).tap();
    await expect(closeMenu).toBeVisible();
    await closeMenu.tap();
    await expect(closeMenu).toBeHidden();
  });
});
