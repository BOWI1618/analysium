import { buildTemplateDatabase } from './setup';

/** Once per run, before any test file: the schema every file's database is copied from. */
export default async function setup(): Promise<void> {
  await buildTemplateDatabase();
}
