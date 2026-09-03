// Prints what the telegram bot can see: itself, and every chat it has been added to.
// Run it once after `gh secret set TELEGRAM_BOT_TOKEN` to learn the burrow's chat id
// without adding any third-party "get id" bot to the group.
import { cfg } from '../env.js';

export async function runTgCheck(): Promise<void> {
  if (!cfg.tgToken) { console.log('[tgcheck] TELEGRAM_BOT_TOKEN not set'); return; }
  const api = (m: string) => fetch(`https://api.telegram.org/bot${cfg.tgToken}/${m}`).then(r => r.json() as Promise<any>);
  const me = await api('getMe');
  if (!me.ok) { console.log(`[tgcheck] token rejected: ${JSON.stringify(me)}`); return; }
  console.log(`[tgcheck] bot: @${me.result.username} (${me.result.first_name})`);
  const upd = await api('getUpdates?limit=100&allowed_updates=["message","my_chat_member","channel_post"]');
  const chats = new Map<string, string>();
  for (const u of upd.result ?? []) {
    const c = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (c) chats.set(String(c.id), `${c.type} · ${c.title ?? c.username ?? ''}`);
  }
  if (chats.size === 0) console.log('[tgcheck] no chats seen yet. add the bot to the group as an admin, post one message there, run again.');
  for (const [id, d] of chats) console.log(`[tgcheck] chat ${id}  ${d}`);
  if (cfg.tgChat) {
    const r = await api(`getChat?chat_id=${cfg.tgChat}`);
    console.log(`[tgcheck] TELEGRAM_CHAT_ID=${cfg.tgChat}: ${r.ok ? `${r.result.type} · ${r.result.title} (ok)` : JSON.stringify(r)}`);
  }
}
