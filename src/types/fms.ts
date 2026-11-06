// FMS App UI & Configuration Types

export type NavigationTab =
  | 'overview'
  | 'map'
  | 'setup'
  | 'traffic-editor'
  | 'fleets'
  | 'tasks'
  | 'infrastructure'
  | 'alerts'
  | 'settings';

export interface FmsSettings {
  apiServerUrl: string;
  trajectoryServerUrl: string;
  autoConnect: boolean;
  simulationMode: boolean;
  soundEnabled: boolean;
  theme: 'dark' | 'midnight' | 'cyber';
  refreshIntervalMs: number;
}

export interface MapLayerConfig {
  showWalls: boolean;
  showLanes: boolean;
  showWaypoints: boolean;
  showRobots: boolean;
  showTrajectories: boolean;
  showDoors: boolean;
  showLifts: boolean;
  showLabels: boolean;
  showGrid: boolean;
  darkFloorplan: boolean;
}

export interface DispatchTaskFormData {
  category: 'patrol' | 'delivery' | 'clean' | 'move';
  targetFleet?: string;
  targetRobot?: string;
  priority: number;
  // Patrol
  patrolWaypoints: string[];
  rounds: number;
  // Delivery
  pickupPlace: string;
  pickupDispenser?: string;
  dropoffPlace: string;
  dropoffIngestor?: string;
  sku?: string;
  quantity?: number;
  cartId?: string;
  // Clean
  cleanZone: string;
  // Move
  destinationWaypoint: string;
}

