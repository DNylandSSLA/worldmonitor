import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { activityTracker } from '@/services';
import {
  getIntelTopics,
  fetchTopicIntelligence,
  formatArticleDate,
  extractDomain,
  type GdeltArticle,
  type IntelTopic,
  type TopicIntelligence,
} from '@/services/gdelt-intel';

export class GdeltIntelPanel extends Panel {
  private activeTopic: IntelTopic = getIntelTopics()[0]!;
  private topicData = new Map<string, TopicIntelligence>();
  private tabsEl: HTMLElement | null = null;
  private boundScrollHandler: (() => void) | null = null;
  private boundClickHandler: (() => void) | null = null;

  constructor() {
    super({
      id: 'gdelt-intel',
      title: t('panels.gdeltIntel'),
      showCount: true,
      trackActivity: true,
      infoTooltip: t('components.gdeltIntel.infoTooltip'),
    });
    this.setupActivityTracking();
    this.createTabs();
    this.loadActiveTopic();
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

  private createTabs(): void {
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'gdelt-intel-tabs';

    getIntelTopics().forEach(topic => {
      const tab = document.createElement('button');
      tab.className = `gdelt-intel-tab ${topic.id === this.activeTopic.id ? 'active' : ''}`;
      tab.dataset.topicId = topic.id;
      tab.title = topic.description;
      tab.innerHTML = `<span class="tab-icon">${topic.icon}</span><span class="tab-label">${escapeHtml(topic.name)}</span>`;

      tab.addEventListener('click', () => this.selectTopic(topic));
      this.tabsEl!.appendChild(tab);
    });

    this.element.insertBefore(this.tabsEl, this.content);
  }

  private selectTopic(topic: IntelTopic): void {
    if (topic.id === this.activeTopic.id) return;

    this.activeTopic = topic;

    this.tabsEl?.querySelectorAll('.gdelt-intel-tab').forEach(tab => {
      tab.classList.toggle('active', (tab as HTMLElement).dataset.topicId === topic.id);
    });

    const cached = this.topicData.get(topic.id);
    if (cached && Date.now() - cached.fetchedAt.getTime() < 5 * 60 * 1000) {
      this.renderArticles(cached.articles);
    } else {
      this.loadActiveTopic();
    }
  }

  private async loadActiveTopic(): Promise<void> {
    this.showLoading();

    try {
      const data = await fetchTopicIntelligence(this.activeTopic);
      this.topicData.set(this.activeTopic.id, data);
      this.renderArticles(data.articles);
      this.setCount(data.articles.length);
    } catch (error) {
      console.error('[GdeltIntelPanel] Load error:', error);
      this.showError(t('common.failedIntelFeed'));
    }
  }

  private renderArticles(articles: GdeltArticle[]): void {
    if (articles.length === 0) {
      this.content.innerHTML = `<div class="empty-state">${escapeHtml(t('components.gdelt.empty'))}</div>`;
      return;
    }

    const articleIds = articles.map(a => a.url);
    const newIds = new Set(activityTracker.updateItems(this.panelId, articleIds));

    const html = articles.map(article => this.renderArticle(article, newIds.has(article.url))).join('');
    this.content.innerHTML = `<div class="gdelt-intel-articles">${html}</div>`;
  }

  private renderArticle(article: GdeltArticle, isNew: boolean): string {
    const domain = article.source || extractDomain(article.url);
    const timeAgo = formatArticleDate(article.date);
    const toneClass = article.tone ? (article.tone < -2 ? 'tone-negative' : article.tone > 2 ? 'tone-positive' : '') : '';
    const newClass = isNew ? 'gdelt-article-new' : '';

    return `
      <a href="${sanitizeUrl(article.url)}" target="_blank" rel="noopener" class="gdelt-intel-article ${toneClass} ${newClass}">
        <div class="article-header">
          <span class="article-source">${escapeHtml(domain)}</span>
          <span class="article-time">${escapeHtml(timeAgo)}</span>
        </div>
        <div class="article-title">${escapeHtml(article.title)}</div>
      </a>
    `;
  }

  public async refresh(): Promise<void> {
    await this.loadActiveTopic();
  }

  public async refreshAll(): Promise<void> {
    this.topicData.clear();
    await this.loadActiveTopic();
  }

  public destroy(): void {
    if (this.boundScrollHandler) {
      this.content.removeEventListener('scroll', this.boundScrollHandler);
    }
    if (this.boundClickHandler) {
      this.element.removeEventListener('click', this.boundClickHandler);
    }
    super.destroy();
  }
}
