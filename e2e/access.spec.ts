import { expect, test, type Page } from '@playwright/test';

/**
 * Getting in and signing in on a closed installation: access is the owner's to
 * give, and the login a person signs in with is theirs to change.
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

test.describe('доступ и вход', () => {
  test('ссылки для входа видит только владелец; логин меняется в настройках и дальше входят по новому', async ({
    page,
    browser,
  }) => {
    await register(page, 'Владелец Доступа');

    // The owner lets an administrator in by a link.
    await page.goto('/settings/workspace?section=members');
    await expect(page.getByText('Выдать доступ')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Роль').first().selectOption({ label: 'администратор' });
    await page.getByRole('button', { name: 'Создать ссылку' }).click();
    const link = (await page.getByLabel('Ссылка для входа').textContent())!.trim();
    await expect(page.getByText('Действующие ссылки')).toBeVisible({ timeout: 15_000 });

    const oldLogin = `mate-${unique()}`;
    const context = await browser.newContext();
    const mate = await context.newPage();
    await mate.goto(link);
    // The link carries the code: the person is asked only who they are.
    await expect(mate.getByLabel('Код из ссылки')).toHaveCount(0);
    await mate.getByLabel('Ваше имя').fill('Админ Приглашённый');
    await mate.getByLabel('Логин', { exact: true }).fill(oldLogin);
    await mate.getByLabel('Пароль').fill(password);
    await mate.getByRole('button', { name: 'Присоединиться' }).click();
    await expect(mate.getByRole('heading', { level: 1 })).toContainText('Админ', { timeout: 20_000 });

    // An administrator manages the people who are in, but lets nobody in.
    await mate.goto('/settings/workspace?section=members');
    await expect(mate.getByLabel('Роль участника Владелец Доступа')).toHaveCount(0);
    await expect(mate.getByText(/Участники \(2\)/)).toBeVisible({ timeout: 15_000 });
    await expect(mate.getByText('Выдать доступ')).toHaveCount(0);
    await expect(mate.getByRole('button', { name: 'Создать ссылку' })).toHaveCount(0);
    const refused = await mate.request.post(
      `/api/v1/workspaces/${(await (await mate.request.get('/api/v1/auth/session')).json()).workspaces[0].id}/invite-codes`,
      { data: { role: 'GUEST' } },
    );
    expect(refused.status()).toBe(403);

    /* ------------------------------------------------------- a login of one's own */
    await mate.goto('/settings/account');
    await expect(mate.getByLabel('Текущий логин')).toHaveText(oldLogin, { timeout: 15_000 });
    await mate.getByRole('button', { name: 'Изменить логин' }).click();
    const newLogin = `Admin.New-${unique()}`;
    await mate.getByLabel('Новый логин').fill(newLogin);
    // Without the password the name of the account does not change.
    await mate.getByLabel('Пароль — для подтверждения').fill('not-the-password1');
    await mate.getByRole('button', { name: 'Сохранить логин' }).click();
    await expect(mate.getByText('Неверный пароль')).toBeVisible({ timeout: 15_000 });
    await mate.getByLabel('Пароль — для подтверждения').fill(password);
    await mate.getByRole('button', { name: 'Сохранить логин' }).click();
    await expect(mate.getByText('Логин изменён')).toBeVisible({ timeout: 15_000 });
    // Case does not tell logins apart: it is kept in small letters.
    await expect(mate.getByLabel('Текущий логин')).toHaveText(newLogin.toLowerCase());
    // The owner's list shows the new one too.
    await page.reload();
    await expect(page.getByText(newLogin.toLowerCase())).toBeVisible({ timeout: 15_000 });
    await context.close();

    // Signing in: the old login no longer opens the account, the new one does — typed in any case.
    const fresh = await browser.newContext();
    const again = await fresh.newPage();
    await again.goto('/login');
    await again.getByLabel('Логин', { exact: true }).fill(oldLogin);
    await again.getByLabel('Пароль').fill(password);
    await again.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(again.getByRole('alert')).toContainText('Неверный логин или пароль', { timeout: 15_000 });
    await again.getByLabel('Логин', { exact: true }).fill(newLogin.toUpperCase());
    await again.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(again.getByRole('heading', { level: 1 })).toContainText('Админ', { timeout: 20_000 });
    await fresh.close();
  });
});
