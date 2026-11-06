import JSZip from 'jszip';
import { NavGraph, BuildingMap, MapVertex, MapLane } from '../../types/rmf';

/**
 * Open-RMF parameter type codes:
 * 1: String
 * 2: Integer
 * 3: Double (Float)
 * 4: Boolean
 */

/**
 * Formats a vertex into 100% standard Open-RMF traffic_editor format:
 * - [x, y, z, "name"] if no params
 * - [x, y, z, "name", { param_name: [type_id, value] }] if has params
 */
function formatRmfVertex(v: MapVertex, idx: number, flipY = false): string {
  const y = flipY ? -v.y : v.y;
  const params: string[] = [];
  if (v.is_charger) params.push(`is_charger: [4, true]`);
  if (v.is_parking_spot) params.push(`is_parking_spot: [4, true]`);
  if (v.is_holding_point) params.push(`is_holding_point: [4, true]`);
  if (v.yaw !== undefined) params.push(`yaw: [3, ${v.yaw.toFixed(4)}]`);

  const nameStr = v.name ? JSON.stringify(v.name.replace(/^"|"$/g, '')) : `""`;
  if (params.length > 0) {
    return `      - [${v.x.toFixed(4)}, ${y.toFixed(4)}, 0, ${nameStr}, {${params.join(', ')}}] # vertex ${idx}`;
  }
  return `      - [${v.x.toFixed(4)}, ${y.toFixed(4)}, 0, ${nameStr}] # vertex ${idx}`;
}

/**
 * Formats a lane into 100% standard Open-RMF traffic_editor format:
 * - [entry, exit, { bidirectional: [4, true], graph_idx: [2, 0], orientation: [1, ""], speed_limit: [3, 0] }]
 */
function formatRmfLane(l: MapLane, graphIdx: number, idx: number): string {
  const props: string[] = [];
  props.push(`bidirectional: [4, ${l.two_way ? 'true' : 'false'}]`);
  props.push(`graph_idx: [2, ${graphIdx}]`);
  props.push(`orientation: [1, ""]`);
  props.push(`speed_limit: [3, ${l.speed_limit || 0}]`);
  if (l.mutex_group) props.push(`mutex: [1, "${l.mutex_group}"]`);
  if (l.is_closed) props.push(`is_closed: [4, true]`);

  return `      - [${l.entry}, ${l.exit}, {${props.join(', ')}}] # lane ${idx}`;
}

/**
 * Exports 100% standard Open-RMF `.building.yaml` for this level,
 * directly readable by `traffic-editor` and `ros2 run rmf_building_map_tools building_map_generator`.
 */
export function exportStandardBuildingYaml(
  buildingMap: BuildingMap,
  currentFloor: string,
  currentGraph: NavGraph,
  graphIndex: number,
  customImageFilename?: string,
): string {
  const cleanName = (buildingMap.name || 'building').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const level = buildingMap.levels.find((lvl) => lvl.name === currentFloor) || buildingMap.levels[0];
  const imageName = customImageFilename || level?.images?.[0]?.name || `${cleanName}_${currentFloor}.png`;

  const lines: string[] = [];
  lines.push(`coordinate_system: reference_image`);
  lines.push(`name: ${cleanName}`);
  lines.push(`graphs:`);
  lines.push(`  {}`);
  lines.push(`levels:`);
  lines.push(`  ${currentFloor}:`);
  lines.push(`    drawing:`);
  lines.push(`      filename: ${imageName}`);
  lines.push(`    elevation: ${level?.elevation || 0}`);
  lines.push(`    doors: []`);

  // Lanes - Must be explicit [] when empty to prevent Python TypeError("'NoneType' object is not iterable")
  if (!currentGraph.lanes || currentGraph.lanes.length === 0) {
    lines.push(`    lanes: []`);
  } else {
    lines.push(`    lanes:`);
    currentGraph.lanes.forEach((l, idx) => {
      lines.push(formatRmfLane(l, graphIndex, idx));
    });
  }

  lines.push(`    measurements: []`);
  lines.push(`    models: []`);

  // Vertices - Must be explicit [] when empty to prevent Python TypeError
  if (!currentGraph.vertices || currentGraph.vertices.length === 0) {
    lines.push(`    vertices: []`);
  } else {
    lines.push(`    vertices:`);
    currentGraph.vertices.forEach((v, idx) => {
      lines.push(formatRmfVertex(v, idx, true));
    });
  }

  lines.push(`    walls: []`);
  lines.push(`lifts: {}`);

  return lines.join('\n');
}

