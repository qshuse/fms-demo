import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  Box,
  Eye,
  Camera,
  Layers,
  RotateCcw,
  Navigation,
  Upload,
  Sparkles,
  HelpCircle,
  Sliders,
  Check,
} from 'lucide-react';
import { useFms } from '../../context/FmsContext';
import { RobotState } from '../../types/rmf';
import officeModelsData from '../../data/officeModels.json';
import airportModelsData from '../../data/airportModels.json';
import hotelModelsData from '../../data/hotelModels.json';
import { computeMapCoordinateSystem } from '../traffic-editor/trafficCoordinates';

interface ThreeDigitalTwin3DProps {
  onSelectRobot?: (robot: RobotState | null) => void;
}

export const ThreeDigitalTwin3D: React.FC<ThreeDigitalTwin3DProps> = ({ onSelectRobot }) => {
  const {
    buildingMap,
    fleets,
    doorStates,
    liftStates,
    selectedFloor,
    setSelectedFloor,
    selectedRobot,
    setSelectedRobot,
  } = useFms();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Group references
  const mapGroupRef = useRef<THREE.Group>(new THREE.Group());
  const robotsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const robotObjectsRef = useRef<Map<string, {
    group: THREE.Group;
    targetPos: THREE.Vector3;
    targetRotY: number;
    lidar: THREE.Mesh;
    statusLed: THREE.Mesh;
    nameSprite: THREE.Sprite;
  }>>(new Map());

  // Interaction & UI State
  const [followingRobotName, setFollowingRobotName] = useState<string | null>(null);
  const [showDemoProps, setShowDemoProps] = useState<boolean>(true);
  const [showWaypoints, setShowWaypoints] = useState<boolean>(true);
  const [showLanes, setShowLanes] = useState<boolean>(true);
  const [showWalls, setShowWalls] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [customModelName, setCustomModelName] = useState<string | null>(null);
  const [cameraPreset, setCameraPreset] = useState<'iso' | 'top' | 'front'>('iso');
  const [fps, setFps] = useState<number>(60);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customGltfModelRef = useRef<THREE.Group | null>(null);

  // Active level calculation
  const currentLevel = useMemo(() => {
    return buildingMap.levels.find((lvl) => lvl.name === selectedFloor) || buildingMap.levels[0];
  }, [buildingMap, selectedFloor]);

  // Determine if map coordinates are metric or pixel-based
  // Floorplan image overlay state
  const [floorplanImg, setFloorplanImg] = useState<HTMLImageElement | null>(null);

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

  // Unified Coordinate System anchored to reference floorplan image
  const coordSys = useMemo(
    () => computeMapCoordinateSystem(buildingMap, currentLevel, floorplanImg),
    [buildingMap, currentLevel, floorplanImg],
  );

  const isMetric = coordSys.hasImage || !coordSys.isPixelMode;
  const mapToThreePos = coordSys.toThreePos;
  const originOffset = useMemo(
    () => ({
      minX: 0,
      maxX: coordSys.imageWidth,
      minY: -coordSys.imageHeight,
      maxY: 0,
      width: coordSys.canvasWidth,
      height: coordSys.canvasHeight,
    }),
    [coordSys.imageWidth, coordSys.imageHeight, coordSys.canvasWidth, coordSys.canvasHeight],
  );

  // Create text sprite helper for 3D holographic labels
  const createTextSprite = (text: string, color: string = '#00F0FF', bgColor: string = 'rgba(7, 9, 14, 0.85)'): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(8, 8, 240, 48, 8);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 20px "JetBrains Mono", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 32);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.8, 0.45, 1);
    return sprite;
  };

  // Helper: Create high-detail procedural AGV robot 3D mesh
  const createProceduralRobot = (robotName: string, fleetName: string): THREE.Group => {
    const robotGroup = new THREE.Group();

    const nameLower = (robotName + ' ' + fleetName).toLowerCase();
    const isCleaner = nameLower.includes('cleaner');
    const isDelivery = nameLower.includes('delivery');

    const accentColorHex = isCleaner ? 0x10B981 : isDelivery ? 0xF59E0B : 0x00F0FF;
    const accentColorStr = isCleaner ? '#10B981' : isDelivery ? '#F59E0B' : '#00F0FF';

    // 1. Main Chassis (Matte Carbon / Dark Metal)
    const chassisWidth = isDelivery ? 0.85 : isCleaner ? 0.78 : 0.7;
    const chassisDepth = isDelivery ? 0.65 : isCleaner ? 0.62 : 0.55;
    const chassisGeo = new THREE.BoxGeometry(chassisWidth, 0.22, chassisDepth);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x1E293B,
      metalness: 0.8,
      roughness: 0.25,
    });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = 0.16;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    robotGroup.add(chassis);

    // 2. Beveled Top Shell with Accent Trim
    const topShellGeo = new THREE.BoxGeometry(chassisWidth - 0.12, 0.08, chassisDepth - 0.09);
    const topShellMat = new THREE.MeshStandardMaterial({
      color: 0x0F172A,
      metalness: 0.6,
      roughness: 0.3,
    });
    const topShell = new THREE.Mesh(topShellGeo, topShellMat);
    topShell.position.y = 0.28;
    robotGroup.add(topShell);

    // 3. Status LED Halo / Glow Band
    const ledBandGeo = new THREE.BoxGeometry(chassisWidth + 0.02, 0.03, chassisDepth + 0.02);
    const ledBandMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      emissive: accentColorHex,
      emissiveIntensity: 0.85,
    });
    const ledBand = new THREE.Mesh(ledBandGeo, ledBandMat);
    ledBand.position.y = 0.23;
    robotGroup.add(ledBand);

    // Specific superstructure per fleet type:
    if (isCleaner) {
      // Cleaner AMR: Circular Scrubbing Head & Solution Reservoir
      const scrubberGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16);
      const scrubberMat = new THREE.MeshStandardMaterial({ color: 0x0F172A, metalness: 0.5, roughness: 0.4 });
      const scrubber = new THREE.Mesh(scrubberGeo, scrubberMat);
      scrubber.position.set(-0.25, 0.06, 0);
      robotGroup.add(scrubber);

      const tankGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.22, 16);
      const tankMat = new THREE.MeshStandardMaterial({ color: 0x10B981, transparent: true, opacity: 0.7, metalness: 0.2, roughness: 0.2 });
      const tank = new THREE.Mesh(tankGeo, tankMat);
      tank.position.set(-0.1, 0.42, 0);
      robotGroup.add(tank);
    } else if (isDelivery) {
      // Delivery AMR: Dual-shelf Cargo Transporter
      const rackMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
      const rackGeo = new THREE.BoxGeometry(0.65, 0.32, 0.48);
      const rack = new THREE.Mesh(rackGeo, rackMat);
      rack.position.set(0, 0.48, 0);
      robotGroup.add(rack);

      const cargoMat = new THREE.MeshStandardMaterial({ color: 0xF59E0B, metalness: 0.3, roughness: 0.6 });
      const cargoGeo = new THREE.BoxGeometry(0.5, 0.2, 0.38);
      const cargo = new THREE.Mesh(cargoGeo, cargoMat);
      cargo.position.set(0, 0.5, 0);
      robotGroup.add(cargo);
    }

    // 4. LiDAR Sensor Dome on top
    const lidarPillarGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.08, 16);
    const lidarPillarMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9 });
    const pillar = new THREE.Mesh(lidarPillarGeo, lidarPillarMat);
    pillar.position.y = isDelivery ? 0.68 : isCleaner ? 0.56 : 0.36;
    robotGroup.add(pillar);

    const lidarHeadGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16);
    const lidarHeadMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      emissive: accentColorHex,
      emissiveIntensity: 0.6,
    });
    const lidarHead = new THREE.Mesh(lidarHeadGeo, lidarHeadMat);
    lidarHead.position.y = isDelivery ? 0.73 : isCleaner ? 0.61 : 0.41;
    robotGroup.add(lidarHead);

    // 5. Headlights
    const lightGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xE0F2FE });
    const leftLight = new THREE.Mesh(lightGeo, lightMat);
    leftLight.rotation.z = Math.PI / 2;
    leftLight.position.set(chassisWidth / 2 + 0.005, 0.16, 0.16);
    robotGroup.add(leftLight);

    const rightLight = new THREE.Mesh(lightGeo, lightMat);
    rightLight.rotation.z = Math.PI / 2;
    rightLight.position.set(chassisWidth / 2 + 0.005, 0.16, -0.16);
    robotGroup.add(rightLight);

    // 6. Wheels (4 Omni/Drive Wheels)
    const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0A0E17, roughness: 0.9 });
    const wheelPositions = [
      [0.2, 0.09, chassisDepth / 2],
      [-0.2, 0.09, chassisDepth / 2],
      [0.2, 0.09, -chassisDepth / 2],
      [-0.2, 0.09, -chassisDepth / 2],
    ];
    wheelPositions.forEach(([wx, wy, wz]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      robotGroup.add(wheel);
    });

    // 7. Holographic Name & Telemetry Billboard
    const nameSprite = createTextSprite(robotName, accentColorStr);
    nameSprite.position.set(0, isDelivery ? 1.05 : isCleaner ? 0.95 : 0.8, 0);
    robotGroup.add(nameSprite);

    // Tag data for animation & interaction
    robotGroup.userData = { robotName, fleetName, lidar: lidarHead, statusLed: ledBand, nameSprite };

    return robotGroup;
  };

  // Build 3D Map Environment (Walls, Waypoints, Lanes, Doors)
  const rebuild3DMap = useCallback(() => {
    const group = mapGroupRef.current;
    // Clear previous map children
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    }

    if (!currentLevel) return;

    // --- 1. Floor Ground Plane with High-Tech Grid ---
    const dims = coordSys.get3DGroundDimensions();
    const mapW = dims.width;
    const mapH = dims.height;
    const groundSize = Math.max(80, Math.ceil(Math.max(mapW, mapH) * 1.5 / 20) * 20);

    const floorGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x080B12,
      roughness: 0.8,
      metalness: 0.2,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    group.add(floor);

    // Neon Cyber Grid
    const grid = new THREE.GridHelper(groundSize, Math.round(groundSize / 2), 0x00F0FF, 0x1E293B);
    grid.position.y = 0;
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.opacity = 0.22;
    gridMat.transparent = true;
    group.add(grid);

    // Floorplan Texture Plane (Render 2D map blueprint in 3D Digital Twin)
    const floorplanData = currentLevel.images?.[0]?.data || floorplanImg?.src;
    if (floorplanData) {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(floorplanData, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const pW = dims.width;
        const pH = dims.height;
        const planeGeo = new THREE.PlaneGeometry(pW, pH);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        const planeMesh = new THREE.Mesh(planeGeo, planeMat);
        planeMesh.rotation.x = -Math.PI / 2;
        planeMesh.position.set(0, 0.005, 0);
        group.add(planeMesh);
      });
    }

    // --- 2. 3D Architectural Extruded Walls ---
    if (showWalls && currentLevel.wall_segments) {
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0x1E293B,
        roughness: 0.35,
        metalness: 0.65,
      });
      const wallEdgeMat = new THREE.LineBasicMaterial({
        color: 0x38BDF8,
        transparent: true,
        opacity: 0.85,
      });

      const wallHeight = 2.4;
      const wallThickness = 0.22;

      currentLevel.wall_segments.forEach((w) => {
        const p1 = mapToThreePos(w.x1, w.y1);
        const p2 = mapToThreePos(w.x2, w.y2);

        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.05) return;

        const wallGeo = new THREE.BoxGeometry(length, wallHeight, wallThickness);
        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;

        wallMesh.position.set((p1.x + p2.x) / 2, wallHeight / 2, (p1.z + p2.z) / 2);
        wallMesh.rotation.y = -Math.atan2(dz, dx);
        group.add(wallMesh);

        // Neon glowing top edge
        const edgesGeo = new THREE.EdgesGeometry(wallGeo);
        const edgeLines = new THREE.LineSegments(edgesGeo, wallEdgeMat);
        edgeLines.position.copy(wallMesh.position);
        edgeLines.rotation.copy(wallMesh.rotation);
        group.add(edgeLines);
      });
    }

    // --- 3. Navigation Graph: Lanes & Waypoints (All Fleets) ---
    if (currentLevel.nav_graphs && currentLevel.nav_graphs.length > 0) {
      const graphColors = [0x00F0FF, 0x10B981, 0xF59E0B, 0xA855F7, 0x38BDF8];

      currentLevel.nav_graphs.forEach((graph, gIdx) => {
        const themeColor = graphColors[gIdx % graphColors.length];

        // Waypoints
        if (showWaypoints) {
          const wpGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.02, 16);
          const wpMat = new THREE.MeshBasicMaterial({ color: themeColor, transparent: true, opacity: 0.75 });
          const ringGeo = new THREE.RingGeometry(0.3, 0.36, 16);
          const ringMat = new THREE.MeshBasicMaterial({ color: themeColor, side: THREE.DoubleSide });

          graph.vertices.forEach((v) => {
            const p = mapToThreePos(v.x, v.y);
            const wpMesh = new THREE.Mesh(wpGeo, wpMat);
            wpMesh.position.set(p.x, 0.015, p.z);
            group.add(wpMesh);

            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.set(p.x, 0.018, p.z);
            group.add(ringMesh);

            if (showLabels && v.name) {
              const label = createTextSprite(v.name, '#38BDF8', 'rgba(15, 23, 42, 0.75)');
              label.scale.set(1.2, 0.3, 1);
              label.position.set(p.x, 0.35, p.z);
              group.add(label);
            }
          });
        }

        // Lanes (Traffic Paths)
        if (showLanes && graph.lanes) {
          const lanePoints: THREE.Vector3[] = [];
          graph.lanes.forEach((lane) => {
            const v1 = graph.vertices[lane.entry];
            const v2 = graph.vertices[lane.exit];
            if (v1 && v2) {
              const p1 = mapToThreePos(v1.x, v1.y);
              const p2 = mapToThreePos(v2.x, v2.y);
              lanePoints.push(new THREE.Vector3(p1.x, 0.02, p1.z));
              lanePoints.push(new THREE.Vector3(p2.x, 0.02, p2.z));
            }
          });

          if (lanePoints.length > 0) {
            const laneGeo = new THREE.BufferGeometry().setFromPoints(lanePoints);
            const laneMat = new THREE.LineBasicMaterial({
              color: themeColor,
              transparent: true,
              opacity: 0.45,
              linewidth: 2,
            });
            const laneLines = new THREE.LineSegments(laneGeo, laneMat);
            group.add(laneLines);
          }
        }
      });
    }

    // --- 4. Environment Props (Office, Airport Terminal, Hotel) ---
    const isAirport = (buildingMap.name || '').toLowerCase().includes('airport') || (buildingMap.name || '').toLowerCase().includes('terminal');
    const isHotel = (buildingMap.name || '').toLowerCase().includes('hotel');
    const isOffice = (buildingMap.name || '').toLowerCase().includes('office');

    if (showDemoProps) {
      // Materials
      const deskTopMat = new THREE.MeshStandardMaterial({ color: 0xF8FAFC, roughness: 0.25, metalness: 0.1 });
      const deskLegMat = new THREE.MeshStandardMaterial({ color: 0x64748B, metalness: 0.8, roughness: 0.3 });
      const blueDividerMat = new THREE.MeshStandardMaterial({ color: 0x2563EB, roughness: 0.7 });
      const chairBlackMat = new THREE.MeshStandardMaterial({ color: 0x1E293B, roughness: 0.8 });
      const chairBlueMat = new THREE.MeshStandardMaterial({ color: 0x1D4ED8, roughness: 0.8 });
      const chairGreyMat = new THREE.MeshStandardMaterial({ color: 0x64748B, roughness: 0.8 });
      const cabinetMat = new THREE.MeshStandardMaterial({ color: 0xE2E8F0, roughness: 0.4, metalness: 0.2 });
      const metalCabinetMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.3, metalness: 0.7 });
      const yellowCabinetMat = new THREE.MeshStandardMaterial({ color: 0xEAB308, roughness: 0.4, metalness: 0.3 });
      const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xCBD5E1, roughness: 0.2, metalness: 0.6 });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x785338, roughness: 0.6 });
      const screenMat = new THREE.MeshStandardMaterial({ color: 0x0F172A, metalness: 0.5 });
      const dispenserMat = new THREE.MeshStandardMaterial({ color: 0x0284C7, emissive: 0x00F0FF, emissiveIntensity: 0.4 });
      const pineMat = new THREE.MeshStandardMaterial({ color: 0x15803D, roughness: 0.8 });
      const personSkinMat = new THREE.MeshStandardMaterial({ color: 0x38BDF8, roughness: 0.4 });

      // Chair builder helper
      const buildChair = (mat: THREE.Material) => {
        const chair = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), mat);
        seat.position.y = 0.45;
        chair.add(seat);

        const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.05), mat);
        back.position.set(0, 0.7, -0.2);
        chair.add(back);

        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), deskLegMat);
        stem.position.y = 0.2;
        chair.add(stem);

        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8), mat);
        base.position.y = 0.03;
        chair.add(base);
        return chair;
      };

      // Table builder helper
      const buildAdjTable = () => {
        const table = new THREE.Group();
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.8), deskTopMat);
        top.position.y = 0.74;
        top.castShadow = true;
        top.receiveShadow = true;
        table.add(top);

        [[-0.65, -0.3], [0.65, -0.3], [-0.65, 0.3], [0.65, 0.3]].forEach(([lx, lz]) => {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.74, 8), deskLegMat);
          leg.position.set(lx, 0.37, lz);
          table.add(leg);
        });

        const divider = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.04), blueDividerMat);
        divider.position.set(0, 0.95, -0.38);
        table.add(divider);

        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.28, 0.02), screenMat);
        screen.position.set(0, 0.92, -0.2);
        table.add(screen);
        return table;
      };

      // Cubicle builder helper
      const buildCubicle = (isBig: boolean) => {
        const cubicle = new THREE.Group();
        const w = isBig ? 1.8 : 1.4;
        const d = isBig ? 1.4 : 1.1;
        const h = isBig ? 1.4 : 1.2;

        const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), blueDividerMat);
        back.position.set(0, h / 2, -d / 2);
        cubicle.add(back);

        const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, d), blueDividerMat);
        side1.position.set(-w / 2, h / 2, 0);
        cubicle.add(side1);

        const side2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, d), blueDividerMat);
        side2.position.set(w / 2, h / 2, 0);
        cubicle.add(side2);

        const desk = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, 0.04, d * 0.7), deskTopMat);
        desk.position.set(0, 0.74, -d * 0.15);
        cubicle.add(desk);

        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.28, 0.02), screenMat);
        screen.position.set(0, 0.92, -d * 0.35);
        cubicle.add(screen);
        return cubicle;
      };

      // Airport Fountain
      const buildFountain = () => {
        const f = new THREE.Group();
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.45, 20), cabinetMat);
        basin.position.y = 0.225;
        const water = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.05, 20), dispenserMat);
        water.position.y = 0.42;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.2, 16), metalCabinetMat);
        pillar.position.y = 0.8;
        f.add(basin, water, pillar);
        return f;
      };

      // Airport Pine/Indoor Tree
      const buildTree = () => {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.6, 8), woodMat);
        trunk.position.y = 0.8;
        const foliage = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.0, 8), pineMat);
        foliage.position.y = 2.8;
        tree.add(trunk, foliage);
        return tree;
      };

      // Stylized Terminal Passenger
      const buildPerson = () => {
        const p = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.1, 8), personSkinMat);
        body.position.y = 0.85;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), personSkinMat);
        head.position.y = 1.55;
        p.add(body, head);
        return p;
      };

      // Hotel Bed builder
      const buildBed = () => {
        const bed = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 2.1), woodMat);
        frame.position.y = 0.175;
        bed.add(frame);
        const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 2.0), deskTopMat);
        mattress.position.y = 0.45;
        bed.add(mattress);
        const pillow1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.35), deskTopMat);
        pillow1.position.set(-0.35, 0.6, -0.7);
        const pillow2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.35), deskTopMat);
        pillow2.position.set(0.35, 0.6, -0.7);
        bed.add(pillow1, pillow2);
        const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.9, 0.08), woodMat);
        headboard.position.set(0, 0.55, -1.02);
        bed.add(headboard);
        return bed;
      };

      // Hotel Toilet builder
      const buildToilet = () => {
        const t = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.55), cabinetMat);
        base.position.y = 0.2;
        const tank = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.45, 0.2), cabinetMat);
        tank.position.set(0, 0.5, -0.2);
        t.add(base, tank);
        return t;
      };

      // Hotel Sofa builder
      const buildSofa = () => {
        const s = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.8), chairBlueMat);
        seat.position.y = 0.25;
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.2), chairBlueMat);
        back.position.set(0, 0.6, -0.32);
        s.add(seat, back);
        return s;
      };

      // 4A. If Office map: render office models
      if (isOffice && Array.isArray(officeModelsData)) {
        (officeModelsData as any[]).forEach((m) => {
          const p = mapToThreePos(m.mx, m.my);
          const modelName = m.model_name || '';
          let meshObj: THREE.Group | THREE.Mesh | null = null;

          if (modelName.includes('AdjTable')) {
            meshObj = buildAdjTable();
          } else if (modelName.includes('SmallCubicle')) {
            meshObj = buildCubicle(false);
          } else if (modelName.includes('BigCubicle')) {
            meshObj = buildCubicle(true);
          } else if (modelName.includes('OfficeChairBlack')) {
            meshObj = buildChair(chairBlackMat);
          } else if (modelName.includes('OfficeChairBlue')) {
            meshObj = buildChair(chairBlueMat);
          } else if (modelName.includes('OfficeChairGrey')) {
            meshObj = buildChair(chairGreyMat);
          } else if (modelName.includes('ConfTable')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, 1.2), deskTopMat);
            meshObj.position.y = 0.74;
          } else if (modelName.includes('Fridge')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.8, 0.7), fridgeMat);
            meshObj.position.y = 0.9;
          } else if (modelName.includes('MetalCabinetYellow')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.45), yellowCabinetMat);
            meshObj.position.y = 0.7;
          } else if (modelName.includes('MetalCabinet')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.45), metalCabinetMat);
            meshObj.position.y = 0.7;
          } else if (modelName.includes('WhiteCabinet')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.45), cabinetMat);
            meshObj.position.y = 0.7;
          } else if (modelName.includes('Drawer')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.5), cabinetMat);
            meshObj.position.y = 0.28;
          } else if (modelName.includes('CoffeeTable')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.38, 0.6), woodMat);
            meshObj.position.y = 0.19;
          } else if (modelName.includes('SquareShelf')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.4), woodMat);
            meshObj.position.y = 0.75;
          } else if (modelName.includes('TrashBin')) {
            meshObj = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.38, 12), chairBlackMat);
            meshObj.position.y = 0.19;
          } else if (modelName.includes('TeleportDispenser') || modelName.includes('TeleportIngestor')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.4), dispenserMat);
            meshObj.position.y = 0.35;
          }

          if (meshObj) {
            meshObj.position.set(p.x, meshObj.position.y || 0, p.z);
            meshObj.rotation.y = m.yaw || 0;
            group.add(meshObj);
          }
        });
      }

      // 4B. If Airport Terminal map: render airport models
      if (isAirport && Array.isArray(airportModelsData)) {
        (airportModelsData as any[]).forEach((m) => {
          const p = mapToThreePos(m.x, m.y);
          const modelName = m.model_name || '';
          let meshObj: THREE.Group | THREE.Mesh | null = null;

          if (modelName.includes('Fountain')) {
            meshObj = buildFountain();
          } else if (modelName.includes('Pine Tree') || modelName.includes('Oak tree')) {
            meshObj = buildTree();
          } else if (modelName.includes('Standing person') || modelName.includes('Visitor')) {
            meshObj = buildPerson();
          } else if (modelName.includes('Cafe table') || modelName.includes('Table')) {
            meshObj = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16), deskTopMat);
            meshObj.position.y = 0.74;
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.74, 8), deskLegMat);
            leg.position.y = 0.37;
            const tableGrp = new THREE.Group();
            tableGrp.add(meshObj, leg);
            meshObj = tableGrp;
          } else if (modelName.includes('Chair') || modelName.includes('MiniSofa')) {
            meshObj = buildChair(chairBlueMat);
          } else if (modelName.includes('ElectronicsRecycling') || modelName.includes('Teleport')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.4, 0.65), metalCabinetMat);
            meshObj.position.y = 0.7;
          }

          if (meshObj) {
            meshObj.position.set(p.x, meshObj.position.y || 0, p.z);
            meshObj.rotation.y = m.yaw || 0;
            group.add(meshObj);
          }
        });
      }

      // 4C. If Hotel map: render 3-floor hotel models (beds, desks, chairs, bathrooms)
      if (isHotel && Array.isArray(hotelModelsData)) {
        (hotelModelsData as any[]).forEach((m) => {
          if (m.level_name && m.level_name !== selectedFloor) return;
          const p = mapToThreePos(m.x, m.y);
          const modelName = m.model_name || '';
          let meshObj: THREE.Group | THREE.Mesh | null = null;

          if (modelName.includes('Bed')) {
            meshObj = buildBed();
          } else if (modelName.includes('Toilet')) {
            meshObj = buildToilet();
          } else if (modelName.includes('Sofa') || modelName.includes('Bench')) {
            meshObj = buildSofa();
          } else if (modelName.includes('Desk') || modelName.includes('Table')) {
            const tableGrp = new THREE.Group();
            const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.75), woodMat);
            top.position.y = 0.72;
            tableGrp.add(top);
            [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].forEach(([lx, lz]) => {
              const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8), deskLegMat);
              leg.position.set(lx, 0.36, lz);
              tableGrp.add(leg);
            });
            meshObj = tableGrp;
          } else if (modelName.includes('Chair')) {
            meshObj = buildChair(chairBlueMat);
          } else if (
            modelName.includes('Fridge') ||
            modelName.includes('StorageRack') ||
            modelName.includes('VendingMachine')
          ) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.7), metalCabinetMat);
            meshObj.position.y = 0.85;
          } else if (modelName.includes('BathroomSink') || modelName.includes('KitchenCountertop')) {
            meshObj = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 0.6), cabinetMat);
            meshObj.position.y = 0.425;
          }

          if (meshObj) {
            meshObj.position.set(p.x, meshObj.position.y || 0, p.z);
            meshObj.rotation.y = m.yaw || 0;
            group.add(meshObj);
          }
        });
      }
    }

    // --- 5. Interactive 3D Doors ---
    if (currentLevel.doors) {
      currentLevel.doors.forEach((door) => {
        const dAny = door as any;
        const x1 = dAny.x1 ?? (door.x !== undefined ? door.x - 0.6 : 0);
        const y1 = dAny.y1 ?? (door.y !== undefined ? door.y : 0);
        const x2 = dAny.x2 ?? (door.x !== undefined ? door.x + 0.6 : 0);
        const y2 = dAny.y2 ?? (door.y !== undefined ? door.y : 0);

        const p1 = mapToThreePos(x1, y1);
        const p2 = mapToThreePos(x2, y2);
        const length = Math.sqrt((p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2);
        if (length < 0.1) return;

        const isOpen = doorStates[door.name]?.current_mode?.value === 2; // 2 = open
        const doorGeo = new THREE.BoxGeometry(length * (isOpen ? 0.15 : 0.95), 2.2, 0.08);
        const doorMat = new THREE.MeshStandardMaterial({
          color: isOpen ? 0x10B981 : 0xEF4444,
          transparent: true,
          opacity: 0.8,
        });
        const doorMesh = new THREE.Mesh(doorGeo, doorMat);
        doorMesh.position.set((p1.x + p2.x) / 2, 1.1, (p1.z + p2.z) / 2);
        doorMesh.rotation.y = -Math.atan2(p2.z - p1.z, p2.x - p1.x);
        group.add(doorMesh);
      });
    }

    // --- 6. 3D Elevator Shafts & Cabins ---
    if (buildingMap.lifts && buildingMap.lifts.length > 0) {
      buildingMap.lifts.forEach((lift) => {
        const rx = lift.ref_x !== undefined ? lift.ref_x : 0;
        const ry = lift.ref_y !== undefined ? lift.ref_y : 0;
        const p = mapToThreePos(rx, ry);
        const liftW = lift.width || 2.7;
        const liftD = lift.depth || 2.7;

        // Semi-transparent glass elevator cabin
        const cabinGeo = new THREE.BoxGeometry(liftW * 0.95, 2.4, liftD * 0.95);
        const cabinMat = new THREE.MeshStandardMaterial({
          color: 0x8B5CF6,
          transparent: true,
          opacity: 0.35,
          roughness: 0.2,
          metalness: 0.8,
        });
        const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat);
        cabinMesh.position.set(p.x, 1.2, p.z);
        group.add(cabinMesh);

        // Cabin glowing violet wireframe
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(cabinGeo),
          new THREE.LineBasicMaterial({ color: 0xC084FC })
        );
        edges.position.copy(cabinMesh.position);
        group.add(edges);

        // Elevator status label
        const curFloor = liftStates[lift.name]?.current_floor || selectedFloor;
        const label = createTextSprite(
          `${lift.name} [${curFloor}]`,
          '#C084FC',
          'rgba(139, 92, 246, 0.35)'
        );
        label.scale.set(1.8, 0.45, 1);
        label.position.set(p.x, 2.7, p.z);
        group.add(label);
      });
    }
  }, [
    currentLevel,
    mapToThreePos,
    showWalls,
    showWaypoints,
    showLanes,
    showLabels,
    showDemoProps,
    doorStates,
    liftStates,
    buildingMap.name,
    buildingMap.lifts,
    selectedFloor,
  ]);

  // Main Three.js Scene Initialization
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090E);
    const isLarge = (originOffset.width || 0) > 120;
    const isMedium = (originOffset.width || 0) > 25;
    scene.fog = new THREE.FogExp2(0x07090E, isLarge ? 0.0022 : 0.012);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1200,
    );
    if (isLarge) {
      camera.position.set(0, 105, 125);
    } else if (isMedium) {
      camera.position.set(0, 34, 40);
    } else {
      camera.position.set(18, 22, 24);
    }
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.05; // Do not go below floor
    controls.minDistance = 3;
    controls.maxDistance = 550;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.85);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xE0F2FE, 1.4);
    dirLight.position.set(40, 80, 40);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 400;
    dirLight.shadow.camera.left = -180;
    dirLight.shadow.camera.right = 180;
    dirLight.shadow.camera.top = 180;
    dirLight.shadow.camera.bottom = -180;
    scene.add(dirLight);

    const blueRimLight = new THREE.DirectionalLight(0x00F0FF, 0.7);
    blueRimLight.position.set(-60, 40, -60);
    scene.add(blueRimLight);

    // Add Groups to Scene
    scene.add(mapGroupRef.current);
    scene.add(robotsGroupRef.current);

    // Resize Handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      // FPS tracking
      frameCount++;
      if (now - lastFpsUpdate > 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)));
        frameCount = 0;
        lastFpsUpdate = now;
      }

      // Smoothly interpolate robots position and rotate LiDAR sensor
      robotObjectsRef.current.forEach((robotObj) => {
        // Position lerp
        robotObj.group.position.lerp(robotObj.targetPos, 0.08);

        // Rotation lerp
        let diff = robotObj.targetRotY - robotObj.group.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        robotObj.group.rotation.y += diff * 0.1;

        // Spin LiDAR scanner
        if (robotObj.lidar) {
          robotObj.lidar.rotation.y += delta * 12;
        }
      });

      // Camera Follow active robot
      if (followingRobotName) {
        const followedRobot = robotObjectsRef.current.get(followingRobotName);
        if (followedRobot && controls) {
          const rPos = followedRobot.group.position;
          controls.target.lerp(new THREE.Vector3(rPos.x, 0.3, rPos.z), 0.08);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update Map geometry whenever floor or layer visibility toggles
  useEffect(() => {
    rebuild3DMap();
  }, [rebuild3DMap]);

  // Synchronize Live Robots from `fleets` Context
  useEffect(() => {
    const robotsGroup = robotsGroupRef.current;
    const currentRobotMap = robotObjectsRef.current;
    const activeRobotNames = new Set<string>();

    const robotsOnFloor = fleets
      .flatMap((f) => f.robots.map((r) => ({ robot: r, fleet: f.name })))
      .filter(({ robot }) => !robot.location.level_name || robot.location.level_name === selectedFloor);

    robotsOnFloor.forEach(({ robot, fleet }) => {
      activeRobotNames.add(robot.name);
      const pos = mapToThreePos(robot.location.x, robot.location.y);
      const targetVec = new THREE.Vector3(pos.x, 0, pos.z);
      const targetYaw = robot.location.yaw || 0;

      let robotEntry = currentRobotMap.get(robot.name);

      if (!robotEntry) {
        // Create new 3D Robot mesh
        let meshGroup: THREE.Group;
        if (customGltfModelRef.current) {
          meshGroup = customGltfModelRef.current.clone();
        } else {
          meshGroup = createProceduralRobot(robot.name, fleet);
        }

        meshGroup.position.copy(targetVec);
        meshGroup.rotation.y = targetYaw;
        robotsGroup.add(meshGroup);

        const lidar = meshGroup.userData.lidar || new THREE.Mesh();
        const statusLed = meshGroup.userData.statusLed || new THREE.Mesh();
        const nameSprite = meshGroup.userData.nameSprite || createTextSprite(robot.name);

        robotEntry = {
          group: meshGroup,
          targetPos: targetVec,
          targetRotY: targetYaw,
          lidar,
          statusLed,
          nameSprite,
        };
        currentRobotMap.set(robot.name, robotEntry);
      } else {
        // Update targets
        robotEntry.targetPos.copy(targetVec);
        robotEntry.targetRotY = targetYaw;

        // Update LED color according to battery and status
        const isSelected = selectedRobot?.name === robot.name;
        const ledMat = robotEntry.statusLed.material as THREE.MeshStandardMaterial;
        if (ledMat) {
          if (isSelected) {
            ledMat.color.setHex(0xA855F7); // Purple for selected
            ledMat.emissive.setHex(0xA855F7);
          } else if (robot.battery < 0.25) {
            ledMat.color.setHex(0xEF4444); // Red warning
            ledMat.emissive.setHex(0xEF4444);
          } else if (robot.mode === 'charging') {
            ledMat.color.setHex(0xF59E0B); // Amber
            ledMat.emissive.setHex(0xF59E0B);
          } else {
            ledMat.color.setHex(0x00F0FF); // Cyan
            ledMat.emissive.setHex(0x00F0FF);
          }
        }
      }
    });

    // Remove robots no longer on floor
    currentRobotMap.forEach((entry, name) => {
      if (!activeRobotNames.has(name)) {
        robotsGroup.remove(entry.group);
        currentRobotMap.delete(name);
      }
    });
  }, [fleets, selectedFloor, mapToThreePos, selectedRobot]);

  // Raycasting for clicking on robots in 3D
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mountRef.current || !cameraRef.current || !sceneRef.current) return;
    const rect = mountRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);
    const intersects = raycaster.intersectObjects(robotsGroupRef.current.children, true);

    if (intersects.length > 0) {
      let topObj: THREE.Object3D | null = intersects[0].object;
      while (topObj && !topObj.userData?.robotName && topObj.parent) {
        topObj = topObj.parent;
      }
      if (topObj && topObj.userData?.robotName) {
        const rName = topObj.userData.robotName;
        const found = fleets.flatMap((f) => f.robots).find((r) => r.name === rName);
        if (found) {
          setSelectedRobot(found);
          if (onSelectRobot) onSelectRobot(found);
          setFollowingRobotName(rName);
        }
      }
    }
  };

  // Switch camera views
  const applyCameraPreset = (preset: 'iso' | 'top' | 'front') => {
    setCameraPreset(preset);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const isLarge = (originOffset.width || 0) > 120;
    const isMedium = (originOffset.width || 0) > 25;
    const d = isLarge ? 115 : isMedium ? 36 : 25;

    if (preset === 'top') {
      camera.position.set(0, d * 1.35, 0.001);
      controls.target.set(0, 0, 0);
    } else if (preset === 'front') {
      camera.position.set(0, d * 0.35, d * 1.1);
      controls.target.set(0, 0, 0);
    } else {
      // Isometric view
      camera.position.set(0, d * 0.9, d * 1.05);
      controls.target.set(0, 0, 0);
    }
    controls.update();
  };

  // Reset Camera View
  const resetCamera = () => {
    setFollowingRobotName(null);
    applyCameraPreset('iso');
  };

  // Load Custom Demo 3D Model (.gltf / .glb)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCustomModelName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const contents = event.target?.result as ArrayBuffer;
      const loader = new GLTFLoader();
      loader.parse(
        contents,
        '',
        (gltf) => {
          // Normalize model scale
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const scaleFactor = 0.8 / (maxDim || 1);
          gltf.scene.scale.set(scaleFactor, scaleFactor, scaleFactor);
          gltf.scene.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });

          customGltfModelRef.current = gltf.scene;

          // Rebuild current robots with new model
          const currentMap = robotObjectsRef.current;
          robotsGroupRef.current.clear();
          currentMap.clear();
        },
        (error) => {
          console.error('Error parsing GLTF file:', error);
          alert('Failed to parse 3D GLTF/GLB file. Please ensure it is a valid format.');
        },
      );
    };
    reader.readAsArrayBuffer(file);
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
      {/* Three.js Canvas Container */}
      <div
        ref={mountRef}
        onClick={handleCanvasClick}
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
        }}
      />

      {/* Top Left HUD: Floor & Telemetry info */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(10, 14, 22, 0.88)',
          backdropFilter: 'blur(12px)',
          padding: '6px 12px',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)',
          zIndex: 10,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box size={16} color="var(--accent-cyan)" />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.5px' }}>
            DIGITAL TWIN 3D (THREE.JS / WEBGL)
          </span>
        </div>

        <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />

        {/* Floor Level Selector */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {buildingMap.levels.map((lvl) => {
            const isActive = lvl.name === selectedFloor;
            return (
              <button
                key={lvl.name}
                onClick={() => {
                  setSelectedFloor(lvl.name);
                  setFollowingRobotName(null);
                }}
                style={{
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: isActive ? 'var(--accent-cyan)' : 'transparent',
                  color: isActive ? '#07090E' : 'var(--text-secondary)',
                  transition: 'all 0.2s',
                }}
              >
                {lvl.name}
              </button>
            );
          })}
        </div>

        <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />

        <span style={{ fontSize: '11px', color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
          {fps} FPS
        </span>
      </div>

      {/* Top Center: Lock/Follow indicator */}
      {followingRobotName && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 240, 255, 0.15)',
            border: '1px solid var(--accent-cyan)',
            backdropFilter: 'blur(8px)',
            padding: '6px 14px',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--accent-cyan)',
            zIndex: 10,
          }}
        >
          <Navigation size={14} />
          <span>Tracking: {followingRobotName}</span>
          <button
            onClick={() => setFollowingRobotName(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              cursor: 'pointer',
              fontSize: '11px',
              textDecoration: 'underline',
              marginLeft: '4px',
            }}
          >
            Unlock
          </button>
        </div>
      )}

      {/* Right Toolbar: Camera Views & Quick Layer Toggles */}
      <div
        style={{
          position: 'absolute',
          top: '64px',
          right: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 10,
        }}
      >
        {/* Camera Views Preset */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(10, 14, 22, 0.88)',
            backdropFilter: 'blur(12px)',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => applyCameraPreset('iso')}
            className="btn btn-secondary"
            title="Isometric 3D View"
            style={{
              padding: '9px 12px',
              border: 'none',
              borderRadius: 0,
              fontSize: '11px',
              fontWeight: 600,
              color: cameraPreset === 'iso' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              background: cameraPreset === 'iso' ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
            }}
          >
            ISO 45°
          </button>
          <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
          <button
            onClick={() => applyCameraPreset('top')}
            className="btn btn-secondary"
            title="Top-Down Plan View"
            style={{
              padding: '9px 12px',
              border: 'none',
              borderRadius: 0,
              fontSize: '11px',
              fontWeight: 600,
              color: cameraPreset === 'top' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              background: cameraPreset === 'top' ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
            }}
          >
            TOP 2D
          </button>
          <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
          <button
            onClick={resetCamera}
            className="btn btn-secondary"
            title="Reset Camera Center"
            style={{
              padding: '9px 12px',
              border: 'none',
              borderRadius: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {/* 3D Model & Layer Settings Button */}
        <button
          onClick={() => setShowSettingsDrawer(!showSettingsDrawer)}
          className="btn btn-secondary"
          style={{
            padding: '10px',
            borderRadius: '10px',
            background: showSettingsDrawer ? 'rgba(0, 240, 255, 0.2)' : 'rgba(10, 14, 22, 0.88)',
            borderColor: showSettingsDrawer ? 'var(--accent-cyan)' : 'var(--border-subtle)',
          }}
          title="3D Model & Visual Layers Settings"
        >
          <Sliders size={16} />
        </button>
      </div>

      {/* 3D Settings Drawer / Modal */}
      {showSettingsDrawer && (
        <div
          style={{
            position: 'absolute',
            top: '64px',
            right: '68px',
            width: '280px',
            background: 'rgba(13, 18, 29, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '16px',
            zIndex: 25,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '13px' }}>
              3D DIGITAL TWIN OPTIONS
            </span>
            <button
              onClick={() => setShowSettingsDrawer(false)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          {/* Custom 3D Model Upload (.glb / .gltf) */}
          <div style={{ marginBottom: '16px' }}>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              CUSTOM 3D ROBOT MODEL (GLTF / GLB)
            </span>
            <input
              type="file"
              ref={fileInputRef}
              accept=".gltf,.glb"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', gap: '6px', padding: '8px' }}
            >
              <Upload size={14} />
              <span>{customModelName ? `Loaded: ${customModelName}` : 'Load .GLTF / .GLB File'}</span>
            </button>
            {customModelName && (
              <button
                onClick={() => {
                  setCustomModelName(null);
                  customGltfModelRef.current = null;
                  robotObjectsRef.current.clear();
                  robotsGroupRef.current.clear();
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-amber)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                Reset to Procedural AGV Model
              </button>
            )}
          </div>

          {/* Visual Layer Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
              3D SCENE LAYERS
            </span>

            {[
              { label: '3D Extruded Walls', state: showWalls, toggle: () => setShowWalls(!showWalls) },
              { label: 'Navigation Lanes', state: showLanes, toggle: () => setShowLanes(!showLanes) },
              { label: 'Waypoints & Stations', state: showWaypoints, toggle: () => setShowWaypoints(!showWaypoints) },
              { label: 'Holographic Labels', state: showLabels, toggle: () => setShowLabels(!showLabels) },
              { label: 'Demo Warehouse Props', state: showDemoProps, toggle: () => setShowDemoProps(!showDemoProps) },
            ].map(({ label, state, toggle }) => (
              <label
                key={label}
                onClick={toggle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: state ? '#FFFFFF' : 'var(--text-muted)',
                }}
              >
                <span>{label}</span>
                <span
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    background: state ? 'var(--accent-cyan)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state && <Check size={12} color="#07090E" />}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
