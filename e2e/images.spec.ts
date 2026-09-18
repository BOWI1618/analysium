import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Pictures in text: a screenshot pasted with Ctrl+V goes into the description
 * or a comment in place, is stored as a task file, and survives a reload —
 * including one pasted into a task that did not exist yet.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function setup(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill('Катя Скриншотова');
  await page.getByLabel('Рабочая почта').fill(`images-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByLabel('Название пространства').fill('Картинки');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  // The home page greets by first name once the account exists.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Катя', { timeout: 20_000 });
  const workspaceId = (await (await page.request.get('/api/v1/auth/session')).json()).workspaces[0].id;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, { data: { name: 'Сайт', projectType: 'KANBAN' } })
  ).json();
  return project.id as string;
}

/** What Ctrl+V with a screenshot on the clipboard delivers to the editor. */
async function pasteScreenshot(editor: Locator) {
  await editor.click();
  await editor.evaluate(async (element) => {
    // Runs in the browser; the e2e project is compiled without DOM types.
    const w = globalThis as any;
    const canvas = w.document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    const context = canvas.getContext('2d');
    context.fillStyle = '#005dac';
    context.fillRect(0, 0, 240, 120);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const data = new w.DataTransfer();
    data.items.add(new w.File([blob], 'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new w.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
}

const descriptionImages = async (page: Page, issueId: string) => {
  const issue = await (await page.request.get(`/api/v1/issues/${issueId}`)).json();
  return JSON.stringify(issue.description ?? {}).match(/\/api\/v1\/attachments\/[^"]+\/content/g) ?? [];
};

test.describe('картинки в тексте', () => {
  test('описание: скриншот вставляется из буфера и остаётся после перезагрузки', async ({ page }) => {
    const projectId = await setup(page);
    const issue = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Съехала шапка' } })).json();
    await page.goto(`/issue/${issue.issueKey}`);

    const description = page.locator('[data-editor]').first();
    await pasteScreenshot(description);
    await expect(description.locator('img')).toBeVisible({ timeout: 15_000 });

    // The description saves when the editor loses focus.
    await page.getByRole('heading', { name: /Файлы/ }).click();
    await expect.poll(() => descriptionImages(page, issue.id), { timeout: 15_000 }).toHaveLength(1);

    await page.reload();
    await expect(page.locator('[data-editor]').first().locator('img')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('screenshot.png')).toBeVisible();
  });

  test('новая задача: картинка, вставленная до создания, попадает в задачу', async ({ page }) => {
    const projectId = await setup(page);
    await page.goto(`/projects/${projectId}/board`);

    await page.getByRole('button', { name: 'Создать задачу' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.getByLabel('Название задачи').fill('Ошибка на оплате');
    await pasteScreenshot(dialog.locator('[data-editor]'));
    await expect(dialog.locator('[data-editor] img')).toBeVisible();
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();

    const created = async () =>
      ((await (await page.request.get(`/api/v1/projects/${projectId}/issues?limit=10`)).json()).items as { id: string }[])[0];
    await expect.poll(async () => (await created()) !== undefined, { timeout: 15_000 }).toBe(true);
    const { id } = (await created())!;
    await expect.poll(() => descriptionImages(page, id), { timeout: 15_000 }).toHaveLength(1);
  });

  test('комментарий из одной картинки отправляется', async ({ page }) => {
    const projectId = await setup(page);
    const issue = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Вот так выглядит' } })).json();
    await page.goto(`/issue/${issue.issueKey}`);

    await pasteScreenshot(page.locator('[data-editor]').nth(1));
    await expect(page.locator('[data-editor]').nth(1).locator('img')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();

    await expect(page.getByRole('list', { name: 'Комментарии' }).locator('img')).toBeVisible({ timeout: 15_000 });
  });
});
