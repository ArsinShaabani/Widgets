/**
 * @widgets/core — framework-agnostic data layer for the Widgets collection.
 *
 * Nothing in this package touches the DOM or any framework, so the same code
 * runs in browsers, Node, React Native, WinUI WebView hosts and native bridges.
 */

export type {
  AlertInfo,
  AlertSeverity,
  ConnectionState,
  CpuMetrics,
  DiskMetrics,
  DiskPartition,
  HealthSummary,
  HostInfo,
  HistoryKey,
  MemoryMetrics,
  MetricHistory,
  MetricReading,
  NetworkInterfaceMetrics,
  NetworkMetrics,
  ProcessInfo,
  StatusLevel,
  ThresholdConfig,
  ThresholdRule,
  TimeSeriesPoint,
  TransportStatus,
  WidgetSnapshot,
} from './types';

export { Emitter, type Disposable, type Listener } from './emitter';
export {
  LOG_LEVELS,
  LEVEL_SEVERITY,
  emptyLogFilter,
  levelAtLeast,
  toLogLevel,
  type LogAttributeValue,
  type LogBucket,
  type LogEntry,
  type LogFilter,
  type LogLevel,
  type LogServiceStat,
  type LogSnapshot,
  type LogStats,
} from './log-types';
export { normalizeLogEntry, normalizeLogSnapshot, toEpochMs } from './log-normalize';
export { LogStore, type LogStoreEvents, type LogStoreOptions } from './log-store';
export { normalizeContainer, normalizeContainerSnapshot, parseQuantity, type QuantityDimension } from './container-normalize';
export {
  HEALTH_RANK,
  emptyContainerFilter,
  healthFromPhase,
  toContainerHealth,
  toContainerPhase,
  type ClusterSummary,
  type ContainerFilter,
  type ContainerHealth,
  type ContainerInfo,
  type ContainerPhase,
  type ContainerSnapshot,
  type ContainerSpec,
  type ContainerStats,
  type ResourceUsage,
  type WorkloadKind,
} from './container-types';
export { ContainerStore, type ContainerStoreEvents, type ContainerStoreOptions } from './container-store';
export { createMockContainer, createMockContainerSnapshot, type MockContainerOptions } from './container-mock';
export { createMockLogEntry, createMockLogSnapshot, type MockLogOptions } from './log-mock';
export {
  createTransport,
  isMockSource,
  isStaticSource,
  isTransport,
  StaticPollTransport,
  type MockSourceDescriptor,
  type NetworkSourceDescriptor,
  type SourceOptions,
  type WidgetSource,
} from './source';
export {
  darkTheme,
  lightTheme,
  themes,
  resolveTheme,
  hexToRgb,
  mixHex,
  withAlpha,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
} from './theme';
export {
  classify,
  computeHealth,
  defaultThresholds,
  mergeThresholds,
  swapUsagePercent,
  worstStatus,
} from './thresholds';
export {
  compactNumber,
  formatBytes,
  formatLatency,
  formatPercent,
  formatRate,
  formatUptime,
  niceCeil,
  type ByteFormatOptions,
} from './format';
export { WidgetStore, type StoreEvents, type StoreOptions } from './store';
export { WidgetConnector, type ConnectorEvents, type SnapshotSink } from './connector';
export { createMockSnapshot, mockTotals, type MockSnapshotOptions } from './mock';
export { normalizeSnapshot } from './normalize';
export { createTranslator, translations, en, fa, type I18nKey, type Messages, type Translator } from './i18n';

export {
  BaseTransport,
  HttpTransport,
  MockTransport,
  SseTransport,
  WebSocketTransport,
  initialStatus,
  nextBackoff,
  toError,
  type BackoffOptions,
  type DataTransport,
  type DataTransportEvents,
  type EventSourceFactory,
  type EventSourceLike,
  type HttpTransportOptions,
  type MockTransportOptions,
  type SocketFactory,
  type SocketLike,
  type SseTransportOptions,
  type WebSocketTransportOptions,
} from './transport/index';
