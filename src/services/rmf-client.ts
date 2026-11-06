import axios, { AxiosInstance } from 'axios';
import { io, Socket } from 'socket.io-client';
import {
  BuildingMap,
  FleetState,
  TaskState,
  DoorState,
  LiftState,
  Door,
  TaskLogEntry,
  RobotState,
  WorkcellItem,
} from '../types/rmf';
import {
  FleetConfigBody,
  FleetConfigRecord,
  NavGraphDetail,
  NavGraphFile,
  RobotBody,
  RobotRecord,
} from '../types/fmsApi';

export function describeApiError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: any } })?.response;
  const data = response?.data;
  if (data && typeof data === 'object') {
    const details = Array.isArray(data.errors)
      ? data.errors.map((item: any) => item?.detail).filter(Boolean)
      : [];
    const text = [data.message, ...details].filter(Boolean).join(' - ');
    if (text) return `${response?.status ?? ''} ${text}`.trim();
  }
  return (error as Error)?.message || 'Unknown error';
}

const DEFAULT_API_URL =
  import.meta.env.VITE_RMF_API_SERVER_URL || 'https://rmf-api.qshudev.cloud';
const DEFAULT_TRAJECTORY_URL =
  import.meta.env.VITE_RMF_TRAJECTORY_SERVER_URL || 'wss://rmf-api.qshudev.cloud/trajectory';

