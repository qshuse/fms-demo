export interface NavGraphFile {
  name: string;
  size_bytes: number;
  modified_at: string;
}

export interface NavGraphDetail {
  name: string;
  valid: boolean;
  error?: string | null;
  levels: string[];
  waypoints: string[];
  chargers: string[];
  lanes: number;
}

export interface FleetConfigStatus {
  state: string;
  detail: string;
  restarts: number;
}

export interface FleetConfigBody {
  nav_graph: string;
  rmf_fleet: Record<string, unknown>;
  robot_api: {
    type: string;
    maps: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  reference_coordinates: Record<string, { rmf: number[][]; robot: number[][] }>;
}

export interface FleetConfigRecord {
  name: string;
  config: FleetConfigBody;
  status: FleetConfigStatus | null;
  created_at: string;
  updated_at: string;
}

export interface RobotBody {
  charger: string;
  robot_api: Record<string, unknown>;
}

export interface RobotRecord extends RobotBody {
  fleet_name: string;
  name: string;
  created_at: string;
}
