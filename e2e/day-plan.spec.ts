import { expect, test } from '@playwright/test';

test('план форматирует отдельную строку и открывает задачи в боковой карточке', async ({ page }, info) => {
  test.setTimeout(90_000);
  const signedIn = await page.request.post('/api/v1/auth/login', {
    data: { email: 'alex@acme.test', password: 'demo1234' },
  });
  expect(signedIn.ok()).toBeTruthy();
  const { activeWorkspaceId: workspaceId } = await signedIn.json();
  const title = `Проверка плана ${Date.now()}`;
  const created = await page.request.post('/api/v1/issues', { data: { workspaceId, title } });
  expect(created.ok()).toBeTruthy();
  const { issueKey } = await created.json();

  const date = `${2091 + info.retry}-01-15`;
  await page.goto(`/planning?mode=day-plan&date=${date}`);
  const editor = page.getByRole('textbox', { name: 'Текст плана' });
  await editor.fill('Первая строка');
  await editor.press('Shift+Enter');
  await page.keyboard.insertText('Пункт для проверки');
  await editor.press('Shift+Enter');
  await page.keyboard.insertText('Отдельная строка ниже');
  await editor.press('ArrowUp');
  await page.getByRole('button', { name: 'Чек-лист', exact: true }).click();

  await expect(editor.locator('ul[data-type="taskList"] li')).toHaveText(['Пункт для проверки']);
  await expect(editor.locator(':scope > p')).toHaveText(['Первая строка', 'Отдельная строка ниже']);

  await editor.press('Control+End');
  await editor.press('Enter');
  await page.keyboard.insertText('Первый в списке');
  await page.getByRole('button', { name: 'Маркированный список', exact: true }).click();
  await editor.press('Enter');
  await page.keyboard.insertText('Средний в списке');
  await editor.press('Enter');
  await page.keyboard.insertText('Последний в списке');
  await editor.press('ArrowUp');
  await page.getByRole('button', { name: 'Чек-лист', exact: true }).click();
  await expect(editor.locator('ul[data-type="taskList"] li')).toHaveText(['Пункт для проверки', 'Средний в списке']);
  await expect(editor.locator('ul:not([data-type]) li')).toHaveText(['Первый в списке', 'Последний в списке']);

  const taskPicker = page.getByRole('dialog', { name: 'Ссылка на задачу' });
  const searchTask = async () => {
    await page.getByRole('button', { name: 'Задача', exact: true }).click();
    await taskPicker.getByRole('textbox', { name: 'Поиск задачи' }).fill(title);
    await expect(taskPicker.getByRole('button', { name: title, exact: true })).toBeVisible();
  };
  const drawer = page.getByRole('dialog', { name: 'Детали задачи' });

  await searchTask();
  await taskPicker.getByRole('button', { name: `Открыть карточку: ${title}` }).click();
  await expect(drawer).toContainText(title);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await editor.press('Control+End');
  await editor.press('End');
  await page.keyboard.insertText(' ');
  await searchTask();
  await taskPicker.getByRole('button', { name: title, exact: true }).click();
  const draftLink = editor.getByRole('link', { name: title });
  await expect(draftLink).toHaveAttribute('href', `/issue/${issueKey}`);
  await draftLink.click();
  await expect(drawer).toContainText(title);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const publishedLink = page.getByRole('article').getByRole('link', { name: title });
  await publishedLink.click();
  await expect(drawer).toContainText(title);
  expect(page.context().pages()).toHaveLength(1);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить план', exact: true }).click();
  await expect(draftLink).toBeVisible();
  await page.getByRole('button', { name: 'Свернуть', exact: true }).click();
  await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
  await page.getByRole('dialog', { name: 'Снять план с публикации?' })
    .getByRole('button', { name: 'Снять с публикации', exact: true }).click();
  await expect(publishedLink).toHaveCount(0);
  await expect(draftLink).toBeVisible();
});
