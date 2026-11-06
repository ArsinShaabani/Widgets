/**
 * Minimal CanvasRenderingContext2D double.
 *
 * Records call counts so renderers can be unit tested without a real canvas
 * (jsdom returns `null` from `getContext('2d')` unless the native `canvas`
 * package is installed, which we deliberately avoid in CI).
 */
export interface FakeContext extends CanvasRenderingContext2D {
  calls: Record<string, number>;
  /** Every `fillText` argument, in order — handy for copy assertions. */
  texts: string[];
  /** Every gradient created, with the stops that were added. */
  gradients: Array<Array<[number, string]>>;
}

export function createFakeContext(options: { textWidth?: number } = {}): FakeContext {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  const gradients: Array<Array<[number, string]>> = [];
  const textWidth = options.textWidth ?? 6;

  const record = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  const noop =
    (name: string) =>
    (...args: unknown[]) => {
      record(name);
      void args;
    };

  const gradient = () => {
    const stops: Array<[number, string]> = [];
    gradients.push(stops);
    return {
      addColorStop: (offset: number, color: string) => {
        record('addColorStop');
        stops.push([offset, color]);
      },
    } as unknown as CanvasGradient;
  };

  const ctx = {
    calls,
    texts,
    gradients,
    canvas: { width: 0, height: 0 } as HTMLCanvasElement,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'middle',
    save: noop('save'),
    restore: noop('restore'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    arc: noop('arc'),
    arcTo: noop('arcTo'),
    bezierCurveTo: noop('bezierCurveTo'),
    quadraticCurveTo: noop('quadraticCurveTo'),
    rect: noop('rect'),
    roundRect: noop('roundRect'),
    fill: noop('fill'),
    stroke: noop('stroke'),
    clip: noop('clip'),
    translate: noop('translate'),
    scale: noop('scale'),
    rotate: noop('rotate'),
    setTransform: noop('setTransform'),
    resetTransform: noop('resetTransform'),
    setLineDash: noop('setLineDash'),
    clearRect: noop('clearRect'),
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    fillText: (text: string) => {
      record('fillText');
      texts.push(text);
    },
    strokeText: noop('strokeText'),
    measureText: (text: string) => {
      record('measureText');
      return { width: text.length * textWidth } as TextMetrics;
    },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => null,
    drawImage: noop('drawImage'),
  } as unknown as FakeContext;

  return ctx;
}
