import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FleetState,
  TaskState,
  BuildingMap,
  DoorState,
  LiftState,
  WorkcellItem,
  Alert,
  MutexGroup,
  RobotState,
  NavGraph,
} from '../types/rmf';
import { NavigationTab, FmsSettings, DispatchTaskFormData } from '../types/fms';
import {
  INITIAL_BUILDING_MAP,
  INITIAL_FLEETS,
  INITIAL_TASKS,
  INITIAL_DOOR_STATES,
  INITIAL_LIFT_STATES,
  INITIAL_WORKCELLS,
  INITIAL_ALERTS,
  INITIAL_MUTEX_GROUPS,
} from '../services/mock-data';
import { rmfClient } from '../services/rmf-client';
import { SimulationEngine } from '../services/simulation-engine';

interface FmsContextType {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  selectedRobot: RobotState | null;
  setSelectedRobot: (robot: RobotState | null) => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedFloor: string;
  setSelectedFloor: (floor: string) => void;
  fleets: FleetState[];
  tasks: TaskState[];
  buildingMap: BuildingMap;
  updateNavGraph: (floorName: string, graphIndex: number, newGraph: NavGraph) => void;
  saveBuildingMap: (newMap: BuildingMap) => void;
  resetBuildingMap: () => void;
  uploadAndDeployBuildingMap: (zipBlob: Blob, filename?: string) => Promise<{ uploadRes: any; freshMap: BuildingMap }>;
  refreshBuildingMap: () => Promise<BuildingMap>;
  doorStates: Record<string, DoorState>;
  liftStates: Record<string, LiftState>;
  workcells: WorkcellItem[];
  alerts: Alert[];
  mutexGroups: MutexGroup[];
  settings: FmsSettings;
  updateSettings: (partial: Partial<FmsSettings>) => void;
  isBackendConnected: boolean;
  isEStopActive: boolean;
  triggerEStop: () => void;
  resetEStop: () => void;
  toggleDoor: (doorName: string) => void;
  callLift: (liftName: string, floor: string) => void;
  setRobotCommission: (fleetName: string, robotName: string, commission: boolean) => void;
  dispatchNewTask: (form: DispatchTaskFormData) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  acknowledgeAlert: (alertId: string) => void;
  dismissAlert: (alertId: string) => void;
}

const FmsContext = createContext<FmsContextType | null>(null);

const DEFAULT_SETTINGS: FmsSettings = {
  apiServerUrl:
    import.meta.env.VITE_RMF_API_SERVER_URL || 'https://rmf-api.qshudev.cloud',
  trajectoryServerUrl:
    import.meta.env.VITE_RMF_TRAJECTORY_SERVER_URL || 'wss://rmf-api.qshudev.cloud/trajectory',
  autoConnect: true,
  simulationMode: false,
  soundEnabled: true,
  theme: 'cyber',
  refreshIntervalMs: 2500,
};

/**
 * Sanitizes BuildingMap to prevent mixing old mock/office building walls & waypoints
 * with custom imported floorplans (e.g. warehouse layout).
 */
