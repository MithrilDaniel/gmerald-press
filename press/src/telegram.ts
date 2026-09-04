import { cfg } from './env.js';

// Public art the posts ride on: the kit on the site (the www host answers directly; the bare host redirects).
export const KIT = 'https://www.gmerald.xyz/kit';
export const ART = {
  press: `${KIT}/clips/stash-cheeks-16x9.mp4`, // a claim landing: gerald stuffing his cheeks
  snack: `${KIT}/base-snacks.jpg`,              // one burn slice
  burn: `${KIT}/clips/furnace-7s.mp4`,          // a whole percent of supply gone
  hello: `${KIT}/clips/hug-7s.mp4`,
};

async function call(method: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.tgToken}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.tgChat, ...body }),
  });
  if (!res.ok) console.error(`[telegram] ${method} failed: ${res.status} ${await res.text()}`);
  return res.ok;
}

export async function post(text: string): Promise<void> {
  if (!cfg.tgToken || !cfg.tgChat) { console.log('[telegram] not configured, would have posted:\n' + text); return; }
  await call('sendMessage', { text, disable_web_page_preview: true });
}

// A photo (jpg/png url) or an animation (mp4 url) with the text as its caption; plain text if telegram refuses the media.
export async function postMedia(url: string, caption: string): Promise<void> {
  if (!cfg.tgToken || !cfg.tgChat) { console.log(`[telegram] not configured, would have posted ${url}:\n` + caption); return; }
  const isVideo = /\.mp4($|\?)/i.test(url);
  const ok = await call(isVideo ? 'sendAnimation' : 'sendPhoto', { [isVideo ? 'animation' : 'photo']: url, caption: caption.slice(0, 1000) });
  if (!ok) await call('sendMessage', { text: caption, disable_web_page_preview: true });
}
