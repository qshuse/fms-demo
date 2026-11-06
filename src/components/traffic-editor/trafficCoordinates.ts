import { BuildingMap, Level, MapVertex } from '../../types/rmf';

export interface MapCoordinateSystem {
  hasImage: boolean;
  effectiveScale: number; // meters per pixel (or 1.0 for pixel mode)
  isPixelMode: boolean; // true if coordinates represent raw image pixels
  imageWidth: number;
  imageHeight: number;
  padding: number;
  canvasWidth: number;
  canvasHeight: number;
  toCanvasPos: (x: number, y: number) => { x: number; y: number };
  fromCanvasPos: (cx: number, cy: number) => { x: number; y: number };
  toThreePos: (x: number, y: number) => { x: number; z: number };
  get3DGroundDimensions: () => { width: number; height: number };
}

/**
 * Calculates a rock-solid, unified coordinate system anchored to the reference floorplan image.
 * Ensures 100% alignment across:
 * 1. Traffic Editor (2D canvas)
 * 2. Digital Twin Map (2D blueprint)
 * 3. Digital Twin Map (3D Three.js)
 */
export function computeMapCoordinateSystem(
  buildingMap: BuildingMap,
  currentLevel: Level | undefined,
  floorplanImg: HTMLImageElement | null,
  verticesToCheck?: MapVertex[],
): MapCoordinateSystem {
  const padding = 80;
  const bName = (buildingMap?.name || '').toLowerCase();

  // 1. Check if we have an image
  const hasImage = Boolean(floorplanImg && floorplanImg.naturalWidth > 0);
  const imgW = hasImage ? floorplanImg!.naturalWidth : 1000;
  const imgH = hasImage ? floorplanImg!.naturalHeight : 1000;

  // 2. Calibrated scale for famous demo buildings
  let effectiveScale = 1.0;
  let isPixelMode = false;

  const metaScale = currentLevel?.images?.[0]?.scale;

  const imgName = (currentLevel?.images?.[0]?.name || '').toLowerCase();
  if (bName.includes('office') || imgName.includes('office') || bName.includes('building')) {
    effectiveScale = 0.0084655; // Calibrated 3047px office scale
  } else if (bName.includes('hotel')) {
    effectiveScale = 0.05568;
  } else if (bName.includes('airport') || bName.includes('terminal')) {
    effectiveScale = 0.08212;
  } else if (metaScale && metaScale > 0.0001 && metaScale < 0.4) {
    effectiveScale = metaScale;
  } else {
    // Custom uploaded or imported map
    const allVertices: MapVertex[] = [
      ...(verticesToCheck || []),
      ...(currentLevel?.nav_graphs?.flatMap((g) => g.vertices) || []),
    ];
    const maxCoord = allVertices.reduce(
      (max, v) => Math.max(max, Math.abs(v.x), Math.abs(v.y)),
      0,
    );

    if (maxCoord > 50 || (hasImage && maxCoord > 30)) {
      // Coordinates were created directly from image pixels (e.g. 402, -207)
      effectiveScale = 1.0;
      isPixelMode = true;
    } else if (hasImage) {
      // Small metric coordinates (e.g. 10m, 20m)
      effectiveScale = 0.05; // 20 px/m
      isPixelMode = false;
    } else {
      effectiveScale = 1.0;
      isPixelMode = false;
    }
  }

  if (hasImage) {
    const toCanvasPos = (x: number, y: number) => {
      // In Open-RMF:
      // x is meters from image left: px = x / effectiveScale
      // y is meters from image top: py = -y / effectiveScale (since Y in Open-RMF is negative downwards)
      const px = x / effectiveScale;
      const py = y <= 0 ? -y / effectiveScale : y / effectiveScale;
      return {
        x: padding + px,
        y: padding + py,
      };
    };

    const fromCanvasPos = (cx: number, cy: number) => {
      const px = cx - padding;
      const py = cy - padding;
      return {
        x: parseFloat((px * effectiveScale).toFixed(3)),
        y: parseFloat((-py * effectiveScale).toFixed(3)),
      };
    };

    const scale3D = effectiveScale === 1.0 ? 0.05 : effectiveScale;
    const w3D = imgW * scale3D;
    const h3D = imgH * scale3D;

    const toThreePos = (x: number, y: number) => {
      const px = x / effectiveScale;
      const py = y <= 0 ? -y / effectiveScale : y / effectiveScale;
      return {
        x: -w3D / 2 + px * scale3D,
        z: -h3D / 2 + py * scale3D,
      };
    };

    const get3DGroundDimensions = () => ({
      width: w3D,
      height: h3D,
    });

    return {
      hasImage: true,
      effectiveScale,
      isPixelMode,
      imageWidth: imgW,
      imageHeight: imgH,
      padding,
      canvasWidth: imgW + padding * 2,
      canvasHeight: imgH + padding * 2,
      toCanvasPos,
      fromCanvasPos,
      toThreePos,
      get3DGroundDimensions,
    };
  }

  // Fallback for maps without an image (e.g. VNTT_HighTech_Campus)
  return {
    hasImage: false,
    effectiveScale: 1.0,
    isPixelMode: false,
    imageWidth: 1000,
    imageHeight: 650,
    padding: 0,
    canvasWidth: 1000,
    canvasHeight: 650,
    toCanvasPos: (x: number, y: number) => ({ x, y }),
    fromCanvasPos: (cx: number, cy: number) => ({ x: cx, y: cy }),
    toThreePos: (x: number, y: number) => {
      const scale = 0.05;
      return { x: (x - 600) * scale, z: (y - 450) * scale };
    },
    get3DGroundDimensions: () => ({ width: 50, height: 35 }),
  };
}
