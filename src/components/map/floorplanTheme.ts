const darkCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

// Turns a white-paper floorplan into light-grey lines on a dark background,
// so lanes, waypoints and robots stand out on the dark UI. Built once per image.
export function getDarkFloorplan(img: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const cached = darkCache.get(img);
  if (cached) return cached;
  if (!img.naturalWidth || !img.naturalHeight) return img;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img;

  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#8fa3b8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  darkCache.set(img, canvas);
  return canvas;
}
