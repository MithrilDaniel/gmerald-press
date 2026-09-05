import { cfg } from './env.js';

// Public art the posts ride on: the kit on the site (the www host answers directly; the bare host redirects).
export const KIT = 'https://www.gmerald.xyz/kit';
export const ART = {
  press: `${KIT}/clips/stash-cheeks-16x9.mp4`, // a claim landing: gerald stuffing his cheeks
  snack: `${KIT}/base-snacks.jpg`,              // one burn slice
  burn: `${KIT}/clips/furnace-7s.mp4`,          // a whole percent of supply gone
  buy: `${KIT}/base-cookie.jpg`,               // a buy above the floor
  newHolder: `${KIT}/clips/hug-7s.mp4`,         // a wallet's first $gmerald: welcome to the burrow
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

// A card: the art on top, clean lines under it, the first line bold. Values are escaped, so any text is safe.
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function postCard(url: string, lines: (string | null | undefined)[]): Promise<void> {
  const ls = lines.filter((l): l is string => !!l).map(esc); if (!ls.length) return;
  const html = [`<b>${ls[0]}</b>`, ...ls.slice(1)].join('\n');
  if (!cfg.tgToken || !cfg.tgChat) { console.log(`[telegram] not configured, would have posted ${url}:\n` + ls.join('\n')); return; }
  const isVideo = /\.mp4($|\?)/i.test(url);
  const ok = await call(isVideo ? 'sendAnimation' : 'sendPhoto', { [isVideo ? 'animation' : 'photo']: url, caption: html.slice(0, 1000), parse_mode: 'HTML' });
  if (!ok) await call('sendMessage', { text: html, parse_mode: 'HTML', disable_web_page_preview: true });
}
