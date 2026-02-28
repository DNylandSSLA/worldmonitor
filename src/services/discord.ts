import type { DiscordMessage } from '@/types';
import { dataFreshness } from './data-freshness';

const BRIDGE_URL = import.meta.env.VITE_DISCORD_BRIDGE_URL || 'http://localhost:9090';
const POLL_INTERVAL_MS = 5 * 1000;
const STALE_MS = 15 * 1000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 1000;

const isClientRuntime = typeof window !== 'undefined';
const discordEnabled = isClientRuntime && import.meta.env.VITE_ENABLE_DISCORD !== 'false';

let messages: DiscordMessage[] = [];
let lastFetchTimestamp = 0;
let lastPollAt = 0;
let inFlight = false;
let isPolling = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const seenIds = new Set<string>();

let bridgeConnected = false;
let bridgeGuilds: Array<{ id: string; name: string }> = [];

export function isDiscordConfigured(): boolean {
  return discordEnabled;
}

async function pollBridge(): Promise<void> {
  if (!discordEnabled) return;
  if (inFlight) return;

  const now = Date.now();
  if (now < circuitOpenUntil) return;

  inFlight = true;
  try {
    const sinceParam = lastFetchTimestamp > 0 ? `?since=${lastFetchTimestamp}` : '';
    const res = await fetch(`${BRIDGE_URL}/messages${sinceParam}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const incoming: DiscordMessage[] = await res.json();

    let newCount = 0;
    for (const msg of incoming) {
      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        messages.push(msg);
        newCount++;
      }
    }

    // Keep buffer bounded at 500
    if (messages.length > 500) {
      const removed = messages.splice(0, messages.length - 500);
      for (const m of removed) seenIds.delete(m.id);
    }

    if (incoming.length > 0) {
      const maxTs = Math.max(...incoming.map(m => m.timestamp));
      if (maxTs > lastFetchTimestamp) lastFetchTimestamp = maxTs;
    }

    lastPollAt = now;
    consecutiveFailures = 0;

    if (newCount > 0) {
      dataFreshness.recordUpdate('discord', newCount);
    }
  } catch {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      consecutiveFailures = 0;
    }
  } finally {
    inFlight = false;
  }
}

async function fetchStatus(): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      bridgeConnected = Boolean(data.connected);
      bridgeGuilds = Array.isArray(data.guilds) ? data.guilds : [];
    }
  } catch {
    bridgeConnected = false;
  }
}

function startPolling(): void {
  if (isPolling || !discordEnabled) return;
  isPolling = true;
  void pollBridge();
  void fetchStatus();
  pollInterval = setInterval(() => {
    void pollBridge();
  }, POLL_INTERVAL_MS);
  // Status check every 30s
  setInterval(() => void fetchStatus(), 30 * 1000);
}

export function initDiscord(): void {
  startPolling();
}

export function disconnectDiscord(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isPolling = false;
  inFlight = false;
}

export function getDiscordStatus(): { connected: boolean; guilds: Array<{ id: string; name: string }> } {
  const isFresh = Date.now() - lastPollAt <= STALE_MS;
  return {
    connected: bridgeConnected && isFresh,
    guilds: bridgeGuilds,
  };
}

export async function fetchDiscordMessages(): Promise<DiscordMessage[]> {
  if (!discordEnabled) return [];

  startPolling();
  const shouldRefresh = Date.now() - lastPollAt > STALE_MS;
  if (shouldRefresh) {
    await pollBridge();
  }

  return [...messages].sort((a, b) => b.timestamp - a.timestamp);
}
