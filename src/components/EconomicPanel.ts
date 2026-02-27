import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { OilAnalytics } from '@/services/oil-analytics';
import { formatOilValue, getTrendIndicator, getTrendColor } from '@/services/oil-analytics';
import { escapeHtml } from '@/utils/sanitize';

export class EconomicPanel extends Panel {
  private oilData: OilAnalytics | null = null;

  constructor() {
    super({ id: 'economic', title: t('panels.economic') });
  }

  public updateOil(data: OilAnalytics): void {
    this.oilData = data;
    this.render();
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.showLoading();
    }
  }

  private render(): void {
    if (!this.oilData) {
      this.setContent(`<div class="economic-empty">${t('components.economic.noOilDataRetry')}</div>`);
      return;
    }

    const metrics = [
      this.oilData.wtiPrice,
      this.oilData.brentPrice,
      this.oilData.usProduction,
      this.oilData.usInventory,
    ].filter(Boolean);

    if (metrics.length === 0) {
      this.setContent(`<div class="economic-empty">${t('components.economic.noOilMetrics')}</div>`);
      return;
    }

    const contentHtml = `
      <div class="economic-indicators oil-metrics">
        ${metrics.map(metric => {
      if (!metric) return '';
      const trendIcon = getTrendIndicator(metric.trend);
      const trendColor = getTrendColor(metric.trend, metric.name.includes('Production'));

      return `
            <div class="economic-indicator oil-metric">
              <div class="indicator-header">
                <span class="indicator-name">${escapeHtml(metric.name)}</span>
              </div>
              <div class="indicator-value">
                <span class="value">${escapeHtml(formatOilValue(metric.current, metric.unit))} ${escapeHtml(metric.unit)}</span>
                <span class="change" style="color: ${escapeHtml(trendColor)}">
                  ${escapeHtml(trendIcon)} ${escapeHtml(String(metric.changePct > 0 ? '+' : ''))}${escapeHtml(String(metric.changePct))}%
                </span>
              </div>
              <div class="indicator-date">${t('components.economic.vsPreviousWeek')}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;

    this.setContent(`
      <div class="economic-content">
        ${contentHtml}
      </div>
      <div class="economic-footer">
        <span class="economic-source">EIA • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `);
  }
}
