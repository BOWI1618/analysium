/**
 * The Telegram Bot API, as far as Analysium uses it.
 *
 * Plain HTTPS calls rather than an SDK: a handful of methods do not justify a
 * dependency, and the bot only ever talks to people one at a time. Everything
 * that needs Telegram takes the `TelegramApi` interface, so tests hand in a
 * recorder and nothing reaches the network.
 */
import { env } from '../config/env';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string };
  };
}

export interface TelegramApi {
  /** The bot's own @username — the address of every link that opens it. */
  username(): Promise<string>;
  /**
   * Sends HTML-formatted text to a chat. A `button` under the message opens
   * its address inside Telegram, as a Mini App — Telegram allows that only
   * for HTTPS addresses and only in a private chat with the bot.
   */
  sendMessage(chatId: string, html: string, button?: { text: string; url: string }): Promise<void>;
  /** Long poll: resolves with new updates, or an empty list after `timeoutSeconds`. */
  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  /**
   * Sets up what people see in the bot: its command list, and — given the
   * app's public HTTPS address — the button that opens Analysium inside Telegram.
   */
  configure(webAppUrl: string | null): Promise<void>;
}

/** A refusal from Telegram itself, with its numeric code (403: the person blocked the bot). */
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    description: string,
  ) {
    super(description);
    this.name = 'TelegramError';
  }
}

export const telegramEnabled = Boolean(env.TELEGRAM_BOT_TOKEN);

/** Text typed by people goes into HTML messages; these three characters would break the markup. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function call<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  // The token is part of the address, so the address never goes into an error or a log line.
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok: true; result: T }
    | { ok: false; error_code?: number; description?: string }
    | null;
  if (!payload || !payload.ok) {
    throw new TelegramError(
      (payload && !payload.ok && payload.error_code) || response.status,
      (payload && !payload.ok && payload.description) || `Telegram ${method} failed`,
    );
  }
  return payload.result;
}

let botUsername: Promise<string> | null = null;

export const telegram: TelegramApi = {
  username() {
    // Asked once: a bot's username does not change while the server runs.
    botUsername ??= call<{ username: string }>('getMe', {}).then((me) => me.username);
    // A failed lookup must not be remembered, or one network hiccup would break linking for good.
    botUsername.catch(() => {
      botUsername = null;
    });
    return botUsername;
  },
  async sendMessage(chatId, html, button) {
    await call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(button
        ? { reply_markup: { inline_keyboard: [[{ text: button.text, web_app: { url: button.url } }]] } }
        : {}),
    });
  },
  getUpdates(offset, timeoutSeconds, signal) {
    return call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
      signal,
    );
  },
  async configure(webAppUrl) {
    await call('setMyCommands', {
      commands: [{ command: 'stop', description: 'Отключить уведомления' }],
    });
    await call('setChatMenuButton', {
      menu_button: webAppUrl
        ? { type: 'web_app', text: 'Analysium', web_app: { url: webAppUrl } }
        : { type: 'commands' },
    });
  },
};
