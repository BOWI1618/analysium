/**
 * What each update of Analysium brought, newest first. After a deploy the
 * newest entry goes to everyone's notifications once (jobs/releaseNotes.ts).
 *
 * To announce an update, add an entry at the top with a new `id` — the date
 * is enough — and a few short lines in the users' words: what they can now
 * do, not how it was built.
 */
export interface Release {
  /** Unique and never reused: it is what marks the release as announced. */
  id: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    id: '2026-11-18',
    title: 'Обновление Анализиума: что нового',
    items: [
      'Подзадача открывается окном поверх задачи, окна можно перетаскивать за шапку.',
      'В списках и на карточках доски вместо номера задачи — название проекта или подпроекта.',
      'Во всех проектах есть метки МБО и ДИ.',
      'Флажок «ПГ» в задаче подсвечивает её в списках и на доске.',
      'Списки, доска и подзадачи идут по приоритету, внутри приоритета — по сроку.',
      'В «Моих задачах» и «Задачах сотрудника» появился вид «Канбан».',
      'Бэклог в проектах по умолчанию оранжевый.',
      'Сводка обновлений приходит в уведомления.',
    ],
  },
];

export function releaseBody(release: Release): string {
  return release.items.map((item) => `• ${item}`).join('\n');
}
