import { Panel } from './Panel';
import type { CableAdvisory, RepairShip } from '@/types';
import { formatTime } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { activityTracker } from '@/services';
import { t } from '@/services/i18n';

export class CableActivityPanel extends Panel {
  private boundScrollHandler: (() => void) | null = null;
  private boundClickHandler: (() => void) | null = null;

  constructor() {
    super({
      id: 'cable-activity',
      title: 'Cable Activity',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'NGA maritime warnings related to undersea cable operations, faults, and repair vessels. Data from NAVAREA navigational warnings.',
    });
    this.setupActivityTracking();
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

  public renderActivity(advisories: CableAdvisory[], repairShips: RepairShip[]): void {
    const total = advisories.length + repairShips.length;

    if (total === 0) {
      this.setContent(`<div class="empty-message">${escapeHtml(t('common.noData'))}</div>`);
      this.setCount(0);
      this.setDataBadge('live', 'no warnings');
      return;
    }

    const allIds = [
      ...advisories.map(a => a.id),
      ...repairShips.map(s => s.id),
    ];
    const newIds = new Set(activityTracker.updateItems(this.panelId, allIds));

    // Render advisories
    const advisoryHtml = advisories
      .sort((a, b) => b.reported.getTime() - a.reported.getTime())
      .map(a => this.renderAdvisory(a, newIds.has(a.id)))
      .join('');

    // Render repair ships
    const shipsHtml = repairShips.length > 0
      ? `<div class="cable-section-header">Repair Vessels</div>` +
        repairShips.map(s => this.renderShip(s, newIds.has(s.id))).join('')
      : '';

    this.setContent(advisoryHtml + shipsHtml);
    this.setCount(total);

    const faults = advisories.filter(a => a.severity === 'fault').length;
    if (faults > 0) {
      this.setDataBadge('live', `${faults} fault${faults !== 1 ? 's' : ''}`);
    } else {
      this.setDataBadge('live');
    }
  }

  private renderAdvisory(advisory: CableAdvisory, isNew: boolean): string {
    const sevClass = advisory.severity === 'fault' ? 'cable-fault' : 'cable-degraded';
    const newClass = isNew ? 'cable-item-new' : '';
    const timeStr = formatTime(advisory.reported);

    return `
      <div class="cable-item ${sevClass} ${newClass}">
        <div class="cable-item-header">
          <span class="cable-severity">${advisory.severity === 'fault' ? 'FAULT' : 'OPS'}</span>
          <span class="cable-title">${escapeHtml(advisory.title)}</span>
          <span class="cable-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="cable-description">${escapeHtml(advisory.description)}</div>
        <div class="cable-impact">${escapeHtml(advisory.impact)}</div>
      </div>`;
  }

  private renderShip(ship: RepairShip, isNew: boolean): string {
    const statusClass = ship.status === 'on-station' ? 'ship-active' : 'ship-enroute';
    const newClass = isNew ? 'cable-item-new' : '';

    return `
      <div class="cable-item cable-ship ${statusClass} ${newClass}">
        <div class="cable-item-header">
          <span class="cable-severity ship">${ship.status === 'on-station' ? 'ON STN' : 'ENROUTE'}</span>
          <span class="cable-title">${escapeHtml(ship.name)}</span>
        </div>
        ${ship.note ? `<div class="cable-description">${escapeHtml(ship.note)}</div>` : ''}
      </div>`;
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
