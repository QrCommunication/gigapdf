import { createCanvas, type Canvas } from 'canvas';

interface PooledCanvas {
  canvas: Canvas;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any;
  inUse: boolean;
}

let poolSize = 4;
let pool: PooledCanvas[] = [];

export function setCanvasPoolSize(size: number): void {
  poolSize = Math.max(1, Math.min(size, 16));
}

export async function acquireCanvas(
  width: number,
  height: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ canvas: Canvas; ctx: any; release: () => void }> {
  let entry = pool.find(p => !p.inUse);

  if (!entry && pool.length < poolSize) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    entry = { canvas, ctx, inUse: false };
    pool.push(entry);
  }

  if (!entry) {
    await new Promise<void>(resolve => {
      const check = () => {
        entry = pool.find(p => !p.inUse);
        if (entry) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }

  entry!.canvas.width = width;
  entry!.canvas.height = height;
  entry!.inUse = true;

  const poolEntry = entry!;
  return {
    canvas: poolEntry.canvas,
    ctx: poolEntry.ctx,
    release: () => {
      poolEntry.inUse = false;
    },
  };
}

export function destroyCanvasPool(): void {
  pool = [];
}
