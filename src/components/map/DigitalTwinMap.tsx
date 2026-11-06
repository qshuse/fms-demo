import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Layers, Box, Plus, Send, X, Route, RefreshCw } from 'lucide-react';
import { useFms } from '../../context/FmsContext';
import { MapControls } from './MapControls';
import { RobotDetailDrawer } from './RobotDetailDrawer';
import { ThreeDigitalTwin3D } from './ThreeDigitalTwin3D';
import { MapLayerConfig } from '../../types/fms';
import { RobotState } from '../../types/rmf';
import { computeMapCoordinateSystem } from '../traffic-editor/trafficCoordinates';
import { getDarkFloorplan } from './floorplanTheme';

export const DigitalTwinMap: React.FC = () => {
  const {
    buildingMap,
    refreshBuildingMap,
    fleets,
    doorStates,
    liftStates,
    selectedFloor,
    setSelectedFloor,
    selectedRobot,
    setSelectedRobot,
    toggleDoor,
    callLift,
    dispatchNewTask,
    setActiveTab,
  } = useFms();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync state for GET /building-map
  const [isRefreshingMap, setIsRefreshingMap] = useState<boolean>(false);

  // Auto fetch latest building map on mount from Open-RMF Backend (GET /building-map)
  useEffect(() => {
    let isCancelled = false;
    const fetchLatestMap = async () => {
      try {
        setIsRefreshingMap(true);
        await refreshBuildingMap();
      } catch (err) {
        console.warn('Auto refresh building map on mount error:', err);
      } finally {
        if (!isCancelled) {
          setIsRefreshingMap(false);
        }
      }
    };
    fetchLatestMap();
    return () => {
      isCancelled = true;
    };
  }, [refreshBuildingMap]);

  // 2D Blueprint vs 3D Three.js Digital Twin (Default to 2D Map)
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [showQuickTask, setShowQuickTask] = useState(false);
  const [quickDestination, setQuickDestination] = useState('');
  const [quickTarget, setQuickTarget] = useState('');
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickMessage, setQuickMessage] = useState<string | null>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1.0);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 40, y: 30 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [followingRobotName, setFollowingRobotName] = useState<string | null>(null);

  // Layers toggle
  const [layers, setLayers] = useState<MapLayerConfig>({
    showWalls: true,
    showLanes: true,
    showWaypoints: true,
    showRobots: true,
    showTrajectories: true,
    showDoors: true,
    showLifts: true,
    showLabels: true,
    showGrid: true,
    darkFloorplan: true,
  });

  const toggleLayer = (layer: keyof MapLayerConfig) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  const currentLevel =
    buildingMap.levels.find((lvl) => lvl.name === selectedFloor) || buildingMap.levels[0];

  const allRobotsOnFloor = fleets
    .flatMap((f) => f.robots)
    .filter((r) => r.location.level_name === selectedFloor);

  const waypointNames = useMemo(() => {
    const names = buildingMap.levels.flatMap((level) =>
      level.nav_graphs.flatMap((graph) => [
        ...graph.vertices.map((vertex) => vertex.name).filter((name): name is string => Boolean(name)),
        ...(graph.waypoint_names || []),
      ]),
    );
    return Array.from(new Set(names));
  }, [buildingMap]);

  const openQuickTask = () => {
    setQuickDestination((current) => current || waypointNames[0] || '');
    if (selectedRobot) {
      const fleet = fleets.find((item) => item.robots.some((robot) => robot.name === selectedRobot.name));
      setQuickTarget(fleet ? `${fleet.name}::${selectedRobot.name}` : '');
    }
    setQuickMessage(null);
    setShowQuickTask(true);
  };

  const submitQuickTask = async () => {
    if (!quickDestination || quickSubmitting) return;
    const [targetFleet, targetRobot] = quickTarget ? quickTarget.split('::') : [];
    setQuickSubmitting(true);
    setQuickMessage(null);
    try {
      await dispatchNewTask({
        category: 'move',
        targetFleet: targetFleet || undefined,
        targetRobot: targetRobot || undefined,
        priority: 0,
        patrolWaypoints: [],
        rounds: 1,
        pickupPlace: '',
        dropoffPlace: '',
        cleanZone: '',
        destinationWaypoint: quickDestination,
      });
      setQuickMessage(`Task dispatched to ${quickDestination}`);
      window.setTimeout(() => setShowQuickTask(false), 900);
    } catch (error: any) {
      setQuickMessage(error?.message || 'Unable to dispatch task');
    } finally {
      setQuickSubmitting(false);
    }
  };

  // Floorplan image overlay
  const [floorplanImg, setFloorplanImg] = useState<HTMLImageElement | null>(null);

  // Unified Coordinate System anchored to reference floorplan image
  const coordSys = useMemo(
    () => computeMapCoordinateSystem(buildingMap, currentLevel, floorplanImg),
    [buildingMap, currentLevel, floorplanImg],
  );

  const isMetric = coordSys.hasImage || !coordSys.isPixelMode;
  const toCanvasPos = coordSys.toCanvasPos;

  // Auto load floorplan schematic texture
  useEffect(() => {
    let isCancelled = false;

    const loadImg = async () => {
      let src: string | null | undefined = currentLevel?.images?.[0]?.data;
      if (!src && (currentLevel?.images?.[0] as any)?.url) {
        const u = (currentLevel?.images?.[0] as any).url;
        const fullUrl = u.startsWith('http') ? u : `https://rmf-api.qshudev.cloud${u}`;
        try {
          const res = await fetch(fullUrl);
          const blob = await res.blob();
          src = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch {
          src = fullUrl;
        }
      }

      const imgName = (currentLevel?.images?.[0]?.name || '').toLowerCase();
      const bName = (buildingMap.name || '').toLowerCase();
      const isOfficeBuilding = bName.includes('office') || imgName.includes('office') || bName === 'building';

      // If backend map is office, but data had a stale mismatched warehouse DataURL, prioritize the real office image
      if (isOfficeBuilding && src?.startsWith('data:') && currentLevel?.nav_graphs?.some((g) => g.vertices.some((v) => v.name === 'presupplies'))) {
        src = '/maps/office.png';
      }

      if (!src) {
        const isAirport = bName.includes('airport') || imgName.includes('airport');
        const isHotel = bName.includes('hotel') || imgName.includes('hotel');
        src = isAirport
          ? '/maps/airport_terminal.png'
          : isHotel
            ? `/maps/hotel_${selectedFloor || 'L1'}.png`
            : isOfficeBuilding
              ? '/maps/office.png'
              : null;
      }

      if (!src || isCancelled) {
        if (!isCancelled) setFloorplanImg(null);
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (!isCancelled) setFloorplanImg(img);
      };
      img.onerror = () => {
        if (!isCancelled) setFloorplanImg(null);
      };
      img.src = src;
    };

    loadImg();
    return () => {
      isCancelled = true;
    };
  }, [currentLevel, buildingMap.name, selectedFloor]);

  // Auto-fit view to center on floorplan and waypoints
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 900;
    const h = canvas.clientHeight || 650;
    const totalW = coordSys.canvasWidth;
    const totalH = coordSys.canvasHeight;
    const fitZoom = Math.min(1.5, Math.max(0.18, Math.min((w - 40) / totalW, (h - 40) / totalH)));
    setZoom(fitZoom);
    setOffset({
      x: (w - totalW * fitZoom) / 2,
      y: (h - totalH * fitZoom) / 2,
    });
  }, [selectedFloor, coordSys.canvasWidth, coordSys.canvasHeight, floorplanImg]);

  // Auto follow robot if enabled
  useEffect(() => {
    if (!followingRobotName) return;
    const targetRobot = allRobotsOnFloor.find((r) => r.name === followingRobotName);
    if (!targetRobot || !canvasRef.current) return;

    const width = canvasRef.current.clientWidth;
    const height = canvasRef.current.clientHeight;
    const pos = toCanvasPos(targetRobot.location.x, targetRobot.location.y);

    setOffset({
      x: width / 2 - pos.x * zoom,
      y: height / 2 - pos.y * zoom,
    });
  }, [followingRobotName, allRobotsOnFloor, zoom, toCanvasPos]);

  // Main rendering loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#07090E';
    ctx.fillRect(0, 0, width, height);

    // Grid rendering
    if (layers.showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 40 * zoom;
      const startX = offset.x % gridSize;
      const startY = offset.y % gridSize;

      for (let x = startX; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = startY; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Apply transform
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    if (currentLevel) {
      const isCustomFloorplan = Boolean(
        currentLevel.images?.[0]?.name &&
          !currentLevel.images[0].name.toLowerCase().includes('office') &&
          !currentLevel.images[0].name.toLowerCase().includes('hotel') &&
          !currentLevel.images[0].name.toLowerCase().includes('airport')
      );

      // 0. Draw Floorplan Blueprint Image (Underlay)
      if (floorplanImg) {
        const originPos = toCanvasPos(0, 0);
        ctx.save();
        ctx.globalAlpha = 0.9;
        const planImage = layers.darkFloorplan ? getDarkFloorplan(floorplanImg) : floorplanImg;
        ctx.drawImage(planImage, originPos.x, originPos.y, floorplanImg.naturalWidth, floorplanImg.naturalHeight);
        ctx.restore();
      }

      // 1. Draw Lanes (Nav Graph) with fleet color coding
      const graphColors = [
        'rgba(0, 240, 255, 0.35)', // tinyRobot: Cyan
        'rgba(16, 185, 129, 0.45)', // cleanerBotA: Emerald
        'rgba(245, 158, 11, 0.45)', // deliveryRobot: Amber
        'rgba(168, 85, 247, 0.45)', // cleanerBotE: Purple
      ];

      if (layers.showLanes && currentLevel.nav_graphs) {
        currentLevel.nav_graphs.forEach((graph, gIdx) => {
          const laneColor = graphColors[gIdx % graphColors.length];
          graph.lanes.forEach((lane) => {
            const rawV1 = graph.vertices[lane.entry];
            const rawV2 = graph.vertices[lane.exit];
            if (!rawV1 || !rawV2) return;

            // Filter out residual mock office lanes when using a custom floorplan
            if (isCustomFloorplan) {
              const isV1Office = ['presupplies', 'patrol_d1', 'patrol_d2', 'patrol_a1', 'patrol_a2', 'patrol_b', 'patrol_c', 'tinyrobot1_charger', 'tinyrobot2_charger', 'pantry', 'supplies', 'lounge', 'coe', 'hardware_2'].includes((rawV1.name || '').toLowerCase());
              const isV2Office = ['presupplies', 'patrol_d1', 'patrol_d2', 'patrol_a1', 'patrol_a2', 'patrol_b', 'patrol_c', 'tinyrobot1_charger', 'tinyrobot2_charger', 'pantry', 'supplies', 'lounge', 'coe', 'hardware_2'].includes((rawV2.name || '').toLowerCase());
              if (isV1Office || isV2Office) return;
            }

            const v1 = toCanvasPos(rawV1.x, rawV1.y);
            const v2 = toCanvasPos(rawV2.x, rawV2.y);

            ctx.strokeStyle = laneColor;
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
            ctx.stroke();
            ctx.setLineDash([]);
          });
        });
      }

      // 2. Draw Trajectories of moving robots
      if (layers.showTrajectories) {
        allRobotsOnFloor.forEach((robot) => {
          if (robot.path && robot.path.length > 0) {
            const startPos = toCanvasPos(robot.location.x, robot.location.y);
            ctx.strokeStyle = '#00F0FF';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = '#00F0FF';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(startPos.x, startPos.y);
            robot.path.forEach((p) => {
              const pt = toCanvasPos(p.x, p.y);
              ctx.lineTo(pt.x, pt.y);
            });
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Target waypoint circle
            const target = toCanvasPos(
              robot.path[robot.path.length - 1].x,
              robot.path[robot.path.length - 1].y,
            );
            ctx.fillStyle = '#00F0FF';
            ctx.beginPath();
            ctx.arc(target.x, target.y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }

      // 3. Draw Walls
      const isResidualOfficeWalls =
        isCustomFloorplan &&
        ((currentLevel.wall_segments?.length === 33) ||
          Boolean(currentLevel.wall_segments?.some((w) => w.x1 > 10 && w.x1 < 25 && w.y1 < 0)));

      if (layers.showWalls && currentLevel.wall_segments && !isResidualOfficeWalls) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        currentLevel.wall_segments.forEach((w) => {
          const p1 = toCanvasPos(w.x1, w.y1);
          const p2 = toCanvasPos(w.x2, w.y2);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        });

        // Inner glowing core
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        currentLevel.wall_segments.forEach((w) => {
          const p1 = toCanvasPos(w.x1, w.y1);
          const p2 = toCanvasPos(w.x2, w.y2);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        });
      }

      // 4. Draw Waypoints / Vertices
      if (layers.showWaypoints && currentLevel.nav_graphs) {
        currentLevel.nav_graphs.forEach((graph) => {
          graph.vertices.forEach((v) => {
            // Filter out residual mock office waypoints when using a custom floorplan
            if (
              isCustomFloorplan &&
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
            ) {
              return;
            }

            const p = toCanvasPos(v.x, v.y);
            ctx.beginPath();
            if (v.is_charger) {
              ctx.fillStyle = '#F59E0B';
              ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
              ctx.fill();
            } else if (v.is_parking_spot) {
              ctx.fillStyle = '#10B981';
              ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
              ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }

            if (layers.showLabels && v.name) {
              ctx.font = '10px "JetBrains Mono"';
              ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
              ctx.fillText(v.name, p.x + 8, p.y + 3);
            }
          });
        });
      }

      // 5. Draw Doors
      if (layers.showDoors && currentLevel.doors) {
        currentLevel.doors.forEach((door) => {
          const p = toCanvasPos(door.x || 0, door.y || 0);
          const state = doorStates[door.name];
          const isOpen = state?.mode_string === 'open';

          ctx.fillStyle = isOpen ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
          ctx.strokeStyle = isOpen ? '#10B981' : '#EF4444';
          ctx.lineWidth = 2;

          ctx.beginPath();
          ctx.roundRect(p.x - 14, p.y - 14, 28, 28, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isOpen ? '#10B981' : '#EF4444';
          ctx.font = '9px "Inter"';
          ctx.textAlign = 'center';
          ctx.fillText(isOpen ? 'OPEN' : 'DOOR', p.x, p.y + 3);

          if (layers.showLabels) {
            ctx.font = '9px "JetBrains Mono"';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.fillText(door.name, p.x, p.y + 22);
          }
          ctx.textAlign = 'left';
        });
      }

      // 6. Draw Lifts
      if (layers.showLifts && buildingMap.lifts) {
        buildingMap.lifts.forEach((lift) => {
          const rx = lift.ref_x !== undefined ? lift.ref_x : 480;
          const ry = lift.ref_y !== undefined ? lift.ref_y : 280;
          const p = toCanvasPos(rx, ry);
          const state = liftStates[lift.name];
          const liftW = isMetric ? (lift.width || 2.7) * 20 : 40;
          const liftH = isMetric ? (lift.depth || 2.7) * 20 : 40;

          ctx.fillStyle = 'rgba(139, 92, 246, 0.25)';
          ctx.strokeStyle = '#8B5CF6';
          ctx.lineWidth = 2;

          ctx.beginPath();
          ctx.roundRect(p.x - liftW / 2, p.y - liftH / 2, liftW, liftH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#C084FC';
          ctx.font = 'bold 10px "Inter"';
          ctx.textAlign = 'center';
          ctx.fillText(`LIFT: ${state?.current_floor || selectedFloor}`, p.x, p.y + 4);

          if (layers.showLabels) {
            ctx.font = '9px "JetBrains Mono"';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.fillText(lift.name, p.x, p.y + liftH / 2 + 12);
          }
          ctx.textAlign = 'left';
        });
      }

      // 7. Draw Robots
      if (layers.showRobots) {
        allRobotsOnFloor.forEach((robot) => {
          const p = toCanvasPos(robot.location.x, robot.location.y);
          const yaw = isMetric ? -robot.location.yaw : robot.location.yaw;
          const isSelected = selectedRobot?.name === robot.name;

          ctx.save();
          ctx.translate(p.x, p.y);

          // Radar pulse ring for moving robots
          if (robot.mode === 'moving') {
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Robot main body circle
          ctx.fillStyle = isSelected
            ? '#00F0FF'
            : robot.mode === 'emergency'
              ? '#EF4444'
              : robot.mode === 'charging'
                ? '#F59E0B'
                : '#0284C7';
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = isSelected ? 16 : 8;

          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          // Inner metallic core
          ctx.fillStyle = '#07090E';
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.fill();

          // Orientation Heading Arrow
          ctx.rotate(yaw);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(13, 0);
          ctx.lineTo(10, -3);
          ctx.moveTo(13, 0);
          ctx.lineTo(10, 3);
          ctx.stroke();

          ctx.restore();

          // Robot Name & Battery overhead tag
          if (layers.showLabels) {
            ctx.font = 'bold 10px "Inter"';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(robot.name, p.x, p.y - 16);

            // Battery bar
            const batWidth = 24;
            const batHeight = 3;
            const batX = p.x - batWidth / 2;
            const batY = p.y - 13;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(batX, batY, batWidth, batHeight);

            ctx.fillStyle =
              robot.battery < 0.2 ? '#EF4444' : robot.battery < 0.5 ? '#F59E0B' : '#10B981';
            ctx.fillRect(batX, batY, batWidth * robot.battery, batHeight);

            ctx.textAlign = 'left';
          }
        });
      }
    }

    ctx.restore();
  }, [
    zoom,
    offset,
    layers,
    currentLevel,
    allRobotsOnFloor,
    doorStates,
    liftStates,
    selectedRobot,
    toCanvasPos,
    isMetric,
  ]);

  // Request Animation Frame loop
  useEffect(() => {
    let animationId: number;
    const loop = () => {
      render();
      animationId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animationId);
  }, [render]);

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const nextZoom = Math.min(Math.max(0.3, zoom * zoomFactor), 4.0);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setOffset({
      x: mouseX - (mouseX - offset.x) * (nextZoom / zoom),
      y: mouseY - (mouseY - offset.y) * (nextZoom / zoom),
    });
    setZoom(nextZoom);
    setFollowingRobotName(null);
  };

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    setFollowingRobotName(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Click on interactive entities (robots, doors, lifts)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left - offset.x) / zoom;
    const clickY = (e.clientY - rect.top - offset.y) / zoom;

    // Check click on robot
    for (const robot of allRobotsOnFloor) {
      const p = toCanvasPos(robot.location.x, robot.location.y);
      const dist = Math.hypot(p.x - clickX, p.y - clickY);
      if (dist <= 18) {
        setSelectedRobot(robot);
        return;
      }
    }

    // Check click on door
    if (currentLevel?.doors) {
      for (const door of currentLevel.doors) {
        const p = toCanvasPos(door.x || 0, door.y || 0);
        if (Math.hypot(p.x - clickX, p.y - clickY) <= 16) {
          toggleDoor(door.name);
          return;
        }
      }
    }

    // Check click on lift
    if (buildingMap.lifts) {
      for (const lift of buildingMap.lifts) {
        const rx = lift.ref_x !== undefined ? lift.ref_x : 480;
        const ry = lift.ref_y !== undefined ? lift.ref_y : 280;
        const p = toCanvasPos(rx, ry);
        if (Math.hypot(p.x - clickX, p.y - clickY) <= 30) {
          const availFloors = lift.levels && lift.levels.length > 0 ? lift.levels : ['L1', 'L2', 'L3'];
          const currIdx = availFloors.indexOf(selectedFloor);
          const targetFloor = availFloors[(currIdx + 1) % availFloors.length];
          callLift(lift.name, targetFloor);
          return;
        }
      }
    }

    setSelectedRobot(null);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#07090E',
      }}
    >
      {/* 2D Plan / 3D Three.js Digital Twin Mode Switcher */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '72px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(10, 14, 22, 0.9)',
          backdropFilter: 'blur(12px)',
          padding: '4px',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)',
          zIndex: 20,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        }}
      >
        <button
          onClick={() => setViewMode('2d')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '7px',
            fontSize: '12px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            background: viewMode === '2d' ? 'var(--accent-cyan)' : 'transparent',
            color: viewMode === '2d' ? '#07090E' : 'var(--text-secondary)',
            transition: 'all 0.2s ease',
          }}
          title="Switch to 2D Blueprint Map"
        >
          <Layers size={14} />
          <span>2D Map</span>
        </button>
        <button
          onClick={() => setViewMode('3d')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '7px',
            fontSize: '12px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            background: viewMode === '3d' ? 'var(--accent-cyan)' : 'transparent',
            color: viewMode === '3d' ? '#07090E' : 'var(--text-secondary)',
            transition: 'all 0.2s ease',
          }}
          title="Switch to 3D Three.js Digital Twin"
        >
          <Box size={14} />
          <span>3D Digital Twin</span>
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', margin: '0 2px' }} />
        <button
          onClick={async () => {
            if (isRefreshingMap) return;
            setIsRefreshingMap(true);
            try {
              localStorage.removeItem('vntt_fms_custom_building_map');
              await refreshBuildingMap();
            } catch (err) {
              console.error('Failed to sync building map from server:', err);
            } finally {
              setIsRefreshingMap(false);
            }
          }}
          disabled={isRefreshingMap}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '7px',
            fontSize: '12px',
            fontWeight: 600,
            border: '1px solid var(--border-subtle)',
            cursor: isRefreshingMap ? 'wait' : 'pointer',
            background: isRefreshingMap ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
            color: isRefreshingMap ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            transition: 'all 0.2s ease',
          }}
          title="Đồng bộ bản đồ mới nhất từ Open-RMF Backend (GET /building-map)"
        >
          <RefreshCw size={14} className={isRefreshingMap ? 'spin' : ''} />
          <span>{isRefreshingMap ? 'Syncing...' : 'Sync Map'}</span>
        </button>
        <button
          onClick={() => setActiveTab('traffic-editor')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '7px',
            fontSize: '12px',
            fontWeight: 600,
            border: '1px solid rgba(0, 240, 255, 0.3)',
            cursor: 'pointer',
            background: 'rgba(0, 240, 255, 0.08)',
            color: 'var(--accent-cyan)',
            transition: 'all 0.2s ease',
          }}
          title="Open RMF Traffic Graph Editor (Waypoints & Lanes)"
        >
          <Route size={14} />
          <span>Edit Traffic</span>
        </button>
      </div>

      {/* Quick task launcher available directly from the map */}
      <div
        style={{
          position: 'absolute',
          left: '16px',
          bottom: '16px',
          zIndex: 30,
        }}
      >
        {!showQuickTask ? (
          <button
            type="button"
            onClick={openQuickTask}
            className="btn btn-primary"
            style={{ boxShadow: '0 8px 28px rgba(0, 240, 255, 0.25)' }}
          >
            <Plus size={16} />
            <span>Create Task</span>
          </button>
        ) : (
          <div
            className="glass-panel"
            style={{
              width: '320px',
              padding: '14px',
              background: 'rgba(10, 14, 22, 0.96)',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: '13px' }}>Quick Dispatch</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}>
                  Send a robot to a waypoint
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickTask(false)}
                className="btn btn-secondary"
                style={{ padding: '6px' }}
                aria-label="Close quick dispatch"
              >
                <X size={14} />
              </button>
            </div>

            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '10px', marginBottom: '5px' }}>
              Destination
            </label>
            <select
              value={quickDestination}
              onChange={(event) => setQuickDestination(event.target.value)}
              style={{
                width: '100%',
                padding: '9px 10px',
                marginBottom: '10px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '7px',
                color: '#fff',
              }}
            >
              {waypointNames.map((waypoint) => <option key={waypoint} value={waypoint}>{waypoint}</option>)}
            </select>

            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '10px', marginBottom: '5px' }}>
              Robot assignment
            </label>
            <select
              value={quickTarget}
              onChange={(event) => setQuickTarget(event.target.value)}
              style={{
                width: '100%',
                padding: '9px 10px',
                marginBottom: '12px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '7px',
                color: '#fff',
              }}
            >
              <option value="">Automatic assignment</option>
              {fleets.flatMap((fleet) => fleet.robots.map((robot) => (
                <option key={`${fleet.name}::${robot.name}`} value={`${fleet.name}::${robot.name}`}>
                  {robot.name} · {fleet.name}
                </option>
              )))}
            </select>

            {quickMessage && (
              <div style={{ color: quickMessage.startsWith('Task dispatched') ? '#10B981' : '#EF4444', fontSize: '11px', marginBottom: '10px' }}>
                {quickMessage}
              </div>
            )}

            <button
              type="button"
              onClick={submitQuickTask}
              disabled={!quickDestination || quickSubmitting}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', opacity: !quickDestination || quickSubmitting ? 0.55 : 1 }}
            >
              <Send size={14} />
              <span>{quickSubmitting ? 'Dispatching...' : 'Dispatch Task'}</span>
            </button>
          </div>
        )}
      </div>

      {viewMode === '2d' ? (
        <>
          <canvas
            ref={canvasRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleCanvasClick}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              cursor: isDragging ? 'grabbing' : 'crosshair',
            }}
          />

          <MapControls
            zoom={zoom}
            onZoomIn={() => setZoom((z) => Math.min(4.0, z * 1.2))}
            onZoomOut={() => setZoom((z) => Math.max(0.3, z * 0.8))}
            onResetView={() => {
              setZoom(1.0);
              setOffset({ x: 40, y: 30 });
              setFollowingRobotName(null);
            }}
            layers={layers}
            onToggleLayer={toggleLayer}
            floors={buildingMap.levels.map((l) => l.name)}
            activeFloor={selectedFloor}
            onSelectFloor={(fl) => {
              setSelectedFloor(fl);
              setFollowingRobotName(null);
            }}
            followingRobot={followingRobotName}
            onCancelFollow={() => setFollowingRobotName(null)}
          />
        </>
      ) : (
        <ThreeDigitalTwin3D onSelectRobot={setSelectedRobot} />
      )}

      {/* Selected Robot Drawer (works in both 2D and 3D) */}
      {selectedRobot && (
        <RobotDetailDrawer
          robot={selectedRobot}
          onClose={() => setSelectedRobot(null)}
          onFollowRobot={(name) => setFollowingRobotName(name)}
          isFollowing={followingRobotName === selectedRobot.name}
        />
      )}
    </div>
  );
};
