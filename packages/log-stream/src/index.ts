/**
 * @widgets/log-stream
 *
 * Virtualised, filterable live log viewer packaged as a web component, so the
 * same widget runs on the web, in a Windows WebView2 shell, inside an Android
 * WebView and in a WKWebView — all fed by the `@widgets/core` data layer.
 *
 * ```ts
 * import { defineLogStream } from '@widgets/log-stream';
 * defineLogStream();
 * const logs = document.createElement('log-stream');
 * logs.setConfig({ source: 'wss://logs.example.com/stream', follow: true });
 * document.body.append(logs);
 * ```
 */

export { LogStreamElement, HTMLElementBase, mockLogSnapshot } from './element';
export { defineLogStream, type LogStreamAttributes } from './define';
export {
  createLogStreamTransport,
  defaultConfig,
  isMockSource,
  isStaticSource,
  resolveConfig,
  type LogStreamConfig,
  type MockLogSource,
  type ResolvedConfig,
  type WidgetSource,
} from './config';
export {
  LOG_SECTIONS,
  computeLogLayout,
  computeStreamWindow,
  maxScrollTop,
  type LogLayout,
  type LogLayoutOptions,
  type LogSectionId,
  type StreamWindow,
} from './layout';
export {
  buildLogViewModel,
  relativeLabel,
  timeLabel,
  type LogDetail,
  type LogHistogram,
  type LogLevelChip,
  type LogRow,
  type LogServiceBar,
  type LogServiceChip,
  type LogSeverityMix,
  type LogToolbarAction,
  type LogToolbarCounter,
  type LogViewModel,
  type LogViewModelInput,
} from './view-model';
export { renderLogWidget, type LogRenderOptions, type LogRenderResult } from './renderer';
export { columnLayout, drawStream, type StreamOptions } from './draw/stream';
export { drawFilters, drawSeverityMix, drawToolbar } from './draw/chrome';
export { drawDetail, drawHistogram, drawServices } from './draw/analytics';
