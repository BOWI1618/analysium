import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Notifications: what one says in the list, and when it stops asking to be
 * read — as soon as the task it is about has been opened, whichever way.
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
  return { mate, context };
}

const says = (text: string) => ({
  data: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
});

test.describe('уведомления', () => {
  test('говорят, кто что сделал и в какой задаче; гаснут, когда задачу открыли', async ({ page, browser }) => {
    await register(page, 'Автор Задачи');
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const workspaceId = session.workspaces[0].id as string;
    const project = await (
      await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, {
        data: { name: 'Проект с уведомлениями', key: `N${unique().slice(-4).toUpperCase()}` },
      })
    ).json();
    const issue = await (
      await page.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Справочник для конструктора' } })
    ).json();
    const { mate, context } = await colleague(page, browser, 'Данил Отвечающий');
    const unread = async () =>
      (await (await page.request.get(`/api/v1/workspaces/${workspaceId}/notifications`)).json()).unreadCount as number;

    // The colleague answers in the task; its author hears of it.
    expect((await mate.request.post(`/api/v1/issues/${issue.id}/comments`, says('Шаблон будет к пятнице'))).status()).toBe(201);
    await page.goto('/inbox');
    const list = page.getByRole('list').filter({ hasText: 'Шаблон будет к пятнице' });
    const item = list.getByRole('button').filter({ hasText: 'Шаблон будет к пятнице' });
    await expect(item).toBeVisible({ timeout: 20_000 });
    // Who wrote, in which task, and what — without opening anything.
    await expect(item).toContainText(`Данил Отвечающий написал(а) в ${issue.issueKey}`);
    await expect(item).toContainText('Справочник для конструктора');
    await expect(item).toContainText('«Шаблон будет к пятнице»');
    await expect(item.getByLabel('не прочитано')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Уведомления, 1 непрочитанное' })).toBeVisible();

    // The task is opened by its address — not from the notification — and the answer is read there.
    await page.goto(`/issue/${issue.issueKey}`);
    await expect(page.getByText('Шаблон будет к пятнице')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Уведомления', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(unread, { timeout: 15_000 }).toBe(0);

    // While the task stays on the screen, what arrives about it is read as it arrives.
    expect((await mate.request.post(`/api/v1/issues/${issue.id}/comments`, says('И пример заполнения'))).status()).toBe(201);
    await expect(page.getByText('И пример заполнения')).toBeVisible({ timeout: 20_000 });
    await expect.poll(unread, { timeout: 20_000 }).toBe(0);
    await expect(page.getByRole('button', { name: 'Уведомления', exact: true })).toBeVisible();

    // In the list both are there, neither asking for attention any more.
    await page.goto('/inbox');
    await expect(page.getByText('«И пример заполнения»')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('не прочитано')).toHaveCount(0);

    await context.close();
  });

  test('на комментарий отвечают реакцией: ставится и снимается нажатием, коллега видит сразу', async ({ page, browser }) => {
    await register(page, 'Автор Комментария');
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const project = await (
      await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
        data: { name: 'Проект с реакциями', key: `E${unique().slice(-4).toUpperCase()}` },
      })
    ).json();
    const issue = await (
      await page.request.post('/api/v1/issues', { data: { projectId: project.id, title: 'Обсуждаемая задача' } })
    ).json();
    expect((await page.request.post(`/api/v1/issues/${issue.id}/comments`, says('Отчёт выложен'))).status()).toBe(201);
    const { mate, context } = await colleague(page, browser, 'Коллега Реагирующий');

    await page.goto(`/issue/${issue.issueKey}`);
    await mate.goto(`/issue/${issue.issueKey}`);
    const mine = page.getByRole('group', { name: 'Реакции' });
    const theirs = mate.getByRole('group', { name: 'Реакции' });
    await expect(theirs).toBeVisible({ timeout: 15_000 });

    // The colleague picks a sign from the row; it stands under the comment as theirs.
    await theirs.getByRole('button', { name: 'Добавить реакцию' }).click();
    await mate.getByRole('dialog', { name: 'Выбрать реакцию' }).getByRole('button', { name: 'Реакция 👍' }).click();
    const thumb = theirs.getByRole('button', { name: /^👍 1/ });
    await expect(thumb).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

    // The author sees it without reloading, with the name of who put it, and joins with a press.
    const authorThumb = mine.getByRole('button', { name: /^👍/ });
    await expect(authorThumb).toHaveAccessibleName('👍 1: Коллега Реагирующий', { timeout: 20_000 });
    await expect(authorThumb).toHaveAttribute('aria-pressed', 'false');
    await authorThumb.click();
    await expect(authorThumb).toHaveAccessibleName(/^👍 2: /, { timeout: 15_000 });
    await expect(authorThumb).toHaveAttribute('aria-pressed', 'true');

    // The same press takes one's own off; the colleague's stays.
    await authorThumb.click();
    await expect(authorThumb).toHaveAccessibleName('👍 1: Коллега Реагирующий', { timeout: 15_000 });
    // And when the colleague takes theirs off, the sign goes from under the comment.
    await thumb.click();
    await expect(theirs.getByRole('button', { name: /^👍/ })).toHaveCount(0, { timeout: 15_000 });
    await expect(mine.getByRole('button', { name: /^👍/ })).toHaveCount(0, { timeout: 20_000 });

    await context.close();
  });
});
