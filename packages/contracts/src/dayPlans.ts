import { z } from 'zod';
import type { UserSummaryDto } from './dto';
import type { RichDoc } from './richtext';

export const dayPlanDateSchema = z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/).refine((value) => {
  const day = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}, 'Укажите дату плана');

export const saveDayPlanSchema = z.object({
  content: z.object({ type: z.literal('doc') }).passthrough(),
  revision: z.number().int().positive().nullable(),
  publish: z.boolean(),
});

export const unpublishDayPlanSchema = z.object({ revision: z.number().int().positive() });

export type SaveDayPlanInput = z.infer<typeof saveDayPlanSchema>;

export interface DayPlanDraftDto {
  content: RichDoc;
  publishedContent: RichDoc | null;
  revision: number;
}

export interface PublishedDayPlanDto {
  id: string;
  author: UserSummaryDto;
  content: RichDoc;
}

export interface DayPlansDto {
  draft: DayPlanDraftDto | null;
  plans: PublishedDayPlanDto[];
}

export function dayPlanPath(workspaceId: string, date: string, id: string): string {
  return `/my-work?tab=day-plan&workspace=${encodeURIComponent(workspaceId)}&date=${encodeURIComponent(date)}&plan=${encodeURIComponent(id)}`;
}
