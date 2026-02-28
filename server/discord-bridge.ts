import { Client, GatewayIntentBits, type Message } from 'discord.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_IDS = process.env.DISCORD_GUILD_IDS
  ? process.env.DISCORD_GUILD_IDS.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const PORT = Number(process.env.DISCORD_BRIDGE_PORT) || 9090;
const MAX_BUFFER = 500;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface BufferedMessage {
  id: string;
  content: string;
  authorName: string;
  authorAvatar: string;
  channelName: string;
  channelId: string;
  guildName: string;
  guildId: string;
  timestamp: number;
  embeds: Array<{ title?: string; description?: string; url?: string }>;
  attachments: Array<{ name: string; url: string; contentType?: string }>;
  isReply: boolean;
  referencedContent?: string;
}

const buffer: BufferedMessage[] = [];

function pruneBuffer(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  while (buffer.length > 0 && (buffer[0]!.timestamp < cutoff || buffer.length > MAX_BUFFER)) {
    buffer.shift();
  }
}

function messageToBuffered(msg: Message): BufferedMessage {
  return {
    id: msg.id,
    content: msg.content,
    authorName: msg.author.displayName ?? msg.author.username,
    authorAvatar: msg.author.displayAvatarURL({ size: 32 }),
    channelName: 'name' in msg.channel ? (msg.channel.name ?? 'unknown') : 'DM',
    channelId: msg.channelId,
    guildName: msg.guild?.name ?? 'Unknown',
    guildId: msg.guildId ?? '',
    timestamp: msg.createdTimestamp,
    embeds: msg.embeds.map(e => ({
      title: e.title ?? undefined,
      description: e.description ?? undefined,
      url: e.url ?? undefined,
    })),
    attachments: [...msg.attachments.values()].map(a => ({
      name: a.name,
      url: a.url,
      contentType: a.contentType ?? undefined,
    })),
    isReply: msg.reference !== null,
    referencedContent: undefined, // filled async below if needed
  };
}

if (!DISCORD_TOKEN) {
  console.error('[discord-bridge] DISCORD_TOKEN not set. Exiting.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('ready', () => {
  const guilds = client.guilds.cache.map(g => g.name);
  console.log(`[discord-bridge] Connected to ${guilds.length} guild(s): ${guilds.join(', ')}`);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (GUILD_IDS.length > 0 && msg.guildId && !GUILD_IDS.includes(msg.guildId)) return;

  const buffered = messageToBuffered(msg);

  if (msg.reference?.messageId) {
    try {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId);
      buffered.referencedContent = ref.content.slice(0, 200);
    } catch { /* referenced message may be deleted */ }
  }

  buffer.push(buffered);
  pruneBuffer();
});

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url.pathname === '/status') {
    sendJson(res, 200, {
      connected: client.isReady(),
      guilds: client.guilds.cache.map(g => ({ id: g.id, name: g.name })),
      bufferSize: buffer.length,
    });
    return;
  }

  if (url.pathname === '/messages') {
    const since = Number(url.searchParams.get('since')) || 0;
    pruneBuffer();
    const filtered = since > 0
      ? buffer.filter(m => m.timestamp > since)
      : buffer;
    sendJson(res, 200, filtered);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[discord-bridge] HTTP server listening on http://localhost:${PORT}`);
});

void client.login(DISCORD_TOKEN);