export function sanitizeBuildingMap(map: BuildingMap): BuildingMap {
  if (!map || !map.levels) return map;

  const sanitizedLevels = map.levels.map((lvl) => {
    // Decide by image name only: rmf-client turns every image into a data URL,
    // so checking for 'data:' would flag the real office map as custom and strip its waypoints.
    const hasCustomImage = Boolean(
      lvl.images?.[0]?.name &&
        !lvl.images[0].name.toLowerCase().includes('office') &&
        !lvl.images[0].name.toLowerCase().includes('hotel') &&
        !lvl.images[0].name.toLowerCase().includes('airport')
    );

    if (hasCustomImage) {
      // 1. Strip residual mock office walls (33 segments or matching office bounding coordinates)
      const hasOldOfficeWalls =
        (lvl.wall_segments && lvl.wall_segments.length > 0) &&
        (lvl.wall_segments.length === 33 ||
          lvl.wall_segments.some((w) => w.x1 > 10 && w.x1 < 25 && w.y1 < 0 && w.y1 > -15));

      // 2. Strip residual mock office waypoints & lanes from nav_graphs
      const sanitizedNavGraphs = (lvl.nav_graphs || []).map((g) => {
        const isOldOfficeGraph = g.vertices.some((v) =>
          [
            'presupplies',
            'patrol_d1',
            'patrol_d2',
            'patrol_a1',
            'patrol_a2',
            'patrol_b',
            'patrol_c',
            'tinyrobot1_charger',
            'tinyrobot2_charger',
            'pantry',
            'supplies',
            'lounge',
            'coe',
            'hardware_2',
          ].includes((v.name || '').toLowerCase())
        );

        if (isOldOfficeGraph) {
          const newIndexOf = new Map<number, number>();
          const cleanVertices = g.vertices
            .filter(
              (v) =>
                ![
                  'presupplies',
                  'patrol_d1',
                  'patrol_d2',
                  'patrol_a1',
                  'patrol_a2',
                  'patrol_b',
                  'patrol_c',
                  'tinyrobot1_charger',
                  'tinyrobot2_charger',
                  'pantry',
                  'supplies',
                  'lounge',
                  'coe',
                  'hardware_2',
                ].includes((v.name || '').toLowerCase())
            )
            .map((v, newIndex) => {
              newIndexOf.set(v.index, newIndex);
              return { ...v, index: newIndex };
            });
          return {
            ...g,
            vertices: cleanVertices,
            lanes: g.lanes
              .filter((l) => newIndexOf.has(l.entry) && newIndexOf.has(l.exit))
              .map((l, laneIndex) => ({
                ...l,
                index: laneIndex,
                entry: newIndexOf.get(l.entry)!,
                exit: newIndexOf.get(l.exit)!,
              })),
          };
        }
        return g;
      });

      return {
        ...lvl,
        wall_segments: hasOldOfficeWalls ? [] : lvl.wall_segments,
        doors: hasOldOfficeWalls ? [] : lvl.doors,
        nav_graphs: sanitizedNavGraphs,
      };
    }
    return lvl;
  });

  return {
    ...map,
    levels: sanitizedLevels,
  };
}

