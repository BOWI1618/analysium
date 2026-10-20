import { expect, test, type Page } from '@playwright/test';

/**
 * An answer to a comment, quoted as in a messenger, and a list put in order
 * by a press on a column's name.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function setup(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Логин', { exact: true }).fill(`e2e-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByLabel('Название пространства').fill('Команда E2E');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, { timeout: 20_000 });
  const workspaceId = (await (await page.request.get('/api/v1/auth/session')).json()).workspaces[0].id;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, { data: { name: 'Кадры', projectType: 'KANBAN' } })
  ).json();
  return project.id as string;
}

test.describe('ответ на комментарий', () => {
  test('«Ответить» цитирует комментарий над ответом; цитата ведёт к исходному', async ({ page }) => {
    const projectId = await setup(page, 'Булат Отвечающий');
    const issue = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Выгрузка в кадровый' } })).json();
    await page.request.post(`/api/v1/issues/${issue.id}/comments`, {
      data: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Срок пока перенёс с 19 на 23' }] }] } },
    });
    await page.goto(`/issue/${issue.issueKey}`);

    const comments = page.getByRole('list', { name: 'Комментарии' });
    await comments.getByRole('button', { name: 'Ответить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ответ: Булат Отвечающий' })).toContainText('Срок пока перенёс');

    await page.locator('.ProseMirror').last().fill('Принято');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();

    const answer = comments.getByRole('listitem').last();
    await expect(answer).toContainText('Принято', { timeout: 15_000 });
    const quote = answer.getByRole('button', { name: /Срок пока перенёс с 19 на 23/ });
    await expect(quote).toBeVisible();
    // Sent: the composer no longer answers anyone.
    await expect(page.getByRole('status').filter({ hasText: 'Ответ:' })).toHaveCount(0);

    // Kept by the server, not only drawn after sending.
    await page.reload();
    await expect(comments.getByRole('listitem').last().getByRole('button', { name: /Срок пока перенёс/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('сортировка по колонкам', () => {
  test('щелчок по названию колонки сортирует список, второй — разворачивает порядок', async ({ page }) => {
    const projectId = await setup(page, 'Роберт Сортирующий');
    for (const title of ['Бета', 'Альфа', 'Гамма']) {
      await page.request.post('/api/v1/issues', { data: { projectId, title } });
    }
    await page.goto(`/projects/${projectId}/list`);

    const titles = () =>
      page
        .getByRole('row')
        .filter({ hasText: /^(?!.*Задача).*(Альфа|Бета|Гамма)/ })
        .allTextContents()
        .then((rows) => rows.map((row) => row.match(/Альфа|Бета|Гамма/)![0]));

    await page.getByRole('button', { name: 'Сортировать по колонке «Задача»' }).click();
    await expect.poll(titles, { timeout: 15_000 }).toEqual(['Альфа', 'Бета', 'Гамма']);
    await expect(page).toHaveURL(/sort=title/);

    await page.getByRole('button', { name: /Сортировать по колонке «Задача», по возрастанию/ }).click();
    await expect.poll(titles, { timeout: 15_000 }).toEqual(['Гамма', 'Бета', 'Альфа']);
    await expect(page.getByRole('button', { name: /«Задача», по убыванию/ })).toBeVisible();
  });
});
