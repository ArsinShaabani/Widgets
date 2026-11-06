/**
 * @widgets/uptime-timeline
 *
 * Availability heatmap, SLO/error-budget tracking and incident log packaged as
 * the `<uptime-timeline>` web component, so the same reliability view runs on the
 * web, in a Windows WebView2 shell, inside an Android WebView and in a WKWebView.
 *
 * ```ts
 * import { defineUptimeTimeline } from '@widgets/uptime-timeline';
 * defineUptimeTimeline();
 * const reliability = document.createElement('uptime-timeline');
 * reliability.setConfig({ source: 'wss://status.example.com/stream' });
 * document.body.append(reliability);
 * ```
 */

export { UptimeTimelineElement, HTMLElementBase, mockUptimeSnapshot } from './element';
export { defineUptimeTimeline, type UptimeTimelineAttributes } from './define';
export {
  createUptimeTransport,
  defaultConfig,
  isMockSource,
  isStaticSource,
  resolveConfig,
  type MockUptimeSource,
  type ResolvedConfig,
  type UptimeTimelineConfig,
  type WidgetSource,
} from './config';
export {
  TIMELINE_SECTIONS,
  computeTimelineGeometry,
  computeTimelineLayout,
  computeTimelineWindow,
  maxTimelineScroll,
  type TimelineGeometry,
  type TimelineLayout,
  type TimelineLayoutOptions,
  type TimelineSectionId,
  type TimelineWindow,
} from './layout';
export {
  buildUptimeViewModel,
  monthLabels,
  stateColor,
  type GroupChip,
  type IncidentRow,
  type SloRow,
  type StateChip,
  type TimelineAction,
  type TimelineCell,
  type TimelineCounter,
  type TimelineDetail,
  type TimelineRow,
  type UptimeViewModel,
  type UptimeViewModelInput,
} from './view-model';
export { renderUptimeTimeline, type UptimeRenderOptions, type UptimeRenderResult } from './renderer';
export { drawTimeline, type TimelineOptions } from './draw/timeline';
export { drawFilters, drawToolbar } from './draw/chrome';
export { drawDetail, drawIncidents, drawSlo } from './draw/side';
