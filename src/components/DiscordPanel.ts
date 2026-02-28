import { Panel } from './Panel';
import { WindowedList } from './VirtualList';
import type { DiscordMessage } from '@/types';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { activityTracker } from '@/services';
import { t } from '@/services/i18n';

interface PreparedMessage {
  message: DiscordMessage;
  isNew: boolean;
  isGrouped: boolean;
}

export class DiscordPanel extends Panel {
  private windowedList: WindowedList<PreparedMessage> | null = null;
  private boundScrollHandler: (() => void) | null = null;
  private boundClickHandler: (() => void) | null = null;

  constructor() {
    super({
      id: 'discord',
      title: 'Discord',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Real-time messages from connected Discord servers. Inbound only — polls a local bridge process on localhost:9090.',
    });
    this.setupActivityTracking();
    this.initWindowedList();
  }

  private setupActivityTracking(): void {
    activityTracker.register(this.panelId);
    activityTracker.onChange(this.panelId, (newCount) => {
      this.setNewBadge(newCount, newCount > 0);
    });

    this.boundScrollHandler = () => {
      activityTracker.markAsSeen(this.panelId);
    };
    this.content.addEventListener('scroll', this.boundScrollHandler);

    this.boundClickHandler = () => {
      activityTracker.markAsSeen(this.panelId);
    };
    this.element.addEventListener('click', this.boundClickHandler);
  }

  private initWindowedList(): void {
    this.windowedList = new WindowedList<PreparedMessage>(
      {
        container: this.content,
        chunkSize: 15,
        bufferChunks: 1,
      },
      (prepared) => this.renderMessageHtml(prepared),
    );
  }

  public renderMessages(items: DiscordMessage[]): void {
    if (items.length === 0) {
      this.setContent(`<div class="empty-message">${escapeHtml(t('common.noData'))}</div>`);
      this.setCount(0);
      this.setDataBadge('unavailable');
      return;
    }

    const itemIds = items.map(m => m.id);
    const newIds = new Set(activityTracker.updateItems(this.panelId, itemIds));

    const prepared: PreparedMessage[] = items.map((msg, idx) => {
      const prev = idx > 0 ? items[idx - 1] : undefined;
      const isGrouped = prev !== undefined
        && prev.authorName === msg.authorName
        && prev.channelId === msg.channelId
        && Math.abs(msg.timestamp - prev.timestamp) < 5 * 60 * 1000;

      return {
        message: msg,
        isNew: newIds.has(msg.id),
        isGrouped,
      };
    });

    this.setCount(items.length);
    this.setDataBadge('live');

    if (this.windowedList) {
      this.windowedList.setItems(prepared);
    } else {
      this.setContent(prepared.map(p => this.renderMessageHtml(p)).join(''));
    }
  }

  private renderMessageHtml(prepared: PreparedMessage): string {
    const { message: msg, isNew, isGrouped } = prepared;
    const classes = [
      'discord-message',
      isNew ? 'discord-new' : '',
      isGrouped ? 'discord-grouped' : '',
    ].filter(Boolean).join(' ');

    const timeStr = formatTime(new Date(msg.timestamp));
    const channel = escapeHtml(msg.channelName);
    const author = escapeHtml(msg.authorName);
    const content = escapeHtml(msg.content);

    let headerHtml = '';
    if (!isGrouped) {
      headerHtml = `
        <div class="discord-msg-header">
          <img class="discord-avatar" src="${escapeHtml(msg.authorAvatar)}" alt="" width="20" height="20" loading="lazy">
          <span class="discord-author">${author}</span>
          <span class="discord-channel">#${channel}</span>
          <span class="discord-time">${escapeHtml(timeStr)}</span>
        </div>`;
    }

    let replyHtml = '';
    if (msg.isReply && msg.referencedContent) {
      replyHtml = `<div class="discord-reply">${escapeHtml(msg.referencedContent.slice(0, 120))}</div>`;
    }

    let embedsHtml = '';
    if (msg.embeds.length > 0) {
      embedsHtml = msg.embeds.map(e => {
        const url = e.url ? sanitizeUrl(e.url) : '';
        const title = e.title ? escapeHtml(e.title) : '';
        return url
          ? `<a class="discord-embed-link" href="${url}" target="_blank" rel="noopener">${title || url}</a>`
          : title ? `<span class="discord-embed-title">${title}</span>` : '';
      }).filter(Boolean).join('');
      if (embedsHtml) embedsHtml = `<div class="discord-embeds">${embedsHtml}</div>`;
    }

    let attachHtml = '';
    if (msg.attachments.length > 0) {
      attachHtml = msg.attachments.map(a => {
        const url = sanitizeUrl(a.url);
        const name = escapeHtml(a.name);
        return url ? `<a class="discord-attachment" href="${url}" target="_blank" rel="noopener">${name}</a>` : '';
      }).filter(Boolean).join('');
      if (attachHtml) attachHtml = `<div class="discord-attachments">${attachHtml}</div>`;
    }

    return `
      <div class="${classes}" data-id="${escapeHtml(msg.id)}">
        ${headerHtml}
        ${replyHtml}
        <div class="discord-content">${content}</div>
        ${embedsHtml}
        ${attachHtml}
      </div>`;
  }

  public setStatus(connected: boolean, guildCount: number): void {
    if (connected) {
      this.setDataBadge('live', `${guildCount} server${guildCount !== 1 ? 's' : ''}`);
    } else {
      this.setDataBadge('unavailable', 'bridge offline');
    }
  }

  public destroy(): void {
    this.windowedList?.destroy();
    if (this.boundScrollHandler) {
      this.content.removeEventListener('scroll', this.boundScrollHandler);
    }
    if (this.boundClickHandler) {
      this.element.removeEventListener('click', this.boundClickHandler);
    }
    super.destroy();
  }
}
