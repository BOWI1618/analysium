/**
 * Background job: listens to the Telegram bot.
 *
 * Long polling rather than a webhook: the server asks Telegram for new
 * messages and waits on the answer, so nothing has to be reachable from
 * outside and the same code runs on a laptop and behind the production proxy.
 * The price is that one bot can be listened to by one server only — a second
 * listener gets «409 Conflict» — which is why development uses its own bot.
 */
import { appOrigin } from '../config/env';
import { log } from '../lib/logger';
import { TelegramError, telegram, telegramEnabled, type TelegramApi } from '../lib/telegram';
import { handleUpdate } from '../modules/telegram/service';

/** Telegram holds the request open this long when there is nothing new. */
const POLL_SECONDS = 25;
const RETRY_MS = 5_000;
/** A wrong token or a second listener will not fix itself in five seconds. */
const RETRY_FATAL_MS = 60_000;

export function startTelegramBot(api: TelegramApi = telegram): () => void {
  if (!telegramEnabled) return () => undefined;

  const abort = new AbortController();
  let stopped = false;

  const run = async () => {
    let offset = 0;
    let configured = false;
    while (!stopped) {
      try {
        // Telegram opens a Mini App only from an HTTPS address, so the button
        // that shows Analysium inside Telegram exists on the deployed server
        // and not in development, where the bot keeps its plain command menu.
        // Part of the loop, not a one-off at start: a connection that timed
        // out when the server came up would otherwise leave the bot without
        // its button until the next restart.
        if (!configured) {
          await api.configure(appOrigin.startsWith('https://') ? appOrigin : null);
          configured = true;
        }
        const updates = await api.getUpdates(offset, POLL_SECONDS, abort.signal);
        for (const update of updates) {
          // Confirmed by the next request's offset whether handling worked or
          // not: one message that cannot be answered must not block the rest.
          offset = update.update_id + 1;
          await handleUpdate(update, api).catch((error) => log.warn({ err: error }, 'telegram update failed'));
        }
      } catch (error) {
        if (stopped) return;
        const fatal = error instanceof TelegramError && (error.code === 401 || error.code === 409);
        log.warn(
          { err: error },
          fatal
            ? 'telegram bot: wrong token, or another server is listening to this bot'
            : 'telegram polling failed',
        );
        await new Promise((resolve) => setTimeout(resolve, fatal ? RETRY_FATAL_MS : RETRY_MS).unref());
      }
    }
  };
  void run();

  return () => {
    stopped = true;
    abort.abort();
  };
}
