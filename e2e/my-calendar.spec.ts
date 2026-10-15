import { expect, test } from '@playwright/test';

/**
 * «Календарь»: one's own tasks by the hour across projects. Only a task set
 * from one time to another within a day is on it; periods, whole days and
 * a bare deadline are planned elsewhere.
 */

test.use({ timezoneId: 'Europe/Moscow' });

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

test.describe('календарь', () => {
  test('показывает только задачи со временем начала и окончания в один день; задача закрывается галочкой', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Ваше имя').fill('Календарь Проверка');
    await page.getByLabel('Логин', { exact: true }).fill(`e2e-${unique()}@test.local`);
    await page.getByLabel('Пароль', { exact: true }).fill('password123');
    await page.getByLabel('Название пространства').fill('Команда E2E');
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Календарь', { timeout: 20_000 });

    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const me = session.user.id as string;
    const project = await (
      await page.request.post(`/api/v1/workspaces/${session.workspaces[0].id}/projects`, {
        data: { name: 'План дня', key: `K${unique().slice(-4).toUpperCase()}` },
      })
    ).json();

    // Today in Moscow, the zone the browser runs in.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(Date.now() + 86_400_000));
    const at = (day: string, time: string) => new Date(`${day}T${time}:00+03:00`).toISOString();
    const task = async (title: string, dates: Record<string, unknown>) =>
      (await (
        await page.request.post('/api/v1/issues', { data: { projectId: project.id, title, assigneeId: me, ...dates } })
      ).json()) as { issueKey: string };

    const slot = await task('Разобрать планы на день', {
      startDate: at(today, '09:00'),
      startHasTime: true,
      dueDate: at(today, '09:30'),
      dueHasTime: true,
    });
    await task('Весь день без времени', { dueDate: `${today}T12:00:00.000Z`, dueHasTime: false });
    await task('Только срок со временем', { dueDate: at(today, '15:00'), dueHasTime: true });
    await task('Долгая задача на два дня', {
      startDate: at(today, '10:00'),
      startHasTime: true,
      dueDate: at(tomorrow, '18:00'),
      dueHasTime: true,
    });

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Календарь/ }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await page.getByRole('radio', { name: 'День' }).click();

    const card = page.getByRole('button', { name: new RegExp(`^${slot.issueKey}: Разобрать планы на день, 09:00–09:30`) });
    await expect(card).toBeVisible({ timeout: 15_000 });
    for (const title of ['Весь день без времени', 'Только срок со временем', 'Долгая задача на два дня']) {
      await expect(page.getByText(title)).toHaveCount(0);
    }

    // Closed from here, by the statuses of the task's own project.
    await page.getByRole('button', { name: `Отметить выполненной ${slot.issueKey}` }).click();
    await expect(page.getByRole('button', { name: `Вернуть в работу ${slot.issueKey}` })).toBeVisible({ timeout: 15_000 });

    // The whole week is a column per day.
    await page.getByRole('radio', { name: 'Неделя' }).click();
    await expect(card).toBeVisible();
    await expect(page.getByText(/\d+ нед\./)).toBeVisible();
  });
});
