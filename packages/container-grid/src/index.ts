/**
 * @widgets/container-grid
 *
 * Responsive pod/service health grid packaged as the `<container-grid>` web
 * component, so the same fleet view runs on the web, in a Windows WebView2 shell,
 * inside an Android WebView and in a WKWebView — fed by the `@widgets/core` layer.
 *
 * ```ts
 * import { defineContainerGrid } from '@widgets/container-grid';
 * defineContainerGrid();
 * const fleet = document.createElement('container-grid');
 * fleet.setConfig({ source: 'wss://k8s.example.com/stream', sort: 'severity' });
 * document.body.append(fleet);
 * ```
 */

export { ContainerGridElement, HTMLElementBase, mockContainerSnapshot } from './element';
export { defineContainerGrid, type ContainerGridAttributes } from './define';
export {
  createContainerGridTransport,
  defaultConfig,
  isMockSource,
  isStaticSource,
  resolveConfig,
  type ContainerGridConfig,
  type MockContainerSource,
  type ResolvedConfig,
  type WidgetSource,
} from './config';
export {
  GRID_SECTIONS,
  computeGridGeometry,
  computeGridLayout,
  computeGridWindow,
  maxGridScroll,
  type GridGeometry,
  type GridLayout,
  type GridLayoutOptions,
  type GridSectionId,
  type GridWindow,
} from './layout';
export {
  buildContainerGridViewModel,
  sortContainers,
  type CapacityMetric,
  type ContainerCard,
  type ContainerDetail,
  type ContainerGridViewModel,
  type ContainerGridViewModelInput,
  type GridAction,
  type GridCounter,
  type NamespaceChip,
  type NamespaceRow,
  type PhaseChip,
} from './view-model';
export { renderContainerGrid, type GridRenderOptions, type GridRenderResult } from './renderer';
export { drawCards, drawSparkline, type CardsOptions } from './draw/cards';
export { drawCapacity, drawFilters, drawNamespaces, drawToolbar } from './draw/summary';
export { drawDetail } from './draw/detail';
