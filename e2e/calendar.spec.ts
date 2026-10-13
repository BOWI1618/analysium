import { expect, test, type Page } from '@playwright/test';

/**
 * The project calendar: a week of day columns, a day by the hour, a month.
 * Tasks move between days by dragging, get a time from the hour they are
 * created at, and close with the checkbox on the card.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const wholeDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Date(`${ymd(d)}T12:00:00.000Z`).toISOString();
};

async function setup(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill('Календарь Командный');
  await page.getByLabel('Логин', { exact: true }).fill(`calendar-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByLabel('Название пространства').fill('Календарь');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Календарь', { timeout: 20_000 });
  const workspaceId = (await (await page.request.get('/api/v1/auth/session')).json()).workspaces[0].id;
  const project = await (
    await page.request.post(`/api/v1/workspaces/${workspaceId}/projects`, { data: { name: 'Планы', projectType: 'KANBAN' } })
  ).json();
  return project.id as string;
}

test.describe('календарь', () => {
  test('неделя: задача переносится на другой день и закрывается галочкой', async ({ page }) => {
    const projectId = await setup(page);
    // Monday of this week and the day after, so both columns are in the week on screen.
    const created = await page.request.post('/api/v1/issues', {
      data: { projectId, title: 'Сверить акты', dueDate: wholeDay(0) },
    });
    const issue = await created.json();
    await page.request.post('/api/v1/issues', { data: { projectId, title: 'Опорная задача', dueDate: wholeDay(new Date().getDay() === 0 ? -1 : 1) } });

    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'Неделя' }).click();
    const card = page.getByRole('button', { name: /Сверить акты/ });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.dragTo(page.getByRole('button', { name: /Опорная задача/ }));
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).dueDate, { timeout: 15_000 })
      .not.toBe(issue.dueDate);

    await page.getByRole('button', { name: `Отметить выполненной ${issue.issueKey}` }).click();
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).status.category, { timeout: 15_000 })
      .toBe('COMPLETED');
  });

  test('день по часам: клик по часу создаёт задачу с этим временем', async ({ page }) => {
    const projectId = await setup(page);
    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'День' }).click();
    await page.getByRole('button', { name: 'Следующий' }).or(page.getByRole('button', { name: 'Вперёд' })).first().click();

    // 09:00 on the hour grid: the grid opens at the start of the working day.
    const grid = page.locator('.cursor-cell').first();
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid.click({ position: { x: 200, y: 9 * 56 + 10 } });

    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(dialog.getByRole('button', { name: 'Срок', exact: true })).toContainText('10:00');
    await dialog.getByLabel('Название задачи').fill('Планёрка');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();

    const block = page.getByRole('button', { name: /Планёрка, 09:00–10:00/ });
    await expect(block).toBeVisible({ timeout: 15_000 });
    const box = await block.boundingBox();
    expect(Math.round(box!.height / 10)).toBe(Math.round((56 - 2) / 10));
  });

  test('без срока: задачу из панели можно поставить на час', async ({ page }) => {
    const projectId = await setup(page);
    const issue = await (await page.request.post('/api/v1/issues', { data: { projectId, title: 'Разобрать почту' } })).json();

    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'День' }).click();
    await page.getByRole('button', { name: 'Вперёд' }).click();
    await page.getByRole('button', { name: 'Без срока' }).click();
    const panel = page.getByRole('complementary', { name: 'Задачи без срока' });
    const card = panel.getByRole('button', { name: /Разобрать почту/ });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.dragTo(page.locator('.cursor-cell').first(), { targetPosition: { x: 200, y: 14 * 56 + 5 } });
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/issues/${issue.id}`)).json()).startHasTime, { timeout: 15_000 })
      .toBe(true);
    const placed = await (await page.request.get(`/api/v1/issues/${issue.id}`)).json();
    expect(new Date(placed.startDate).getHours()).toBe(14);
    expect(new Date(placed.dueDate).getHours()).toBe(15);
    await expect(panel.getByRole('button', { name: /Разобрать почту/ })).toHaveCount(0);
  });

  test('несколько дней выбираются в окне срока: первый день и последний', async ({ page }) => {
    const projectId = await setup(page);
    // Days of the next month, so the two are always in one grid whatever today is.
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const day = (n: number) => new Date(next.getFullYear(), next.getMonth(), n);
    const name = (n: number) =>
      day(n).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
    const stored = (n: number) => `${ymd(day(n))}T12:00:00.000Z`;

    await page.goto(`/projects/${projectId}/list`);
    await page.getByRole('button', { name: /Создать задачу/ }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByLabel('Название задачи').fill('Выездная проверка');
    const field = form.getByRole('button', { name: 'Срок', exact: true });
    await field.click();
    const picker = page.getByRole('dialog', { name: 'Срок: дата и время' });
    await picker.getByRole('button', { name: 'Следующий месяц' }).click();

    await picker.getByLabel('Несколько дней').check();
    await picker.getByRole('button', { name: name(10) }).click();
    await expect(picker.getByText('теперь выберите другой край')).toBeVisible();
    await picker.getByRole('button', { name: name(13) }).click();
    await expect(picker.getByText('4 дня')).toBeVisible();
    // Both ends and the days between them are marked; the day after is not.
    for (const n of [10, 11, 12, 13]) {
      await expect(picker.getByRole('button', { name: name(n) })).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(picker.getByRole('button', { name: name(14) })).toHaveAttribute('aria-pressed', 'false');
    await picker.getByRole('button', { name: 'Готово' }).click();
    // The field says the whole period, not only its last day.
    await expect(field).toContainText(/^10 .+ – 13 /);

    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/issues') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Создать', exact: true }).click();
    const issue = await (await created).json();
    expect(issue).toMatchObject({ startDate: stored(10), dueDate: stored(13), startHasTime: false, dueHasTime: false });

    // On the calendar the task lies across those days.
    await page.goto(`/projects/${projectId}/calendar`);
    await page.getByRole('radio', { name: 'Месяц' }).click();
    await page.getByRole('button', { name: 'Вперёд' }).click();
    await expect(page.getByRole('button', { name: /Выездная проверка/ }).first()).toBeVisible({ timeout: 15_000 });

    // In the card the same window opens on the period; the ends can be clicked in either order,
    // and without the tick the task is one day again.
    await page.goto(`/issue/${issue.issueKey}`);
    const due = page.getByRole('button', { name: 'Срок', exact: true });
    await expect(due).toContainText(/^10 .+ – 13 /, { timeout: 15_000 });
    await due.click();
    await expect(picker.getByLabel('Несколько дней')).toBeChecked();
    await picker.getByRole('button', { name: name(20) }).click();
    await picker.getByRole('button', { name: name(17) }).click();
    const read = async () => {
      const { startDate, dueDate } = await (await page.request.get(`/api/v1/issues/${issue.id}`)).json();
      return { startDate, dueDate };
    };
    await expect.poll(read, { timeout: 15_000 }).toEqual({ startDate: stored(17), dueDate: stored(20) });
    await picker.getByLabel('Несколько дней').uncheck();
    await expect.poll(read, { timeout: 15_000 }).toEqual({ startDate: null, dueDate: stored(20) });
    // One day again: a click moves the deadline, as it always did.
    await picker.getByRole('button', { name: name(22) }).click();
    await expect.poll(read, { timeout: 15_000 }).toEqual({ startDate: null, dueDate: stored(22) });
  });
});
