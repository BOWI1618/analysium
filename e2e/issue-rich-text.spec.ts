import { expect, test, type Locator, type Page } from '@playwright/test';

async function formatOneLine(page: Page, scope: Locator, editor: Locator, text: string) {
  await editor.fill(text);
  await editor.press('Shift+Enter');
  await page.keyboard.insertText('Строка вне списка');
  await editor.press('ArrowUp');
  await scope.getByRole('button', { name: 'Чек-лист', exact: true }).click();
  await expect(editor.locator('ul[data-type="taskList"] li')).toHaveText([text]);
  await expect(editor.locator(':scope > p')).toHaveText(['Строка вне списка']);
}

test('чек-листы в новой задаче, сохранённом описании и комментарии', async ({ page }) => {
  test.setTimeout(90_000);
  const login = await page.request.post('/api/v1/auth/login', { data: { email: 'alex@acme.test', password: 'demo1234' } });
  expect(login.ok()).toBeTruthy();
  const { activeWorkspaceId: workspaceId } = await login.json();
  const linkedTitle = `Связанная задача ${Date.now()}`;
  const linked = await page.request.post('/api/v1/issues', { data: { workspaceId, title: linkedTitle } });
  expect(linked.ok()).toBeTruthy();

  await page.goto('/my-work');
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новая задача' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Название задачи' }).fill('Задача с чек-листом');
  const draft = dialog.getByRole('textbox', { name: 'Описание задачи' });
  await formatOneLine(page, dialog, draft, 'Подготовить описание');
  const draftCheck = draft.getByRole('checkbox', { name: /Подготовить описание/ });
  await draftCheck.click();
  await expect(draftCheck).toBeChecked();

  const picker = page.getByRole('dialog', { name: 'Ссылка на задачу' });
  const search = async () => {
    await dialog.getByRole('button', { name: 'Задача', exact: true }).last().click();
    await picker.getByRole('textbox', { name: 'Поиск задачи' }).fill(linkedTitle);
  };
  await search();
  await picker.getByRole('button', { name: `Открыть карточку: ${linkedTitle}` }).click();
  const drawer = page.getByRole('dialog', { name: 'Детали задачи' });
  await expect(drawer).toContainText(linkedTitle);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(draftCheck).toBeChecked();

  await draft.press('Control+End');
  await page.keyboard.insertText(' ');
  await search();
  await picker.getByRole('button', { name: linkedTitle, exact: true }).click();
  await expect(draft.getByRole('link', { name: linkedTitle })).toBeVisible();

  const creation = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/issues' && res.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Создать и открыть', exact: true }).click();
  const saved = await creation;
  expect(saved.ok()).toBeTruthy();
  const { id, issueKey } = await saved.json();
  await page.goto(`/issue/${issueKey}`);
  const description = page.getByRole('textbox', { name: 'Описание задачи' });
  const savedCheck = description.getByRole('checkbox', { name: /Подготовить описание/ });
  await expect(savedCheck).toBeChecked();
  await savedCheck.click();
  // Read the server while the editor still has focus.
  await expect.poll(async () => {
    const issue = await (await page.request.get(`/api/v1/issues/${id}`)).json();
    return issue.description?.content?.[0]?.content?.[0]?.attrs?.checked;
  }).toBe(false);

  const discussion = page.getByRole('region', { name: 'Обсуждение' });
  const composer = page.getByRole('textbox', { name: 'Новый комментарий' });
  await formatOneLine(page, discussion, composer, 'Проверить комментарий');
  await discussion.getByRole('button', { name: 'Отправить' }).click();
  const commentCheck = page.getByRole('list', { name: 'Комментарии' }).getByRole('checkbox', { name: /Проверить комментарий/ });
  await expect(commentCheck).not.toBeChecked();
  await commentCheck.click();
  await expect(commentCheck).toBeChecked();
  await page.reload();
  await expect(savedCheck).not.toBeChecked();
  await expect(commentCheck).toBeChecked();
});