export const FmsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab: NavigationTab = useMemo(() => {
    const raw = location.pathname.replace(/^\//, '').toLowerCase();
    const validTabs: NavigationTab[] = [
      'overview',
      'map',
      'setup',
      'traffic-editor',
      'fleets',
      'tasks',
      'infrastructure',
      'alerts',
      'settings',
    ];
    if (validTabs.includes(raw as NavigationTab)) {
      return raw as NavigationTab;
    }
    return 'overview';
  }, [location.pathname]);

  const setActiveTab = useCallback(
    (tab: NavigationTab) => {
      const target = `/${tab}`;
      if (location.pathname !== target) {
        navigate(target);
      }
    },
    [location.pathname, navigate]
  );
  const [selectedRobot, setSelectedRobot] = useState<RobotState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string>('L1');

  const [fleets, setFleets] = useState<FleetState[]>(INITIAL_FLEETS);
  const [tasks, setTasks] = useState<TaskState[]>(INITIAL_TASKS);
  const [buildingMap, setBuildingMap] = useState<BuildingMap>(() => {
    try {
      const saved = localStorage.getItem('vntt_fms_custom_building_map');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.levels && parsed.levels.length > 0) {
          return sanitizeBuildingMap(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not parse cached building map', e);
    }
    return INITIAL_BUILDING_MAP;
  });
  const [doorStates, setDoorStates] = useState<Record<string, DoorState>>(INITIAL_DOOR_STATES);
  const [liftStates, setLiftStates] = useState<Record<string, LiftState>>(INITIAL_LIFT_STATES);
  const [workcells, setWorkcells] = useState<WorkcellItem[]>(INITIAL_WORKCELLS);
  const [alerts, setAlerts] = useState<Alert[]>(INITIAL_ALERTS);
  const [mutexGroups] = useState<MutexGroup[]>(INITIAL_MUTEX_GROUPS);

  const [settings, setSettings] = useState<FmsSettings>(() => {
    // Override local storage if it was pointing to localhost:8000
    const saved = localStorage.getItem('vntt_fms_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.apiServerUrl?.includes('localhost:8000')) {
        parsed.apiServerUrl = 'https://rmf-api.qshudev.cloud';
        parsed.simulationMode = false;
        localStorage.setItem('vntt_fms_settings', JSON.stringify(parsed));
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
    return DEFAULT_SETTINGS;
  });

  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [isEStopActive, setIsEStopActive] = useState<boolean>(false);

  const simEngineRef = useRef<SimulationEngine | null>(null);

  const updateSettings = (partial: Partial<FmsSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem('vntt_fms_settings', JSON.stringify(next));
      if (partial.apiServerUrl || partial.trajectoryServerUrl) {
        rmfClient.updateUrls(next.apiServerUrl, next.trajectoryServerUrl);
      }
      return next;
    });
  };

  // Simulation engine setup
  useEffect(() => {
    if (settings.simulationMode && !isEStopActive) {
      simEngineRef.current = new SimulationEngine((data) => {
        setFleets(data.fleets);
        setTasks(data.tasks);
        setDoorStates(data.doors);
        setLiftStates(data.lifts);
      });
      simEngineRef.current.start(fleets, tasks, doorStates, liftStates);
    } else {
      simEngineRef.current?.stop();
    }

    return () => {
      simEngineRef.current?.stop();
    };
  }, [settings.simulationMode, isEStopActive]);

  // Real RMF server connection & live sync
  useEffect(() => {
    if (!settings.simulationMode) {
      rmfClient.updateUrls(settings.apiServerUrl, settings.trajectoryServerUrl);
      rmfClient.initSocket((connected) => {
        setIsBackendConnected(connected);
      });

      // Revalidate building map with live backend on startup (stale-while-revalidate)
      const fetchInitialMapOnce = async () => {
        try {
          const freshMap = await rmfClient.getBuildingMap();
          if (freshMap && freshMap.levels && freshMap.levels.length > 0) {
            const clean = sanitizeBuildingMap(freshMap);
            setBuildingMap(clean);
            setSelectedFloor((prev) => {
              const exists = clean.levels.some((l) => l.name === prev);
              return exists ? prev : clean.levels[0].name;
            });
            try {
              localStorage.setItem('vntt_fms_custom_building_map', JSON.stringify(clean));
            } catch (e) {
              console.warn('Failed to cache building map to localStorage', e);
            }
          }
        } catch (e) {
          console.warn('Initial map fetch notice (using cache/default):', e);
        }
      };
      fetchInitialMapOnce();

      const syncLiveBackend = async () => {
        try {
          const [fleetResult, taskResult, doorResult, liftResult, dispenserResult, ingestorResult] =
            await Promise.allSettled([
            rmfClient.getFleets(),
            rmfClient.getTasks(),
            rmfClient.getDoors(),
            rmfClient.getLifts(),
            rmfClient.getDispensers(),
            rmfClient.getIngestors(),
          ]);

          const f = fleetResult.status === 'fulfilled' ? fleetResult.value : null;
          const t = taskResult.status === 'fulfilled' ? taskResult.value : null;
          const doors = doorResult.status === 'fulfilled' ? doorResult.value : null;
          const lifts = liftResult.status === 'fulfilled' ? liftResult.value : null;
          const disp = dispenserResult.status === 'fulfilled' ? dispenserResult.value : null;
          const ing = ingestorResult.status === 'fulfilled' ? ingestorResult.value : null;

          if (f && f.length > 0) {
            setFleets(f);
            setIsBackendConnected(true);
          }
          if (t) setTasks(t);
          if (disp && ing && (disp.length > 0 || ing.length > 0)) {
            setWorkcells([...disp, ...ing]);
          }

          if (doors) {
            const states = await Promise.allSettled(
              doors.map((door) => rmfClient.getDoorState(door.name)),
            );
            const nextDoorStates: Record<string, DoorState> = {};
            states.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                nextDoorStates[doors[index].name] = result.value;
              }
            });
            setDoorStates(nextDoorStates);
          }

          if (lifts) {
            const nextLiftStates: Record<string, LiftState> = {};
            lifts.forEach((lift) => {
              nextLiftStates[lift.lift_name] = lift;
            });
            setLiftStates(nextLiftStates);
          }
        } catch (err) {
          console.warn('Sync live backend warning:', err);
        }
      };

      syncLiveBackend();
      const interval = setInterval(syncLiveBackend, 3000);

      return () => {
        clearInterval(interval);
        rmfClient.disconnectSocket();
      };
    } else {
      setIsBackendConnected(false);
    }
  }, [settings.simulationMode, settings.apiServerUrl]);

  // Emergency Stop handlers
  const triggerEStop = () => {
    setIsEStopActive(true);
    setFleets((prev) =>
      prev.map((f) => ({
        ...f,
        robots: f.robots.map((r) => ({
          ...r,
          mode: 'emergency',
          issues: [...(r.issues || []), 'MASTER E-STOP ENGAGED'],
        })),
      })),
    );
    setAlerts((prev) => [
      {
        id: `estop_${Date.now()}`,
        title: 'MASTER E-STOP ACTIVATED',
        message: 'All robotic operations halted immediately across all facilities.',
        severity: 'critical',
        timestamp: Date.now(),
        acknowledged: false,
        entity_type: 'system',
      },
      ...prev,
    ]);
  };

  const resetEStop = () => {
    setIsEStopActive(false);
    setFleets((prev) =>
      prev.map((f) => ({
        ...f,
        robots: f.robots.map((r) => ({
          ...r,
          mode: r.task_id ? 'moving' : 'idle',
          issues: (r.issues || []).filter((i) => i !== 'MASTER E-STOP ENGAGED'),
        })),
      })),
    );
  };

  // Door manual override
  const toggleDoor = async (doorName: string) => {
    const current = doorStates[doorName];
    const isCurrentlyOpen = current?.mode_string === 'open';
    const nextModeString = isCurrentlyOpen ? 'closed' : 'open';
    const nextModeValue = isCurrentlyOpen ? 0 : 2;

    setDoorStates((prev) => ({
      ...prev,
      [doorName]: {
        door_name: doorName,
        current_mode: { value: nextModeValue },
        mode_string: nextModeString,
        door_time: Date.now(),
      },
    }));

    // REST door commands do not depend on the Socket.IO connection state.
    if (!settings.simulationMode) {
      try {
        await rmfClient.requestDoor(doorName, !isCurrentlyOpen);
      } catch (e) {
        console.error('Failed to request door to server', e);
        setDoorStates((prev) => ({
          ...prev,
          [doorName]: current || {
            door_name: doorName,
            current_mode: { value: isCurrentlyOpen ? 2 : 0 },
            mode_string: isCurrentlyOpen ? 'open' : 'closed',
            door_time: Date.now(),
          },
        }));
      }
    }
  };

  // Lift manual call
  const callLift = async (liftName: string, targetFloor: string) => {
    setLiftStates((prev) => ({
      ...prev,
      [liftName]: {
        ...prev[liftName],
        destination_floor: targetFloor,
        motion_state: 'up',
      },
    }));

    setTimeout(() => {
      setLiftStates((prev) => ({
        ...prev,
        [liftName]: {
          ...prev[liftName],
          current_floor: targetFloor,
          motion_state: 'stopped',
          door_state: 'open',
        },
      }));
    }, 2000);

    if (!settings.simulationMode && isBackendConnected) {
      try {
        await rmfClient.requestLift(liftName, targetFloor);
      } catch (e) {
        console.error('Failed to request lift to server', e);
      }
    }
  };

  // Commission / Decommission robot
  const setRobotCommission = async (
    fleetName: string,
    robotName: string,
    commission: boolean,
  ) => {
    setFleets((prev) =>
      prev.map((f) => {
        if (f.name !== fleetName) return f;
        return {
          ...f,
          robots: f.robots.map((r) => {
            if (r.name !== robotName) return r;
            return {
              ...r,
              commissioned: commission,
              mode: commission ? 'idle' : 'paused',
            };
          }),
        };
      }),
    );

    if (!settings.simulationMode && isBackendConnected && !commission) {
      try {
        await rmfClient.decommissionRobot(fleetName, robotName, true, false);
      } catch (e) {
        console.error('Failed to decommission robot on server', e);
      }
    }
  };

  // Dispatch new task
  const dispatchNewTask = async (form: DispatchTaskFormData) => {
    // 1. Format payload according to Open-RMF specifications
    let rmfCategory = form.category;
    let description: any = {};

    if (form.category === 'patrol') {
      rmfCategory = 'patrol';
      description = {
        places: form.patrolWaypoints.filter(Boolean),
        rounds: Number(form.rounds) || 1,
      };
    } else if (form.category === 'delivery') {
      rmfCategory = 'delivery';
      description = {
        pickup: {
          place: form.pickupPlace,
          handler: form.pickupDispenser || 'coke_dispenser',
          payload: [
            {
              sku: form.sku || form.cartId || 'coke',
              quantity: Number(form.quantity) || 1,
            },
          ],
        },
        dropoff: {
          place: form.dropoffPlace,
          handler: form.dropoffIngestor || 'coke_ingestor',
          payload: [
            {
              sku: form.sku || form.cartId || 'coke',
              quantity: Number(form.quantity) || 1,
            },
          ],
        },
      };
    } else if (form.category === 'clean') {
      rmfCategory = 'clean';
      description = {
        zone: form.cleanZone || 'clean_zone',
      };
    } else if (form.category === 'move') {
      rmfCategory = 'patrol';
      description = {
        places: [form.destinationWaypoint],
        rounds: 1,
      };
    }

    if (!settings.simulationMode && isBackendConnected) {
      try {
        let resp: any;
        if (form.targetRobot && form.targetFleet) {
          resp = await rmfClient.dispatchRobotTask({
            robot: form.targetRobot,
            fleet: form.targetFleet,
            category: rmfCategory,
            description,
            priority: form.priority,
          });
        } else {
          resp = await rmfClient.dispatchTask({
            category: rmfCategory,
            description,
            fleet_name: form.targetFleet || undefined,
            priority: form.priority,
          });
        }

        if (!resp || resp.success === false) {
          const errMsg = resp?.errors?.map((e: any) => e.detail || e.message).join(', ') || 'Task rejected by server';
          throw new Error(errMsg);
        }

        // Fetch fresh task list from backend
        try {
          const freshTasks = await rmfClient.getTasks();
          if (freshTasks && freshTasks.length > 0) {
            setTasks(freshTasks);
          }
        } catch { }

        return resp;
      } catch (e: any) {
        console.error('Failed to dispatch task to server', e);
        throw e;
      }
    }

    // Fallback Simulation Mode:
    const newTaskId = `task_${form.category}_${Math.floor(1000 + Math.random() * 9000)}`;

    const newTask: TaskState = {
      booking: {
        id: newTaskId,
        requester: 'FMS_Operator',
        unix_millis_request_time: Date.now(),
        priority: { type: 'binary', value: form.priority },
        labels: [`category=${form.category}`],
      },
      category: form.category,
      status: 'underway',
      progress: 5,
      unix_millis_start_time: Date.now(),
      estimate_millis: 300000,
      phases: [
        {
          id: 1,
          category: 'init',
          detail: `Initialize ${form.category} task execution`,
          status: 'underway',
          unix_millis_start_time: Date.now(),
        },
        {
          id: 2,
          category: 'execute',
          detail:
            form.category === 'patrol'
              ? `Patrol waypoints: ${form.patrolWaypoints.join(' -> ')} (${form.rounds} rounds)`
              : form.category === 'delivery'
                ? `Delivery from ${form.pickupPlace} to ${form.dropoffPlace}`
                : form.category === 'clean'
                  ? `Clean zone: ${form.cleanZone}`
                  : `Navigate to ${form.destinationWaypoint}`,
          status: 'pending',
        },
      ],
      active_phase_index: 0,
    };

    // Allocate to specified robot or first idle robot
    setFleets((prev) => {
      let allocated = false;
      return prev.map((f) => {
        if (form.targetFleet && f.name !== form.targetFleet) return f;
        return {
          ...f,
          robots: f.robots.map((r) => {
            if (form.targetRobot && r.name !== form.targetRobot) return r;
            if (!allocated && r.commissioned && (r.mode === 'idle' || r.mode === 'waiting')) {
              allocated = true;
              newTask.assigned_to = { group: f.name, name: r.name };
              return {
                ...r,
                mode: 'moving',
                task_id: newTaskId,
                path: [
                  { x: 420, y: 220, level_name: 'L1' },
                  { x: 620, y: 220, level_name: 'L1' },
                  { x: 740, y: 350, level_name: 'L1' },
                ],
              };
            }
            return r;
          }),
        };
      });
    });

    setTasks((prev) => [newTask, ...prev]);
  };

  // Cancel task
  const cancelTask = async (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.booking.id === taskId ? { ...t, status: 'canceled' } : t)),
    );
    // Release robot
    setFleets((prev) =>
      prev.map((f) => ({
        ...f,
        robots: f.robots.map((r) =>
          r.task_id === taskId ? { ...r, task_id: null, mode: 'idle', path: [] } : r,
        ),
      })),
    );

    if (!settings.simulationMode && isBackendConnected) {
      try {
        await rmfClient.cancelTask(taskId);
      } catch (e) {
        console.error('Failed to cancel task on server', e);
      }
    }
  };

  // Alert actions
  const acknowledgeAlert = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
    );
  };

  const dismissAlert = (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  // Map & Traffic Editor actions
  const saveBuildingMap = useCallback((newMap: BuildingMap) => {
    const clean = sanitizeBuildingMap(newMap);
    setBuildingMap(clean);
    try {
      localStorage.setItem('vntt_fms_custom_building_map', JSON.stringify(clean));
    } catch (e) {
      console.warn('Failed to save building map to localStorage', e);
    }
  }, []);

  const updateNavGraph = useCallback((floorName: string, graphIndex: number, newGraph: NavGraph) => {
    setBuildingMap((prev) => {
      const next: BuildingMap = {
        ...prev,
        levels: prev.levels.map((lvl) => {
          if (lvl.name !== floorName) return lvl;
          const graphs = [...(lvl.nav_graphs || [])];
          graphs[graphIndex] = newGraph;
          return { ...lvl, nav_graphs: graphs };
        }),
      };
      try {
        localStorage.setItem('vntt_fms_custom_building_map', JSON.stringify(next));
      } catch (e) {
        console.warn('Failed to save updated nav graph', e);
      }
      return next;
    });
  }, []);

  const resetBuildingMap = useCallback(() => {
    localStorage.removeItem('vntt_fms_custom_building_map');
    setBuildingMap(INITIAL_BUILDING_MAP);
  }, []);

  const refreshBuildingMap = useCallback(async () => {
    const freshMap = await rmfClient.getBuildingMap();
    if (freshMap && freshMap.levels && freshMap.levels.length > 0) {
      const clean = sanitizeBuildingMap(freshMap);
      setBuildingMap(clean);
      setSelectedFloor((prev) => {
        const exists = clean.levels.some((l) => l.name === prev);
        return exists ? prev : clean.levels[0].name;
      });
      try {
        localStorage.setItem('vntt_fms_custom_building_map', JSON.stringify(clean));
      } catch (e) {
        console.warn('Failed to cache building map to localStorage', e);
      }
      return clean;
    }
    return freshMap;
  }, []);

  const uploadAndDeployBuildingMap = useCallback(async (zipBlob: Blob, filename = 'building_map.zip') => {
    const uploadRes = await rmfClient.uploadBuildingMap(zipBlob, filename);
    const freshMap = await rmfClient.getBuildingMap();
    if (freshMap && freshMap.levels && freshMap.levels.length > 0) {
      const clean = sanitizeBuildingMap(freshMap);
      setBuildingMap(clean);
      setSelectedFloor((prev) => {
        const exists = clean.levels.some((l) => l.name === prev);
        return exists ? prev : clean.levels[0].name;
      });
      try {
        localStorage.setItem('vntt_fms_custom_building_map', JSON.stringify(clean));
      } catch (e) {
        console.warn('Failed to cache building map to localStorage', e);
      }
      return { uploadRes, freshMap: clean };
    }
    return { uploadRes, freshMap };
  }, []);

  return (
    <FmsContext.Provider
      value={{
        activeTab,
        setActiveTab,
        selectedRobot,
        setSelectedRobot,
        selectedTaskId,
        setSelectedTaskId,
        selectedFloor,
        setSelectedFloor,
        fleets,
        tasks,
        buildingMap,
        updateNavGraph,
        saveBuildingMap,
        resetBuildingMap,
        uploadAndDeployBuildingMap,
        refreshBuildingMap,
        doorStates,
        liftStates,
        workcells,
        alerts,
        mutexGroups,
        settings,
        updateSettings,
        isBackendConnected,
        isEStopActive,
        triggerEStop,
        resetEStop,
        toggleDoor,
        callLift,
        setRobotCommission,
        dispatchNewTask,
        cancelTask,
        acknowledgeAlert,
        dismissAlert,
      }}
    >
      {children}
    </FmsContext.Provider>
  );
};

export const useFms = () => {
  const context = useContext(FmsContext);
  if (!context) {
    throw new Error('useFms must be used within a FmsProvider');
  }
  return context;
};
