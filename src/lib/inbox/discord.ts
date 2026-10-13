import { randomUUID } from "node:crypto";
import { AttachmentBuilder, Client, Events, GatewayIntentBits, type Collection, type Message } from "discord.js";
import { decide, HELP, pending, readyText, snowflakeCompare, statusText, type BotConfig } from "./commands";
import { describeIdea, parseIdea } from "./parse";
import { addItem, removeItem, type InboxItem } from "./state";
import { mutateInbox, onInboxChange, readInbox } from "./store";

/**
 * The phone inbox's Discord bot. It runs inside the BookStudio server, connects
 * out to Discord (nothing is exposed to the internet), queues ideas the owner
 * posts in one channel, and replies there when a draft is built. Ideas posted
 * while the computer was off are still in the channel and are caught up on start.
 */
export interface BotStatus {
  configured: boolean;
  connected: boolean;
  tag?: string;
  error?: string;
}

interface BotGlobal {
  client?: Client;
  status: BotStatus;
  unsubscribe?: () => void;
}
const g = globalThis as typeof globalThis & { __bookstudioDiscord?: BotGlobal };
const bot = (g.__bookstudioDiscord ??= { status: { configured: false, connected: false } });

export function discordConfig(): (BotConfig & { token: string }) | null {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim();
  const ownerId = process.env.DISCORD_OWNER_ID?.trim();
  return token && channelId && ownerId ? { token, channelId, ownerId } : null;
}

export const botStatus = (): BotStatus => ({ ...bot.status, configured: Boolean(discordConfig()) });

/** Where the draft opens; only reachable from the computer running BookStudio unless BOOKSTUDIO_URL says otherwise. */
const reviewUrl = (projectId: string) => `${(process.env.BOOKSTUDIO_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "")}/projects/${projectId}#review`;

async function ideasChannel(client: Client, channelId: string) {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !ch.isTextBased() || !("send" in ch)) throw new Error("DISCORD_CHANNEL_ID is not a text channel the bot can see");
  return ch;
}

async function handle(msg: Message, cfg: BotConfig) {
  const cmd = decide({ authorId: msg.author.id, channelId: msg.channelId, isBot: msg.author.bot, content: msg.content }, cfg);
  if (msg.channelId === cfg.channelId) {
    await mutateInbox((s) => (s.lastMessageId && snowflakeCompare(s.lastMessageId, msg.id) >= 0 ? { state: s, result: null } : { state: { ...s, lastMessageId: msg.id }, result: null }));
  }
  if (cmd.kind === "ignore") return;
  if (cmd.kind === "help") return void (await msg.reply(HELP));
  if (cmd.kind === "status") return void (await msg.reply(statusText((await readInbox()).items)));
  if (cmd.kind === "cancel") {
    const removed = await mutateInbox((s) => {
      const it = pending(s.items)[cmd.n - 1];
      if (!it || it.status !== "queued") return { state: s, result: null };
      return { state: removeItem(s, it.id), result: it };
    });
    return void (await msg.reply(removed ? `Removed: ${removed.text.split("\n")[0]}` : `There's no queued idea #${cmd.n}. Send \`status\` to see the list.`));
  }
  const idea = parseIdea(cmd.text);
  if (!idea.topic) return void (await msg.reply(HELP));
  const position = await mutateInbox((s) => {
    const next = addItem(s, { id: randomUUID(), messageId: msg.id, channelId: msg.channelId, text: cmd.text, idea }, new Date());
    return { state: next, result: next === s ? 0 : pending(next.items).length };
  });
  if (!position) return; // already queued (caught up twice)
  await msg.react("📥").catch(() => undefined);
  await msg.reply(`Queued #${position}: ${describeIdea(idea)}. I'll build it as soon as BookStudio is open in a browser.`);
}

/** Reads what was posted since the last handled message (only the owner's ideas are queued). */
async function catchUp(client: Client, cfg: BotConfig) {
  const ch = await ideasChannel(client, cfg.channelId);
  let after = (await readInbox()).lastMessageId;
  if (!after) {
    // First start: don't import the channel's history, just remember where it ends.
    const latest = await ch.messages.fetch({ limit: 1 });
    const last = latest.first();
    if (last) await mutateInbox((s) => ({ state: { ...s, lastMessageId: last.id }, result: null }));
    return;
  }
  for (;;) {
    const batch: Collection<string, Message> = await ch.messages.fetch({ after, limit: 100 });
    if (!batch.size) return;
    const msgs: Message[] = [...batch.values()].sort((a, b) => snowflakeCompare(a.id, b.id));
    for (const m of msgs) await handle(m, cfg).catch((err) => console.error("Discord: catching up on a message failed", err));
    after = msgs[msgs.length - 1].id;
    if (batch.size < 100) return;
  }
}

async function onChange(client: Client, item: InboxItem, coverPng?: Buffer) {
  if (!item.channelId || !item.messageId) return;
  const ch = await ideasChannel(client, item.channelId);
  const msg = await ch.messages.fetch(item.messageId).catch(() => null);
  if (item.status === "building") {
    await msg?.react("🛠️").catch(() => undefined);
  } else if (item.status === "ready" && item.result) {
    const content = readyText(item, reviewUrl(item.result.projectId));
    const files = coverPng ? [new AttachmentBuilder(coverPng, { name: "cover.png" })] : [];
    await msg?.react("✅").catch(() => undefined);
    await (msg ? msg.reply({ content, files }) : ch.send({ content, files }));
  } else if (item.status === "failed") {
    const content = `⚠️ Couldn't build "${item.text.split("\n")[0]}": ${item.error ?? "unknown error"}. Retry it from the Inbox page in BookStudio.`;
    await msg?.react("⚠️").catch(() => undefined);
    await (msg ? msg.reply(content) : ch.send(content));
  }
}

export async function startDiscordBot(): Promise<void> {
  const cfg = discordConfig();
  if (!cfg || bot.client) return;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  bot.client = client;
  client.once(Events.ClientReady, (c) => {
    bot.status = { configured: true, connected: true, tag: c.user.tag };
    console.log(`Discord: listening as ${c.user.tag}`);
    catchUp(client, cfg).catch((err) => {
      bot.status.error = err instanceof Error ? err.message : String(err);
      console.error("Discord: catch-up failed", err);
    });
  });
  client.on(Events.MessageCreate, (m) => void handle(m, cfg).catch((err) => console.error("Discord: handling a message failed", err)));
  client.on(Events.ShardDisconnect, () => (bot.status.connected = false));
  client.on(Events.ShardResume, () => (bot.status.connected = true));
  bot.unsubscribe = onInboxChange((item, extra) => void onChange(client, item, extra?.coverPng).catch((err) => console.error("Discord: reply failed", err)));
  try {
    await client.login(cfg.token);
  } catch (err) {
    bot.status = { configured: true, connected: false, error: err instanceof Error ? err.message : String(err) };
    bot.unsubscribe?.();
    bot.client = undefined;
    client.destroy().catch(() => undefined);
    console.error("Discord: login failed", err);
  }
}

/** Settings → Test: posts a line in the ideas channel. */
export async function sendTest(): Promise<void> {
  const cfg = discordConfig();
  if (!cfg) throw new Error("Set DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID and DISCORD_OWNER_ID first");
  if (!bot.client?.isReady()) {
    await startDiscordBot();
    if (!bot.client?.isReady()) throw new Error(bot.status.error ?? "The bot isn't connected yet; try again in a few seconds");
  }
  const ch = await ideasChannel(bot.client, cfg.channelId);
  await ch.send("BookStudio is listening. Send a book idea here, or `help` for examples.");
}
