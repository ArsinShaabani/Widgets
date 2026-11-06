/** Map of vector glyphs drawn with strokes on canvas (no font dependencies). */
export type IconName = 'settings' | 'logs' | 'share' | 'network' | 'location' | 'link' | 'server' | 'alert';

/**
 * Path painters. Each callback draws inside a 24×24 box centred on (0,0) so the
 * caller can scale/translate freely; strokes are applied by the caller.
 */
export const ICON_PATHS: Record<IconName, (ctx: CanvasPath, cx: number, cy: number) => void> = {
  settings: (ctx, cx, cy) => {
    ctx.moveTo(cx - 6, cy - 9);
    ctx.lineTo(cx + 6, cy - 9);
    ctx.moveTo(cx - 6, cy + 9);
    ctx.lineTo(cx + 6, cy + 9);
    ctx.moveTo(cx - 2, cy - 9);
    ctx.lineTo(cx - 2, cy - 3);
    ctx.moveTo(cx + 3, cy + 9);
    ctx.lineTo(cx + 3, cy + 3);
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx - 1, cy - 1);
    ctx.arc(cx - 1, cy - 1, 2.2, 0, Math.PI * 2);
    ctx.moveTo(cx + 3, cy + 1);
    ctx.arc(cx + 3, cy + 1, 2.2, 0, Math.PI * 2);
  },
  logs: (ctx, cx, cy) => {
    ctx.moveTo(cx - 10, cy - 8);
    ctx.lineTo(cx - 3, cy - 8);
    ctx.lineTo(cx - 3, cy + 1);
    ctx.lineTo(cx - 10, cy + 1);
    ctx.closePath();
    ctx.moveTo(cx - 4, cy + 5);
    ctx.lineTo(cx + 10, cy + 5);
    ctx.lineTo(cx + 10, cy + 9);
    ctx.lineTo(cx - 4, cy + 9);
    ctx.closePath();
    ctx.moveTo(cx + 4, cy - 9);
    ctx.lineTo(cx + 8, cy - 9);
    ctx.lineTo(cx + 8, cy - 2);
    ctx.lineTo(cx + 4, cy - 2);
    ctx.closePath();
  },
  share: (ctx, cx, cy) => {
    ctx.moveTo(cx - 9, cy + 6);
    ctx.lineTo(cx + 9, cy - 4);
    ctx.lineTo(cx + 9, cy + 6);
    ctx.lineTo(cx - 9, cy - 4);
    ctx.closePath();
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx, cy + 4);
  },
  network: (ctx, cx, cy) => {
    ctx.moveTo(cx, cy + 9);
    ctx.lineTo(cx, cy - 1);
    ctx.moveTo(cx - 6, cy - 1);
    ctx.lineTo(cx + 6, cy - 1);
    ctx.moveTo(cx - 6, cy - 1);
    ctx.lineTo(cx, cy - 9);
    ctx.lineTo(cx + 6, cy - 1);
  },
  location: (ctx, cx, cy) => {
    ctx.moveTo(cx, cy + 10);
    ctx.lineTo(cx - 6, cy - 2);
    ctx.arc(cx, cy - 3, 5.6, Math.PI * 0.75, Math.PI * 0.25, false);
    ctx.closePath();
    ctx.moveTo(cx, cy - 6);
    ctx.arc(cx, cy - 3, 2.2, 0, Math.PI * 2);
  },
  link: (ctx, cx, cy) => {
    ctx.moveTo(cx - 10, cy + 4);
    ctx.lineTo(cx - 10, cy - 4);
    ctx.lineTo(cx - 4, cy - 4);
    ctx.moveTo(cx + 10, cy - 4);
    ctx.lineTo(cx + 10, cy + 4);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
  },
  server: (ctx, cx, cy) => {
    ctx.moveTo(cx - 9, cy - 9);
    ctx.lineTo(cx + 9, cy - 9);
    ctx.lineTo(cx + 9, cy - 1);
    ctx.lineTo(cx - 9, cy - 1);
    ctx.closePath();
    ctx.moveTo(cx - 9, cy + 2);
    ctx.lineTo(cx + 9, cy + 2);
    ctx.lineTo(cx + 9, cy + 9);
    ctx.lineTo(cx - 9, cy + 9);
    ctx.closePath();
    ctx.moveTo(cx - 6, cy - 5);
    ctx.lineTo(cx - 4, cy - 5);
    ctx.moveTo(cx - 6, cy + 5.5);
    ctx.lineTo(cx - 4, cy + 5.5);
  },
  alert: (ctx, cx, cy) => {
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx + 9, cy + 8);
    ctx.lineTo(cx - 9, cy + 8);
    ctx.closePath();
    ctx.moveTo(cx, cy - 2);
    ctx.lineTo(cx, cy + 3);
    ctx.moveTo(cx, cy + 6);
    ctx.lineTo(cx, cy + 6.01);
  },
};