export class RmfClient {
  private apiServerUrl: string;
  private trajectoryServerUrl: string;
  private http: AxiosInstance;
  private sio: Socket | null = null;
  private connected: boolean = false;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(
    apiServerUrl = DEFAULT_API_URL,
    trajectoryServerUrl = DEFAULT_TRAJECTORY_URL,
  ) {
    this.apiServerUrl = apiServerUrl;
    this.trajectoryServerUrl = trajectoryServerUrl;
    this.http = axios.create({
      baseURL: apiServerUrl,
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  public updateUrls(apiServerUrl: string, trajectoryServerUrl: string) {
    this.apiServerUrl = apiServerUrl;
    this.trajectoryServerUrl = trajectoryServerUrl;
    this.http.defaults.baseURL = apiServerUrl;
    if (this.sio) {
      this.disconnectSocket();
      this.initSocket();
    }
  }

  public initSocket(onConnectChange?: (connected: boolean) => void) {
    try {
      const url = new URL(this.apiServerUrl);
      this.sio = io(url.origin, {
        path: url.pathname === '/' ? '/socket.io' : `${url.pathname}/socket.io`,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 8000,
      });

      this.sio.on('connect', () => {
        this.connected = true;
        onConnectChange?.(true);
        for (const [room] of this.listeners) {
          this.sio?.emit('subscribe', { room });
        }
      });

      this.sio.on('disconnect', () => {
        this.connected = false;
        onConnectChange?.(false);
      });

      this.sio.on('connect_error', () => {
        this.connected = false;
        onConnectChange?.(false);
      });
    } catch (e) {
      this.connected = false;
      onConnectChange?.(false);
    }
  }

  public disconnectSocket() {
    if (this.sio) {
      this.sio.disconnect();
      this.sio = null;
    }
    this.connected = false;
  }

  public subscribe<T>(room: string, handler: (data: T) => void): () => void {
    if (!this.listeners.has(room)) {
      this.listeners.set(room, new Set());
      if (this.sio && this.connected) {
        this.sio.emit('subscribe', { room });
      }
    }
    this.listeners.get(room)!.add(handler);

    const onMessage = (data: T) => handler(data);
    this.sio?.on(room, onMessage);

    return () => {
      const set = this.listeners.get(room);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.listeners.delete(room);
          this.sio?.emit('unsubscribe', { room });
        }
      }
      this.sio?.off(room, onMessage);
    };
  }

  // REST API Methods with real RMF Schema Normalization
  public async getBuildingMap(): Promise<BuildingMap> {
    const res = await this.http.get<any>('/building-map');
    const raw = res.data?.data ?? res.data?.value ?? res.data;
    if (!raw) return { name: 'Building', levels: [], lifts: [] };

    const normalizedLevels = await Promise.all(
      (raw.levels || []).map(async (level: any) => {
      // 1. Normalize Wall Segments from wall_graph
      let wallSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];
      if (level.wall_graph?.vertices && level.wall_graph?.edges) {
        const verts = level.wall_graph.vertices;
        level.wall_graph.edges.forEach((edge: any) => {
          const v1 = verts[edge.v1_idx];
          const v2 = verts[edge.v2_idx];
          if (v1 && v2) {
            wallSegments.push({
              x1: v1.x,
              y1: v1.y,
              x2: v2.x,
              y2: v2.y,
            });
          }
        });
      }

      // 2. Normalize Doors
      const normalizedDoors = (level.doors || []).map((d: any) => {
        const v1x = d.v1?.x ?? d.v1_x;
        const v1y = d.v1?.y ?? d.v1_y;
        const v2x = d.v2?.x ?? d.v2_x;
        const v2y = d.v2?.y ?? d.v2_y;
        const midX = v1x !== undefined && v2x !== undefined ? (v1x + v2x) / 2 : (d.x ?? 0);
        const midY = v1y !== undefined && v2y !== undefined ? (v1y + v2y) / 2 : (d.y ?? 0);
        const yaw = v1x !== undefined && v2x !== undefined && v1y !== undefined && v2y !== undefined
          ? Math.atan2(v2y - v1y, v2x - v1x)
          : (d.yaw ?? 0);
        return {
          name: d.name,
          door_type: d.door_type ?? 1,
          motion_range: d.motion_range ?? 1.57,
          motion_direction: d.motion_direction ?? 1,
          level_name: level.name,
          x: midX,
          y: midY,
          yaw,
        };
      });

      // 3. Normalize Nav Graphs (vertices & edges -> lanes)
      const normalizedNavGraphs = (level.nav_graphs || []).map((g: any, gIdx: number) => {
        const vertices = (g.vertices || []).map((v: any, vIdx: number) => {
          let isCharger = false;
          let isParking = false;
          let isHolding = false;
          if (Array.isArray(v.params)) {
            v.params.forEach((p: any) => {
              const enabled = p.value_bool ?? p.value ?? false;
              if (p.name === 'is_charger' && enabled) isCharger = true;
              if (p.name === 'is_parking_spot' && enabled) isParking = true;
              if (p.name === 'is_holding_point' && enabled) isHolding = true;
            });
          }
          return {
            index: vIdx,
            x: v.x,
            y: v.y,
            name: v.name || '',
            is_charger: isCharger,
            is_parking_spot: isParking,
            is_holding_point: isHolding,
          };
        });

        const lanes = (g.edges || g.lanes || []).map((e: any, eIdx: number) => ({
          index: eIdx,
          entry: e.v1_idx ?? e.entry ?? 0,
          exit: e.v2_idx ?? e.exit ?? 0,
          two_way: e.edge_type === undefined ? true : e.edge_type === 0,
        }));

        return {
          name: g.name || `graph_${gIdx}`,
          vertices,
          lanes,
          waypoint_names: Array.isArray(g.waypoints)
            ? g.waypoints.filter((name: unknown): name is string => typeof name === 'string')
            : undefined,
        };
      });

      // 4. Normalize Images (Download as Base64 DataURL to prevent CORS/OPTIONS 405 errors)
      const normalizedImages = await Promise.all(
        (level.images || []).map(async (image: any) => {
          let data = image.data;
          if (!data && image.url) {
            const fullUrl = image.url.startsWith('http')
              ? image.url
              : new URL(image.url, this.apiServerUrl).toString();
            try {
              const imgRes = await fetch(fullUrl, { headers: { Accept: 'image/*' } });
              if (imgRes.ok) {
                const blob = await imgRes.blob();
                data = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.readAsDataURL(blob);
                });
              } else {
                data = fullUrl;
              }
            } catch (e) {
              console.warn(`Could not load blob for ${image.url}:`, e);
              data = fullUrl;
            }
          }
          return {
            name: image.name || `level_${level.index ?? level.name}`,
            x_offset: image.x_offset ?? 0,
            y_offset: image.y_offset ?? 0,
            yaw: image.yaw ?? 0,
            scale: image.scale ?? 1,
            data,
          };
        }),
      );

      return {
        name: level.name,
        elevation: level.elevation || 0,
        wall_segments: wallSegments,
        doors: normalizedDoors,
        nav_graphs: normalizedNavGraphs,
        images: normalizedImages,
      };
    }));

    return {
      name: raw.name || 'Building',
      levels: normalizedLevels,
      lifts: raw.lifts || [],
    };
  }

  public async uploadBuildingMap(zipFileOrBlob: Blob | File, filename = 'building_map.zip'): Promise<any> {
    const formData = new FormData();
    formData.append('file', zipFileOrBlob, filename);
    const res = await this.http.post<any>('/building-map', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  }

  public async getFleets(): Promise<FleetState[]> {
    const res = await this.http.get<any>('/fleets');
    const raw = res.data;
    const fleetsArray = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : (raw?.value || []);

    return fleetsArray.map((fleet: any) => {
      let robotsArray: any[] = [];
      if (Array.isArray(fleet.robots)) {
        robotsArray = fleet.robots;
      } else if (fleet.robots && typeof fleet.robots === 'object') {
        robotsArray = Object.values(fleet.robots);
      }

      const normalizedRobots: RobotState[] = robotsArray.map((r: any) => ({
        name: r.name,
        model: r.model || 'Autonomous Mobile Unit',
        battery: r.battery_percent !== undefined
          ? r.battery_percent / 100
          : r.battery !== undefined
            ? (r.battery > 1 ? r.battery / 100 : r.battery)
            : 1.0,
        location: {
          x: r.location?.x ?? 0,
          y: r.location?.y ?? 0,
          yaw: r.location?.yaw ?? 0,
          level_name: r.location?.level ?? r.location?.map ?? r.location?.level_name ?? 'L1',
          speed: r.location?.speed ?? 0,
        },
        path: r.path || [],
        mode: this.normalizeRobotMode(r.status ?? r.mode),
        task_id: r.task_id || null,
        commissioned: r.commission?.dispatch_tasks !== false,
        seq: r.seq || r.unix_millis_time || Date.now(),
        last_heartbeat: Date.now(),
        issues: r.issues || [],
        mutex_groups: r.mutex_groups?.locked || [],
      }));

      return {
        name: fleet.name,
        robots: normalizedRobots,
      };
    });
  }

  private normalizeRobotMode(mode: unknown): RobotState['mode'] {
    if (typeof mode === 'string') {
      const normalized = mode.toLowerCase();
      const aliases: Record<string, RobotState['mode']> = {
        active: 'moving',
        standby: 'idle',
        offline: 'error',
      };
      return aliases[normalized] || normalized as RobotState['mode'];
    }

    // rmf_fleet_msgs/RobotMode constants
    const numericModes: Record<number, RobotState['mode']> = {
      0: 'idle',
      1: 'charging',
      2: 'moving',
      3: 'paused',
      4: 'waiting',
      5: 'emergency',
      6: 'going_home',
      7: 'docked',
    };
    return numericModes[Number(mode)] || 'idle';
  }

  public async getFleetState(fleetName: string): Promise<FleetState> {
    const res = await this.http.get<any>(`/fleets/${fleetName}/state`);
    const f = res.data;
    let robotsArray = Array.isArray(f.robots) ? f.robots : Object.values(f.robots || {});
    return {
      name: f.name,
      robots: robotsArray.map((r: any) => ({
        name: r.name,
        model: r.model || 'Autonomous Mobile Unit',
        battery: r.battery ?? 1.0,
        location: {
          x: r.location?.x ?? 0,
          y: r.location?.y ?? 0,
          yaw: r.location?.yaw ?? 0,
          level_name: r.location?.map ?? r.location?.level_name ?? 'L1',
          speed: r.location?.speed ?? 0,
        },
        path: r.path || [],
        mode: (r.status || r.mode || 'idle').toLowerCase() as any,
        task_id: r.task_id || null,
        commissioned: r.commission?.dispatch_tasks !== false,
      })),
    };
  }

  public async decommissionRobot(
    fleetName: string,
    robotName: string,
    reassignTasks = true,
    allowIdleBehavior = false,
  ) {
    const res = await this.http.post(`/fleets/${fleetName}/decommission`, {
      name: fleetName,
      robot_name: robotName,
      reassign_tasks: reassignTasks,
      allow_idle_behavior: allowIdleBehavior,
    });
    return res.data;
  }

  public async getTasks(status?: string): Promise<TaskState[]> {
    const response = await this.http.get<any>('/tasks', {
      params: { page_index: 1, page_size: 100 },
    });
    const taskRecords = response.data?.data ?? response.data?.value ?? response.data ?? [];

    const mapStatus = (value: unknown): TaskState['status'] => {
      if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (normalized === 'dispatched' || normalized === 'active') return 'underway';
        if (normalized === 'failed_to_assign' || normalized === 'failed') return 'failed';
        if (normalized === 'cancelled') return 'canceled';
        if (normalized === 'complete' || normalized === 'finished') return 'completed';
        return normalized as TaskState['status'];
      }
      const numericStatuses: Record<number, TaskState['status']> = {
        0: 'queued',
        1: 'queued',
        2: 'underway',
        3: 'underway',
        4: 'failed',
        5: 'canceled',
      };
      return numericStatuses[Number(value)] || 'queued';
    };

    const mapped: TaskState[] = (Array.isArray(taskRecords) ? taskRecords : []).flatMap((record: any) => {
      if (!record.task_id) return [];
      const rawCategory = record.category || 'custom';
      const category = rawCategory === 'go_to_place' ? 'move' : rawCategory;
      const effectiveStatus = record.status || record.state_name || record.state;
      const normalizedStatus = mapStatus(effectiveStatus);
      const submittedAt = record.submission_time?.unix_millis
        || (record.created_at ? Date.parse(record.created_at) : undefined);
      const startedAt = record.start_time?.unix_millis || undefined;
      const finishedAt = record.end_time?.unix_millis || undefined;
      return {
        booking: {
          id: record.task_id,
          requester: 'FMS',
          unix_millis_request_time: submittedAt,
        },
        category: category as TaskState['category'],
        assigned_to: record.robot_name || record.fleet_name
          ? { name: record.robot_name || undefined, group: record.fleet_name || undefined }
          : undefined,
        status: normalizedStatus,
        progress: normalizedStatus === 'completed' ? 100 : normalizedStatus === 'underway' ? 50 : 0,
        unix_millis_start_time: startedAt,
        unix_millis_finish_time: finishedAt,
        phases: [{
          id: 1,
          category: rawCategory,
          detail: JSON.stringify(record.description || {}),
          status: normalizedStatus === 'failed'
            ? 'failed'
            : normalizedStatus === 'completed'
              ? 'completed'
              : normalizedStatus === 'underway'
                ? 'underway'
                : 'pending',
        }],
        active_phase_index: 0,
      };
    });

    const filtered = status ? mapped.filter((task) => task.status === status) : mapped;

    return filtered.sort((a, b) => {
      const timeA = a.booking.unix_millis_request_time || a.unix_millis_start_time || 0;
      const timeB = b.booking.unix_millis_request_time || b.unix_millis_start_time || 0;
      return timeB - timeA;
    });
  }

  public async getTaskState(taskId: string): Promise<TaskState> {
    const res = await this.http.get<any>(`/tasks/${taskId}/state`);
    const t = res.data;
    return {
      booking: t.booking || { id: taskId },
      category: (t.category || 'patrol').toLowerCase() as any,
      status: (t.status || 'underway').toLowerCase() as any,
      progress: t.progress ?? 0,
      phases: t.phases || [],
      active_phase_index: t.active_phase_index,
    };
  }

  public async getTaskLogs(taskId: string): Promise<TaskLogEntry[]> {
    try {
      const res = await this.http.get<any>(`/tasks/${taskId}/log`);
      const raw = res.data;
      if (Array.isArray(raw)) return raw;
      if (raw?.phases) {
        const entries: TaskLogEntry[] = [];
        let seq = 1;
        Object.entries(raw.phases).forEach(([phaseId, p]: [string, any]) => {
          if (Array.isArray(p.events)) {
            p.events.forEach((ev: any) => {
              entries.push({
                seq: seq++,
                timestamp: ev.unix_millis_time || Date.now(),
                tier: ev.tier || 'info',
                text: `Phase ${phaseId}: ${ev.name || ev.detail || 'Event registered'}`,
              });
            });
          }
        });
        return entries;
      }
      return [];
    } catch {
      return [];
    }
  }

  public async dispatchTask(request: {
    category: string;
    description: any;
    priority?: number;
    fleet_name?: string;
    requester?: string;
    labels?: string[];
  }) {
    const payload: any = {
      request: {
        category: request.category || 'patrol',
        description: request.description || {},
        requester: request.requester || 'FMS_Operator',
        unix_millis_request_time: Date.now(),
        labels: request.labels || [`app=fms`, `category=${request.category}`],
      },
    };

    if (request.priority !== undefined && request.priority !== null) {
      payload.request.priority = { type: 'binary', value: request.priority };
    }

    if (request.fleet_name) {
      payload.request.fleet_name = request.fleet_name;
    }

    const res = await this.http.post('/tasks/dispatch', payload);
    return res.data;
  }

  public async dispatchRobotTask(options: {
    robot: string;
    fleet: string;
    category: string;
    description: any;
    priority?: number;
    requester?: string;
    labels?: string[];
  }) {
    const requestPayload: any = {
      category: options.category || 'patrol',
      description: options.description || {},
      requester: options.requester || 'FMS_Operator',
      unix_millis_request_time: Date.now(),
      labels: options.labels || [`app=fms`, `category=${options.category}`],
    };

    if (options.priority !== undefined && options.priority !== null) {
      requestPayload.priority = { type: 'binary', value: options.priority };
    }

    requestPayload.fleet_name = options.fleet;
    requestPayload.labels = [
      ...(requestPayload.labels || []),
      `requested_robot=${options.robot}`,
    ];
    const payload = { request: requestPayload };

    const res = await this.http.post('/tasks/dispatch', payload);
    return res.data;
  }

  public async cancelTask(taskId: string) {
    const res = await this.http.post('/tasks/cancel_task', {
      type: 'cancel_task_request',
      task_id: taskId,
    });
    return res.data;
  }

  public async getDoors(): Promise<Door[]> {
    const res = await this.http.get<any>('/doors');
    const raw = res.data?.data ?? res.data?.value ?? res.data;
    const list = Array.isArray(raw) ? raw : (raw?.value || []);
    return list.map((d: any) => {
      const v1x = d.v1?.x ?? d.v1_x;
      const v1y = d.v1?.y ?? d.v1_y;
      const v2x = d.v2?.x ?? d.v2_x;
      const v2y = d.v2?.y ?? d.v2_y;
      return {
        name: d.name,
        door_type: d.door_type ?? 1,
        motion_range: d.motion_range ?? 1.57,
        motion_direction: d.motion_direction ?? 1,
        level_name: d.level_name || d.level || 'L1',
        x: v1x !== undefined && v2x !== undefined ? (v1x + v2x) / 2 : (d.x ?? 0),
        y: v1y !== undefined && v2y !== undefined ? (v1y + v2y) / 2 : (d.y ?? 0),
        yaw: v1x !== undefined && v2x !== undefined && v1y !== undefined && v2y !== undefined
          ? Math.atan2(v2y - v1y, v2x - v1x)
          : (d.yaw ?? 0),
      };
    });
  }

  public async getDoorState(doorName: string): Promise<DoorState> {
    const res = await this.http.get<any>(`/doors/${doorName}/state`);
    const d = res.data?.data ?? res.data?.value ?? res.data ?? {};
    const booleanOpen = d.isOpen ?? d.is_open;
    const modeVal = d.current_mode?.value
      ?? d.current_mode
      ?? d.mode?.value
      ?? d.mode
      ?? (typeof booleanOpen === 'boolean' ? (booleanOpen ? 2 : 0) : 0);
    const rawState = String(d.mode_string ?? d.state_name ?? d.status ?? '').toLowerCase();
    const modeString = rawState === 'open' || modeVal === 2
      ? 'open'
      : rawState === 'moving' || modeVal === 1
        ? 'moving'
        : rawState === 'offline'
          ? 'offline'
          : rawState === 'unknown'
            ? 'unknown'
            : 'closed';
    return {
      door_name: d.door_name || d.name || doorName,
      current_mode: { value: Number(modeVal) },
      mode_string: modeString,
      door_time: d.door_time?.unix_millis
        ?? (d.door_time?.sec ? d.door_time.sec * 1000 : undefined)
        ?? d.timestamp
        ?? Date.now(),
    };
  }

  public async requestDoor(doorName: string, isOpen: boolean) {
    const res = await this.http.post(`/doors/${encodeURIComponent(doorName)}/command`, {
      door_name: doorName,
      isOpen,
    });
    const response = res.data;
    if (response?.success === false) {
      const detail = response.errors?.map((error: any) => error.detail || error.message).join(', ')
        || response.message
        || `Door command rejected for ${doorName}`;
      throw new Error(detail);
    }
    return response?.data ?? response;
  }

  public async getLifts(): Promise<LiftState[]> {
    const res = await this.http.get<any>('/lifts');
    const raw = res.data?.data ?? res.data?.value ?? res.data;
    const list = Array.isArray(raw) ? raw : (raw?.value || []);
    return list.map((lift: any) => this.normalizeLiftState(lift.lift_name || lift.name, lift));
  }

  public async getLiftState(liftName: string): Promise<LiftState> {
    const res = await this.http.get<any>(`/lifts/${liftName}/state`);
    const l = res.data?.data ?? res.data?.value ?? res.data ?? {};
    return this.normalizeLiftState(liftName, l);
  }

  private normalizeLiftState(liftName: string, l: any): LiftState {
    const doorState = l.door_state?.value ?? l.door_state;
    const motionState = l.motion_state?.value ?? l.motion_state;
    const doorStateText = String(doorState ?? '').toLowerCase();
    const motionStateText = String(motionState ?? '').toLowerCase();
    const normalizedDoorState: LiftState['door_state'] = doorStateText === 'open' || doorState === 2
      ? 'open'
      : doorStateText === 'moving' || doorState === 1
        ? 'moving'
        : 'closed';
    const normalizedMotionState: LiftState['motion_state'] = motionStateText === 'up' || motionState === 1
      ? 'up'
      : motionStateText === 'down' || motionState === 2
        ? 'down'
        : motionStateText === 'unknown'
          ? 'unknown'
          : 'stopped';
    return {
      lift_name: l.lift_name || l.name || liftName,
      current_floor: l.current_floor || l.current_level || 'L1',
      destination_floor: l.destination_floor || l.destination_level || l.current_floor || 'L1',
      door_state: normalizedDoorState,
      motion_state: normalizedMotionState,
      available_floors: l.available_floors || l.levels || ['L1'],
      current_mode: l.current_mode?.value ?? 0,
    };
  }

  public async requestLift(
    liftName: string,
    destination: string,
    requestType = 0,
    doorMode = 0,
  ) {
    const res = await this.http.post(`/lifts/${liftName}/request`, {
      destination,
      request_type: requestType,
      door_mode: doorMode,
      additional_session_ids: [],
    });
    return res.data;
  }

  public async getDispensers(): Promise<WorkcellItem[]> {
    try {
      const res = await this.http.get<any>('/dispensers');
      const list = Array.isArray(res.data) ? res.data : (res.data?.value || []);
      return list.map((item: any) => ({
        guid: item.guid,
        category: 'dispenser',
        state: 'idle',
        location_level: 'L1',
        x: 0,
        y: 0,
      }));
    } catch {
      return [];
    }
  }

  public async getIngestors(): Promise<WorkcellItem[]> {
    try {
      const res = await this.http.get<any>('/ingestors');
      const list = Array.isArray(res.data) ? res.data : (res.data?.value || []);
      return list.map((item: any) => ({
        guid: item.guid,
        category: 'ingestor',
        state: 'idle',
        location_level: 'L1',
        x: 0,
        y: 0,
      }));
    } catch {
      return [];
    }
  }

  public isConnected() {
    return this.connected;
  }

  public async listNavGraphs(): Promise<NavGraphFile[]> {
    const res = await this.http.get<any>('/nav-graphs');
    return res.data?.data ?? [];
  }

  public async getNavGraph(name: string): Promise<NavGraphDetail> {
    const res = await this.http.get<any>(`/nav-graphs/${encodeURIComponent(name)}`);
    return res.data?.data;
  }

  public async listFleetConfigs(): Promise<FleetConfigRecord[]> {
    const res = await this.http.get<any>('/fleet-configs', { params: { page_index: 1, page_size: 100 } });
    return res.data?.data ?? [];
  }

  public async createFleetConfig(name: string, body: FleetConfigBody): Promise<FleetConfigRecord> {
    const res = await this.http.post<any>('/fleet-configs', { name, ...body });
    return res.data?.data;
  }

  public async updateFleetConfig(name: string, body: FleetConfigBody): Promise<FleetConfigRecord> {
    const res = await this.http.put<any>(`/fleet-configs/${encodeURIComponent(name)}`, body);
    return res.data?.data;
  }

  public async deleteFleetConfig(name: string): Promise<void> {
    await this.http.delete(`/fleet-configs/${encodeURIComponent(name)}`);
  }

  public async listRobots(): Promise<RobotRecord[]> {
    const res = await this.http.get<any>('/robots', { params: { page_index: 1, page_size: 100 } });
    return res.data?.data ?? [];
  }

  public async createRobot(fleetName: string, name: string, body: RobotBody): Promise<RobotRecord> {
    const res = await this.http.post<any>('/robots', { fleet_name: fleetName, name, ...body });
    return res.data?.data;
  }

  public async updateRobot(fleetName: string, name: string, body: RobotBody): Promise<RobotRecord> {
    const res = await this.http.put<any>(
      `/robots/${encodeURIComponent(fleetName)}/${encodeURIComponent(name)}`,
      body,
    );
    return res.data?.data;
  }

  public async testRobot(robotApi: Record<string, unknown>): Promise<{ reachable: boolean; detail: string }> {
    const res = await this.http.post<any>('/robots/test', { robot_api: robotApi });
    return res.data?.data;
  }

  public async deleteRobot(fleetName: string, name: string): Promise<void> {
    await this.http.delete(`/robots/${encodeURIComponent(fleetName)}/${encodeURIComponent(name)}`);
  }
}

export const rmfClient = new RmfClient();
