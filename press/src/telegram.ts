import { cfg } from './env.js';

export async function post(text: string): Promise<void> {
  if (!cfg.tgToken || !cfg.tgChat) {
    console.log('[telegram] not configured, would have posted:\n' + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.tgChat, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`[telegram] sendMessage failed: ${res.status} ${await res.text()}`);
}
