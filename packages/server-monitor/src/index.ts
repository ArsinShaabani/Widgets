/**
 * @widgets/server-monitor
 *
 * Canvas-rendered server resource dashboard, packaged as a web component so the
 * exact same widget runs on the web, in a Windows WebView2 shell, inside an
 * Android WebView and in a WKWebView — all fed by the `@widgets/core` data layer.
 *
 * ```ts
 * import { defineServerMonitor } from '@widgets/server-monitor';
 * defineServerMonitor();
 * const widget = document.createElement('server-monitor');
 * widget.setConfig({ source: 'wss://metrics.example.com/stream' });
 * document.body.append(widget);
 * ```
 */

export { ServerMonitorElement, mockSnapshot } from './element';
export { defineServerMonitor, type ServerMonitorAttributes } from './define';
export {
  createTransport,
  defaultConfig,
  isMockSource,
  isStaticSource,
  isTransport,
  resolveConfig,
  StaticPollTransport,
  type ResolvedConfig,
  type ServerMonitorConfig,
  type WidgetSource,
} from './config';
export {
  ALL_SECTIONS,
  CHART_SECTIONS,
  HOST_SECTIONS,
  computeLayout,
  type LayoutOptions,
  type LayoutResult,
  type SectionId,
  type SectionSpec,
} from './layout';
export {
  buildViewModel,
  type BadgeItem,
  type BarItem,
  type DonutItem,
  type DonutSegment,
  type DualBarItem,
  type GaugeItem,
  type IconAction,
  type ProgressItem,
  type SeriesItem,
  type ViewModel,
  type ViewModelInput,
} from './view-model';
export { renderDashboard, type RenderOptions, type RenderResult } from './renderer';
export {
  createHitCollector,
  findRegion,
  hitTest,
  type HitCollector,
  type HitRegion,
} from './hit';
export {
  capsulePath,
  clamp,
  ellipsize,
  linearScale,
  monotoneCubicSegments,
  niceTicks,
  polar,
  ringSegmentPath,
  roundRectPath,
  seriesToPoints,
  TAU,
  type CubicSegment,
  type PolarPoint,
  type Rect,
} from './geometry';
export { ICON_PATHS, type IconName } from './icons';
export { drawPanel, drawText, fontStack, type Ctx } from './draw/primitives';
