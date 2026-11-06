// RMF System Types & API Data Models

export type RobotModeType = 
  | 'idle'
  | 'charging'
  | 'moving'
  | 'paused'
  | 'waiting'
  | 'emergency'
  | 'going_home'
  | 'error'
  | 'docked';

export interface RobotLocation {
  x: number;
  y: number;
  yaw: number;
  level_name: string;
  speed?: number;
}

export interface WaypointPath {
  x: number;
  y: number;
  yaw?: number;
  level_name: string;
  arrival_time?: number;
}

export interface RobotState {
  name: string;
  model?: string;
  battery: number; // 0.0 - 1.0 (or percentage)
  location: RobotLocation;
  path: WaypointPath[];
  mode: RobotModeType;
  task_id: string | null;
  commissioned: boolean;
  seq?: number;
  last_heartbeat?: number;
  mutex_groups?: string[];
  issues?: string[];
}

export interface FleetState {
  name: string;
  robots: RobotState[];
}

export type TaskStatus = 
  | 'queued' 
  | 'underway' 
  | 'completed' 
  | 'failed' 
  | 'canceled'
  | 'pending';

export type TaskCategory = 
  | 'patrol' 
  | 'delivery' 
  | 'clean' 
  | 'charge' 
  | 'compose' 
  | 'custom'
  | 'move';

export interface TaskPhase {
  id: number;
  category: string;
  detail: string;
  status: 'pending' | 'underway' | 'completed' | 'failed' | 'skipped';
  unix_millis_start_time?: number;
  unix_millis_finish_time?: number;
  estimate_millis?: number;
}

export interface TaskBooking {
  id: string;
  requester?: string;
  unix_millis_request_time?: number;
  labels?: string[];
  priority?: {
    type?: string;
    value?: number;
  };
}

export interface TaskState {
  booking: TaskBooking;
  category: TaskCategory;
  assigned_to?: {
    group?: string; // fleet
    name?: string;  // robot
  };
  status: TaskStatus;
  progress?: number; // 0 - 100
  unix_millis_start_time?: number;
  unix_millis_finish_time?: number;
  estimate_millis?: number;
  phases?: TaskPhase[];
  active_phase_index?: number;
}

export interface TaskLogEntry {
  seq: number;
  timestamp: number;
  tier: 'info' | 'warn' | 'error';
  text: string;
}

export interface MapVertex {
  index: number;
  x: number;
  y: number;
  name?: string;
  params?: Record<string, any>;
  is_parking_spot?: boolean;
  is_charger?: boolean;
  is_holding_point?: boolean;
  yaw?: number;
}

export interface MapLane {
  index: number;
  entry: number; // vertex index
  exit: number;  // vertex index
  two_way: boolean;
  orientation_constraint?: number;
  is_closed?: boolean;
  speed_limit?: number;
  mutex_group?: string;
}

export interface NavGraph {
  name: string;
  vertices: MapVertex[];
  lanes: MapLane[];
  // Some FMS APIs expose only waypoint names, without graph coordinates.
  waypoint_names?: string[];
}

export type DoorMode = 'closed' | 'moving' | 'open' | 'offline' | 'unknown';

export interface Door {
  name: string;
  door_type: number; // 1: single sliding, 2: double sliding, 3: single swing, 4: double swing, 5: single telescoping
  motion_range: number;
  motion_direction: number;
  level_name: string;
  x?: number;
  y?: number;
  yaw?: number;
}

export interface DoorState {
  door_name: string;
  current_mode: {
    value: number; // 0: closed, 1: moving, 2: open, 3: offline, 4: unknown
  };
  mode_string: DoorMode;
  door_time?: number;
}

export interface Lift {
  name: string;
  levels: string[];
  doors: Door[];
  ref_x?: number;
  ref_y?: number;
  ref_yaw?: number;
  width?: number;
  depth?: number;
}

export type LiftDoorState = 'closed' | 'moving' | 'open';
export type LiftMotionState = 'stopped' | 'up' | 'down' | 'unknown';

export interface LiftState {
  lift_name: string;
  current_floor: string;
  destination_floor: string;
  door_state: LiftDoorState;
  motion_state: LiftMotionState;
  available_floors: string[];
  current_mode: number;
  session_id?: string;
}

export interface WorkcellItem {
  guid: string;
  category: 'dispenser' | 'ingestor';
  state: 'idle' | 'busy' | 'offline';
  location_level: string;
  x: number;
  y: number;
  payload_capacity?: number;
  current_payload?: string | null;
}

export interface Level {
  name: string;
  elevation: number;
  nav_graphs: NavGraph[];
  doors: Door[];
  images?: {
    name: string;
    x_offset: number;
    y_offset: number;
    yaw: number;
    scale: number;
    data?: string;
  }[];
  wall_segments?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[];
}

export interface BuildingMap {
  name: string;
  levels: Level[];
  lifts: Lift[];
}

export interface Alert {
  id: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: number;
  acknowledged: boolean;
  entity_type?: 'robot' | 'task' | 'door' | 'lift' | 'system';
  entity_id?: string;
}

export interface MutexGroup {
  name: string;
  locked_by: string | null;
  waiting_queue: string[];
}