/**
 * Standalone NavGraph YAML snippet
 */
export function exportNavGraphToYaml(navGraph: NavGraph, floorName: string, graphIndex = 0): string {
  const lines: string[] = [];
  lines.push(`# Open-RMF Traffic NavGraph Snippet`);
  lines.push(`# Floor: ${floorName} | Graph: ${navGraph.name || 'default'} (index: ${graphIndex})`);
  lines.push(`# Generated at: ${new Date().toISOString()}`);
  lines.push(``);

  if (!navGraph.lanes || navGraph.lanes.length === 0) {
    lines.push(`lanes: []`);
  } else {
    lines.push(`lanes:`);
    navGraph.lanes.forEach((l, idx) => {
      lines.push(formatRmfLane(l, graphIndex, idx).replace(/^ {4}/, ''));
    });
  }

  lines.push(``);
  if (!navGraph.vertices || navGraph.vertices.length === 0) {
    lines.push(`vertices: []`);
  } else {
    lines.push(`vertices:`);
    navGraph.vertices.forEach((v, idx) => {
      lines.push(formatRmfVertex(v, idx).replace(/^ {4}/, ''));
    });
  }

  return lines.join('\n');
}

/**
 * Downloads a string as a file on client browser
 */
export function triggerFileDownload(content: string, filename: string, mimeType = 'text/yaml;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  triggerBlobDownload(blob, filename);
}

/**
 * Downloads a Blob directly
 */
export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface MapZipPackageOptions {
  buildingName: string;
  floorName: string;
  navGraph: NavGraph;
  graphIndex: number;
  imageBlob: Blob | File;
  imageFilename: string;
  buildingMap?: BuildingMap;
}

/**
 * Packages the 2D map image and the standard Open-RMF .building.yaml into a .zip file
 * strictly adhering to RMF format for POST /building-map
 */
export async function createBuildingMapZip(options: MapZipPackageOptions): Promise<{
  zipBlob: Blob;
  yamlContent: string;
  yamlFilename: string;
  imageFilename: string;
}> {
  const zip = new JSZip();
  const { buildingName, floorName, navGraph, graphIndex, imageBlob, imageFilename, buildingMap } = options;

  const yamlContent = exportStandardBuildingYaml(
    buildingMap || {
      name: buildingName,
      levels: [
        {
          name: floorName,
          elevation: 0,
          nav_graphs: [navGraph],
          doors: [],
          wall_segments: [],
          images: [{ name: imageFilename, scale: 1, x_offset: 0, y_offset: 0, yaw: 0, data: '' }],
        },
      ],
      lifts: [],
    },
    floorName,
    navGraph,
    graphIndex,
    imageFilename,
  );

  const cleanName = (buildingName || 'building').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const yamlFilename = `${cleanName}.building.yaml`;

  // 1. Add YAML file to zip
  zip.file(yamlFilename, yamlContent);

  // 2. Add 2D Map Image file to zip
  zip.file(imageFilename, imageBlob);

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
  });

  return {
    zipBlob,
    yamlContent,
    yamlFilename,
    imageFilename,
  };
}

/**
 * Extracts 2D map image and YAML from an uploaded .zip file
 */
