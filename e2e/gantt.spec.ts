import { expect, test, type Page } from '@playwright/test';

/**
 * Gantt journey: schedule work, see it on the timeline, break a dependency by
 * dragging and be asked — not forced — to move the dependent task.
 */

const password = 'password123';
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Рабочая почта').fill(`gantt-${unique()}@test.local`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Название пространства').fill('Планирование');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]!, {
    timeout: 20_000,
  });
}

async function createProject(page: Page) {
  await page.goto('/projects/new');
  await page.getByLabel('Название').fill('План проекта');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  // `/projects/new` also matches a loose pattern — assert we actually navigated
  // to a created project, or a validation failure would leak "new" as the id.
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+/, { timeout: 20_000 });
  return new URL(page.url()).pathname.split('/')[2]!;
}

/** Creates an issue through the API using the browser's own session cookie. */
async function createScheduledIssue(
  page: Page,
  projectId: string,
  title: string,
  startDay: number,
  endDay: number,
) {
  const response = await page.request.post('/api/v1/issues', {
    data: {
      projectId,
      title,
      startDate: `2026-06-${String(startDay).padStart(2, '0')}T00:00:00.000Z`,
      dueDate: `2026-06-${String(endDay).padStart(2, '0')}T00:00:00.000Z`,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; issueKey: string };
}

test.describe('диаграмма Ганта', () => {
  test('показывает запланированную работу и связи', async ({ page }) => {
    await register(page, 'Галина Планова');
    const projectId = await createProject(page);

    const first = await createScheduledIssue(page, projectId, 'Подготовить макеты', 1, 5);
    const second = await createScheduledIssue(page, projectId, 'Свёрстать страницу', 6, 10);

    await test.step('пустая шкала объясняет, чего не хватает', async () => {
      const empty = await createProject(page);
      await page.goto(`/projects/${empty}/gantt`);
      await expect(page.getByText('Нечего показать на диаграмме')).toBeVisible({ timeout: 20_000 });
    });

    await test.step('задачи со сроками появляются на шкале', async () => {
      await page.goto(`/projects/${projectId}/gantt`);
      await expect(page.getByText('Декомпозиция')).toBeVisible({ timeout: 20_000 });

      // `data-bar-id` marks a drawn bar; the same title also appears in the
      // breakdown tree, so the attribute is what distinguishes them.
      await expect(page.locator(`[data-bar-id="${first.id}"]`)).toBeVisible();
      await expect(page.locator(`[data-bar-id="${second.id}"]`)).toBeVisible();
    });

    await test.step('связь создаётся через API и рисуется на диаграмме', async () => {
      const response = await page.request.post(
        `/api/v1/projects/${projectId}/dependencies`,
        { data: { predecessorId: first.id, successorId: second.id } },
      );
      expect(response.status()).toBe(201);

      await page.reload();
      // The link is drawn as an arrow between the two bars.
      await expect(page.locator(`[data-bar-id="${second.id}"]`)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('svg polygon').first()).toBeAttached();
    });

    await test.step('цикл отклоняется сервером', async () => {
      const response = await page.request.post(
        `/api/v1/projects/${projectId}/dependencies`,
        { data: { predecessorId: second.id, successorId: first.id } },
      );
      expect(response.status()).toBe(400);
      expect(await response.text()).toContain('цикл');
    });

    await test.step('масштаб переключается', async () => {
      await page.getByRole('radio', { name: 'Месяц', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Месяц', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  });

  test('перенос предлагает сдвинуть зависимые задачи', async ({ page }) => {
    await register(page, 'Роман Сдвигов');
    const projectId = await createProject(page);

    const first = await createScheduledIssue(page, projectId, 'Первый этап', 1, 3);
    const second = await createScheduledIssue(page, projectId, 'Второй этап', 4, 8);

    await page.request.post(`/api/v1/projects/${projectId}/dependencies`, {
      data: { predecessorId: first.id, successorId: second.id },
    });

    // Moving the predecessor past its successor must ask before touching it.
    const response = await page.request.post(
      `/api/v1/issues/${first.id}/reschedule`,
      {
        data: {
          startDate: '2026-06-10T00:00:00.000Z',
          dueDate: '2026-06-14T00:00:00.000Z',
          cascade: false,
        },
      },
    );
    const body = await response.json();
    expect(body.suggestedShifts).toHaveLength(1);
    expect(body.appliedShifts).toBe(0);

    await page.goto(`/projects/${projectId}/gantt`);
    await expect(page.locator(`[data-bar-id="${second.id}"]`)).toBeVisible({ timeout: 20_000 });
  });
});
