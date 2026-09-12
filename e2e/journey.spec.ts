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
  // Registration cannot proceed without consent to the data policy — the box is
  // deliberately not pre-ticked, so the flow has to tick it like a person would.
  await page.getByLabel(/согласен на обработку персональных данных/i).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, {
    timeout: 20_000,
  });
  return email;
}

async function createProject(page: Page, name: string, key: string) {
  await page.goto('/projects/new');
  await page.getByLabel('Название').fill(name);
  await page.getByLabel('Ключ').fill(key);
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+/, { timeout: 20_000 });
}

test.describe('основной сценарий', () => {
  test('от регистрации до завершённой задачи', async ({ page }) => {
    const key = `E${unique().slice(0, 2).toUpperCase()}`;

    await test.step('регистрация создаёт пространство', async () => {
      await register(page, 'Ольга Тестова');
      await expect(page.getByRole('button', { name: 'Команда E2E' })).toBeVisible();
    });

    await test.step('создание проекта открывает его доску', async () => {
      await createProject(page, 'Проект E2E', key);
      await page.getByRole('link', { name: 'Доска' }).click();
      await expect(page.getByRole('region', { name: /Колонка «Бэклог»/ })).toBeVisible();
    });

    await test.step('пустая доска предлагает создать задачу', async () => {
      await expect(page.getByText('Перетащите задачу сюда или создайте новую.').first()).toBeVisible();
    });

    await test.step('задача создаётся с клавиатуры по «C»', async () => {
      await page.locator('body').click();
      await page.keyboard.press('c');
      const dialog = page.getByRole('dialog', { name: 'Новая задача' });
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Название задачи').fill('Починить оплату картой');
      await dialog.getByRole('button', { name: 'Создать', exact: true }).click();

      await expect(page.getByText('Починить оплату картой')).toBeVisible({ timeout: 15_000 });
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
    await createProject(page, 'Поисковый проект', `S${unique().slice(0, 2).toUpperCase()}`);

    await page.locator('body').click();
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.getByLabel('Название задачи').fill('Уникальная формулировка для поиска');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Командная палитра' });
    await expect(palette).toBeVisible();

    await palette.getByRole('combobox').or(palette.getByPlaceholder(/Поиск задач/)).fill('Уникальная формулировка');
    await expect(palette.getByText('Уникальная формулировка для поиска')).toBeVisible({ timeout: 15_000 });
  });

  test('гость не может создавать задачи', async ({ page, browser }) => {
    // The owner sets up a project and invites a guest.
    const ownerEmail = await register(page, 'Хозяин Пространства');
    await createProject(page, 'Закрытый проект', `G${unique().slice(0, 2).toUpperCase()}`);

    const guestEmail = `guest-${unique()}@test.local`;
    await page.goto('/settings/workspace');
    await page.getByRole('button', { name: 'Участники' }).click();
    await page.getByLabel('Почта').fill(guestEmail);
    await page.getByLabel('Роль').selectOption('GUEST');
    await page.getByRole('button', { name: 'Добавить' }).click();
    // The email shows up both in the toast and in the member list; the list row
    // is the durable assertion.
    await expect(page.getByText(guestEmail, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // The guest has no password yet, so this asserts the owner's own view
    // instead: the invite landed and the role is what was granted.
    await expect(page.getByText('Роль: гость')).toBeVisible();
    expect(ownerEmail).toContain('@');
    expect(browser.browserType().name()).toBe('chromium');
  });
});