export async function extractBuildingMapZip(zipFile: File | Blob): Promise<{
  imageBlob: Blob | null;
  imageFilename: string | null;
  imageDataUrl: string | null;
  yamlContent: string | null;
  yamlFilename: string | null;
  parsedGraph: Partial<NavGraph> | null;
  buildingName: string | null;
  floorName: string | null;
}> {
  const zip = await JSZip.loadAsync(zipFile);
  let imageBlob: Blob | null = null;
  let imageFilename: string | null = null;
  let imageDataUrl: string | null = null;
  let yamlContent: string | null = null;
  let yamlFilename: string | null = null;
  let parsedGraph: Partial<NavGraph> | null = null;
  let buildingName: string | null = null;
  let floorName: string | null = null;

  for (const relativePath of Object.keys(zip.files)) {
    const file = zip.files[relativePath];
    if (file.dir) continue;
    const lower = relativePath.toLowerCase();

    // Match 2D Map Image
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.webp')
    ) {
      const mime = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.svg')
          ? 'image/svg+xml'
          : lower.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
      const rawBlob = await file.async('blob');
      imageBlob = new Blob([rawBlob], { type: mime });
      imageFilename = relativePath.split('/').pop() || relativePath;
      imageDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(imageBlob!);
      });
    }

    // Match YAML
    if (lower.endsWith('.building.yaml') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
      yamlContent = await file.async('text');
      yamlFilename = relativePath.split('/').pop() || relativePath;
      parsedGraph = parseNavGraphContent(yamlContent);

      const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
      if (nameMatch) buildingName = nameMatch[1].trim();

      const floorMatch = yamlContent.match(/levels:\s*\n\s*([a-zA-Z0-9_-]+):/);
      if (floorMatch) floorName = floorMatch[1].trim();
    }
  }

  return {
    imageBlob,
    imageFilename,
    imageDataUrl,
    yamlContent,
    yamlFilename,
    parsedGraph,
    buildingName,
    floorName,
  };
}

/**
 * Parses user imported JSON or Open-RMF .building.yaml into NavGraph
 */
export function parseNavGraphContent(content: string): Partial<NavGraph> | null {
  try {
    // 1. Try JSON
    const parsed = JSON.parse(content);
    if (parsed.vertices && Array.isArray(parsed.vertices)) {
      return parsed as NavGraph;
    }
  } catch {
    // Not json, attempt YAML parsing
  }

  try {
    const vertices: MapVertex[] = [];
    const lanes: MapLane[] = [];
    const lines = content.split('\n');
    const flipY = /^coordinate_system:\s*reference_image/m.test(content);
    let section: 'none' | 'vertices' | 'lanes' = 'none';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (line.startsWith('vertices:')) {
        section = 'vertices';
        continue;
      }
      if (line.startsWith('lanes:')) {
        section = 'lanes';
        continue;
      }

      if (section === 'vertices' && line.startsWith('- [')) {
        // Match Open-RMF vertex line:
        // - [127.862, 550.573, 0, "name", {...}] or - [127.862, 550.573, 0, "name"]
        const match = line.match(/- \[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*("?.*?"?)(?:,\s*\{(.*?)\})?\s*\]/);
        if (match) {
          const x = parseFloat(match[1]);
          const y = flipY ? -parseFloat(match[2]) : parseFloat(match[2]);
          let name = match[4]?.trim() || '';
          if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
          const extra = match[5] || '';

          const is_charger = extra.includes('is_charger: [4, true]') || extra.includes('is_charger: true');
          const is_parking_spot = extra.includes('is_parking_spot: [4, true]') || extra.includes('is_parking_spot: true');
          const is_holding_point = extra.includes('is_holding_point: [4, true]') || extra.includes('is_holding_point: true');

          vertices.push({
            index: vertices.length,
            x,
            y,
            name: name || `wp_${vertices.length + 1}`,
            is_charger,
            is_parking_spot,
            is_holding_point,
          });
        }
      } else if (section === 'lanes' && line.startsWith('- [')) {
        // Match Open-RMF lane line:
        // - [0, 1, {bidirectional: [4, true], ...}]
        const match = line.match(/- \[\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*\{(.*?)\})?\s*\]/);
        if (match) {
          const entry = parseInt(match[1], 10);
          const exit = parseInt(match[2], 10);
          const extra = match[3] || '';
          const two_way = !extra.includes('bidirectional: [4, false]') && !extra.includes('bidirectional: false');
          const is_closed = extra.includes('is_closed: [4, true]') || extra.includes('is_closed: true');

          lanes.push({
            index: lanes.length,
            entry,
            exit,
            two_way,
            is_closed,
          });
        }
      }
    }

    if (vertices.length > 0) {
      return {
        name: 'importedGraph',
        vertices,
        lanes,
      };
    }
  } catch (err) {
    console.error('Error parsing nav graph', err);
  }

  return null;
}
