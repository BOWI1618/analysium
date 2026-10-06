/**
 * Analysium opened inside Telegram, as a Mini App.
 *
 * Telegram passes the page its launch data in the address fragment
 * (`#tgWebAppData=…`). That string is signed by Telegram, and the server
 * accepts it as proof of who opened the app — see `/auth/telegram`.
 *
 * Read by hand rather than through Telegram's script: the script would be
 * fetched from telegram.org on every page load for every visitor, including
 * the ones who never open the app in Telegram, and all it would do here is
 * parse this same fragment.
 */
const STORAGE_KEY = 'analysium.telegram-init-data';

let cached: string | null | undefined;

/** The signed launch data, or null when the page was not opened from Telegram. */
export function telegramInitData(): string | null {
  if (cached !== undefined) return cached;
  let value = new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppData');
  try {
    // The fragment is gone after the first navigation inside the app; the
    // copy lets a reload of the same Telegram window sign in again.
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
    else value = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage is unavailable in some embedded browsers — the fragment alone still works */
  }
  cached = value || null;
  return cached;
}

export const isTelegramApp = (): boolean => telegramInitData() !== null;

type TelegramBridge = {
  TelegramWebviewProxy?: { postEvent: (type: string, data: string) => void };
};

/** Tells the Telegram client something; the channel differs between its mobile, desktop and web builds. */
function postEvent(eventType: string, eventData: Record<string, unknown> = {}): void {
  try {
    const proxy = (window as unknown as TelegramBridge).TelegramWebviewProxy;
    if (proxy) proxy.postEvent(eventType, JSON.stringify(eventData));
    else if (window.parent !== window) {
      window.parent.postMessage(JSON.stringify({ eventType, eventData }), 'https://web.telegram.org');
    }
  } catch {
    /* an old client without the bridge simply shows the app half-height */
  }
}

/** Called once at start: shows the app at full height instead of the default half-sheet. */
export function startTelegramApp(): void {
  if (!isTelegramApp()) return;
  postEvent('web_app_ready');
  postEvent('web_app_expand');
}
