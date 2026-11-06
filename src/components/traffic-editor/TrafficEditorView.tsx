import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MousePointer,
  MapPin,
  Route,
  ArrowLeftRight,
  ShieldAlert,
  Trash2,
  Undo2,
  Redo2,
  Save,
  Download,
  Upload,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Copy,
  Zap,
  ParkingSquare,
  Compass,
  Image as ImageIcon,
  FolderArchive,
  FileCode,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Layers,
  Sparkles,
  Database,
  Clock,
  FilePlus,
  AlertTriangle,
  Archive,
  RefreshCw,
} from 'lucide-react';
import { useFms } from '../../context/FmsContext';
import { NavGraph, MapVertex, MapLane, BuildingMap } from '../../types/rmf';
import {
  exportStandardBuildingYaml,
  exportNavGraphToYaml,
  triggerFileDownload,
  triggerBlobDownload,
  parseNavGraphContent,
  createBuildingMapZip,
  extractBuildingMapZip,
} from './trafficYamlUtils';
import { computeMapCoordinateSystem } from './trafficCoordinates';
import { getDarkFloorplan } from '../map/floorplanTheme';
import { rmfClient } from '../../services/rmf-client';
import { trafficDraftStorage, TrafficMapDraft } from '../../services/trafficDraftStorage';

type EditorTool =
  | 'select'
  | 'add-waypoint'
  | 'add-lane'
  | 'toggle-direction'
  | 'toggle-closure'
  | 'delete';

export const TrafficEditorView: React.FC = () => {
  const navigate = useNavigate();
  const {
    buildingMap,
    selectedFloor,
    setSelectedFloor,
    updateNavGraph,
    saveBuildingMap,
    resetBuildingMap,
    setActiveTab,
  } = useFms();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Selection states
  const [selectedGraphIndex, setSelectedGraphIndex] = useState<number>(0);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [selectedLaneIndex, setSelectedLaneIndex] = useState<number | null>(null);
  const [laneStartVertex, setLaneStartVertex] = useState<number | null>(null);

  // View & Transform states
  const [zoom, setZoom] = useState<number>(1.0);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 60, y: 40 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDraggingVertex, setIsDraggingVertex] = useState<boolean>(false);

  // Map visuals & overlay states
  const [showFloorplan, setShowFloorplan] = useState<boolean>(true);
  const [floorplanOpacity, setFloorplanOpacity] = useState<number>(0.3);
  const [darkFloorplan, setDarkFloorplan] = useState<boolean>(true);
  const [showWalls, setShowWalls] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [gridStep] = useState<number>(0.5); // 0.5 meter snap

  // Hover & mouse coordinates
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null);
  const [hoveredLane, setHoveredLane] = useState<number | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mouseMetricPos, setMouseMetricPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Dialogs & Feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<'building-yaml' | 'nav-yaml' | 'json'>('building-yaml');
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Custom 2D uploaded map image states
  const [uploadedImageFile, setUploadedImageFile] = useState<File | Blob | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);
  const [uploadedImageDataUrl, setUploadedImageDataUrl] = useState<string | null>(null);
  const [uploadedImageDimensions, setUploadedImageDimensions] = useState<{ width: number; height: number } | null>(null);

  // Import modal states
  const [importTab, setImportTab] = useState<'image' | 'zip' | 'yaml'>('image');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewDimensions, setImagePreviewDimensions] = useState<{ width: number; height: number } | null>(null);
  const [importBuildingName, setImportBuildingName] = useState<string>(buildingMap.name || 'Building');
  const [importFloorName, setImportFloorName] = useState<string>(selectedFloor || 'L1');
  const [importClearExisting, setImportClearExisting] = useState<boolean>(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [isUnzipping, setIsUnzipping] = useState<boolean>(false);

  // Import Purpose & Edit Actions
  const [importPurpose, setImportPurpose] = useState<'new-map' | 'edit-current'>('new-map');
  const [editAction, setEditAction] = useState<'replace-image' | 'add-level' | 'overwrite-level'>('replace-image');

  // Local Drafts (IndexedDB) states
  const [lastAutoSavedTime, setLastAutoSavedTime] = useState<string | null>(null);
  const [savedDraftsCount, setSavedDraftsCount] = useState<number>(0);
  const [showDraftsModal, setShowDraftsModal] = useState<boolean>(false);
  const [draftsList, setDraftsList] = useState<TrafficMapDraft[]>([]);
  const [detectedDraftBanner, setDetectedDraftBanner] = useState<TrafficMapDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);

  // Save & Deploy to RMF API states
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStepMessage, setSaveStepMessage] = useState<string>('');
  const [showSaveSuccessModal, setShowSaveSuccessModal] = useState<boolean>(false);
  const [lastSavedZipBlob, setLastSavedZipBlob] = useState<Blob | null>(null);
  const [lastSavedZipFilename, setLastSavedZipFilename] = useState<string>('');
  const [deployedMapSummary, setDeployedMapSummary] = useState<{
    buildingName: string;
    levelName: string;
    waypointsCount: number;
    lanesCount: number;
    imageFilename: string;
    uploadStatus: string;
    refreshStatus: string;
  } | null>(null);

  // Get current Level and active NavGraph
  const currentLevel = useMemo(() => {
    return buildingMap.levels.find((lvl) => lvl.name === selectedFloor) || buildingMap.levels[0];
  }, [buildingMap, selectedFloor]);

  const activeNavGraph = useMemo(() => {
    if (!currentLevel?.nav_graphs || currentLevel.nav_graphs.length === 0) {
      return {
        name: 'default',
        vertices: [],
        lanes: [],
      };
    }
    return currentLevel.nav_graphs[selectedGraphIndex] || currentLevel.nav_graphs[0];
  }, [currentLevel, selectedGraphIndex]);

  // Local working copy of the graph for editing with Undo/Redo
  const [workingGraph, setWorkingGraph] = useState<NavGraph>(() => ({
    name: activeNavGraph.name,
    vertices: JSON.parse(JSON.stringify(activeNavGraph.vertices || [])),
    lanes: JSON.parse(JSON.stringify(activeNavGraph.lanes || [])),
  }));

  // Undo / Redo history stack
  const [history, setHistory] = useState<NavGraph[]>([
    JSON.parse(JSON.stringify(workingGraph)),
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // Refs to track last loaded floor/graph/map name
  const lastLoadedFloorRef = useRef<string>(selectedFloor);
  const lastLoadedGraphRef = useRef<number>(selectedGraphIndex);
  const lastLoadedMapNameRef = useRef<string>(buildingMap.name);

  // Keep working graph in sync when floor or graph changes (if clean or explicit change)
  useEffect(() => {
    const isFloorOrGraphChange =
      lastLoadedFloorRef.current !== selectedFloor ||
      lastLoadedGraphRef.current !== selectedGraphIndex ||
      lastLoadedMapNameRef.current !== buildingMap.name;

    // If user is currently editing or has unsaved changes, do NOT overwrite with background map updates
    if (isDirty && !isFloorOrGraphChange) {
      return;
    }

    lastLoadedFloorRef.current = selectedFloor;
    lastLoadedGraphRef.current = selectedGraphIndex;
    lastLoadedMapNameRef.current = buildingMap.name;

    const clone = {
      name: activeNavGraph.name || 'default',
      vertices: JSON.parse(JSON.stringify(activeNavGraph.vertices || [])),
      lanes: JSON.parse(JSON.stringify(activeNavGraph.lanes || [])),
    };
    setWorkingGraph(clone);
    setHistory([JSON.parse(JSON.stringify(clone))]);
    setHistoryIndex(0);
    setSelectedVertexIndex(null);
    setSelectedLaneIndex(null);
    setLaneStartVertex(null);
    setIsDirty(false);
  }, [selectedFloor, selectedGraphIndex, buildingMap]);

  // Floorplan image state
  const [floorplanImg, setFloorplanImg] = useState<HTMLImageElement | null>(null);

  // Unified Coordinate System anchored to reference floorplan image
  const coordSys = useMemo(
    () => computeMapCoordinateSystem(buildingMap, currentLevel, floorplanImg, workingGraph.vertices),
    [buildingMap, currentLevel, floorplanImg, workingGraph.vertices]
  );

  const effectiveScale = coordSys.effectiveScale;
  const isMetric = coordSys.hasImage || !coordSys.isPixelMode;
  const meterScale = 1;
  const originOffset = useMemo(
    () => ({
      minX: 0,
      maxX: coordSys.imageWidth,
      minY: -coordSys.imageHeight,
      maxY: 0,
      width: coordSys.canvasWidth,
      height: coordSys.canvasHeight,
    }),
    [coordSys.imageWidth, coordSys.imageHeight, coordSys.canvasWidth, coordSys.canvasHeight]
  );

  // Coordinate transforms
  const toCanvasPos = coordSys.toCanvasPos;
  const fromCanvasPos = coordSys.fromCanvasPos;

  // Floorplan image loader
  useEffect(() => {
    const rawUrl = uploadedImageDataUrl || currentLevel?.images?.[0]?.data;
    if (!rawUrl) {
      const bName = (buildingMap.name || '').toLowerCase();
      const isAirport = bName.includes('airport');
      const isHotel = bName.includes('hotel');
      const isOffice = bName.includes('office');
      const targetSrc = isAirport
        ? '/maps/airport_terminal.png'
        : isHotel
          ? `/maps/hotel_${selectedFloor || 'L1'}.png`
          : isOffice
            ? '/maps/office.png'
            : null;

      if (!targetSrc) {
        setFloorplanImg(null);
        return;
      }
      const img = new Image();
      img.src = targetSrc;
      img.onload = () => setFloorplanImg(img);
      return;
    }

    const img = new Image();
    if (rawUrl.startsWith('http')) {
      img.crossOrigin = 'anonymous';
    }
    img.src = rawUrl;
    img.onload = () => {
      setFloorplanImg(img);
      if (uploadedImageDataUrl) {
        setUploadedImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (rawUrl.startsWith('http')) {
        const retry = new Image();
        retry.src = rawUrl;
        retry.onload = () => {
          setFloorplanImg(retry);
          if (uploadedImageDataUrl) {
            setUploadedImageDimensions({ width: retry.naturalWidth, height: retry.naturalHeight });
          }
        };
      } else {
        setFloorplanImg(null);
      }
    };
  }, [currentLevel, buildingMap.name, selectedFloor, uploadedImageDataUrl]);

  // Auto-fit view to a specific image dimension
  const fitViewToImage = useCallback((imgWidth: number, imgHeight: number) => {
    const canvas = canvasRef.current;
    if (!canvas || imgWidth <= 0 || imgHeight <= 0) return;
    const cw = canvas.clientWidth || 900;
    const ch = canvas.clientHeight || 600;
    const totalW = imgWidth + 160;
    const totalH = imgHeight + 160;
    const fitZoom = Math.min(Math.max(0.15, Math.min((cw - 40) / totalW, (ch - 40) / totalH)), 2.5);
    setZoom(fitZoom);
    setOffset({
      x: (cw - totalW * fitZoom) / 2,
      y: (ch - totalH * fitZoom) / 2,
    });
  }, []);

  // Auto-fit initial view
  const handleResetView = useCallback(() => {
    if (coordSys.hasImage) {
      fitViewToImage(coordSys.imageWidth, coordSys.imageHeight);
      return;
    }
    setZoom(1.0);
    setOffset({ x: 60, y: 40 });
  }, [coordSys.hasImage, coordSys.imageWidth, coordSys.imageHeight, fitViewToImage]);

  useEffect(() => {
    handleResetView();
  }, [selectedFloor, handleResetView]);

  // Toast feedback helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Push new state to history
  const commitWorkingGraph = (nextGraph: NavGraph) => {
    setWorkingGraph(nextGraph);
    setIsDirty(true);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(nextGraph)));
    if (newHistory.length > 30) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  // Undo / Redo
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setWorkingGraph(JSON.parse(JSON.stringify(prev)));
      setIsDirty(true);
      showToast('Undo action');
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setWorkingGraph(JSON.parse(JSON.stringify(next)));
      setIsDirty(true);
      showToast('Redo action');
    }
  };

  // Refresh drafts list from IndexedDB
  const refreshDraftsList = useCallback(async () => {
    try {
      const list = await trafficDraftStorage.getAllDrafts();
      setDraftsList(list);
      setSavedDraftsCount(list.length);
    } catch (err) {
      console.warn('Error refreshing drafts list:', err);
    }
  }, []);

  // Initial load: check for drafts and detect latest unsaved draft
  useEffect(() => {
    refreshDraftsList();
    (async () => {
      try {
        const latest = await trafficDraftStorage.getLatestDraft();
        if (latest && latest.waypointsCount > 0) {
          const diffHours = (Date.now() - latest.updatedAt) / (1000 * 60 * 60);
          if (diffHours < 24 * 7) {
            setDetectedDraftBanner(latest);
          }
        }
      } catch (e) {
        console.warn('Failed to check latest draft', e);
      }
    })();
  }, [refreshDraftsList]);

  // Auto-Save Draft to IndexedDB (Debounced 1.5s whenever dirty)
  useEffect(() => {
    if (!isDirty || !workingGraph) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const bName = (buildingMap.name || 'Building').trim();
        const floor = selectedFloor || 'L1';
        const draftId = `${bName}:${floor}`;

        await trafficDraftStorage.saveDraft({
          id: draftId,
          buildingName: bName,
          levelName: floor,
          updatedAt: Date.now(),
          waypointsCount: workingGraph.vertices.length,
          lanesCount: workingGraph.lanes.length,
          imageDataUrl: uploadedImageDataUrl || currentLevel?.images?.[0]?.data || null,
          imageFilename: uploadedImageName || currentLevel?.images?.[0]?.name || null,
          imageDimensions: uploadedImageDimensions,
          navGraph: workingGraph,
          meterScale: meterScale,
          isDirty: isDirty,
        });

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        setLastAutoSavedTime(timeStr);
        refreshDraftsList();
      } catch (err) {
        console.warn('Auto-save draft error:', err);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    workingGraph,
    uploadedImageDataUrl,
    uploadedImageName,
    uploadedImageDimensions,
    buildingMap.name,
    selectedFloor,
    isDirty,
    meterScale,
    currentLevel,
    refreshDraftsList,
  ]);

  // Restore Draft from IndexedDB
  const handleRestoreDraft = (draft: TrafficMapDraft) => {
    setSelectedFloor(draft.levelName);
    if (draft.imageDataUrl) {
      setUploadedImageDataUrl(draft.imageDataUrl);
      setUploadedImageName(draft.imageFilename || `${draft.buildingName}_${draft.levelName}.png`);
      const img = new Image();
      img.onload = () => {
        setFloorplanImg(img);
        setUploadedImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        fitViewToImage(img.naturalWidth, img.naturalHeight);
      };
      img.src = draft.imageDataUrl;
    } else {
      setUploadedImageDataUrl(null);
      setUploadedImageName(null);
    }

    commitWorkingGraph(draft.navGraph);
    setIsDirty(Boolean(draft.isDirty));

    // Update tracking refs so the sync effect does not overwrite the restored graph
    lastLoadedFloorRef.current = draft.levelName;
    lastLoadedMapNameRef.current = draft.buildingName;

    const targetFloor = draft.levelName;
    const existingLevel = buildingMap.levels.find((lvl) => lvl.name === targetFloor);
    const updatedLevels = existingLevel
      ? buildingMap.levels.map((lvl) => {
          if (lvl.name !== targetFloor) return lvl;
          const graphs = [...(lvl.nav_graphs || [])];
          graphs[selectedGraphIndex] = draft.navGraph;
          const images = draft.imageDataUrl
            ? [{ name: draft.imageFilename || `${draft.buildingName}_${draft.levelName}.png`, data: draft.imageDataUrl, scale: 1, x_offset: 0, y_offset: 0, yaw: 0 }]
            : lvl.images;
          return { ...lvl, nav_graphs: graphs, images };
        })
      : [
          ...buildingMap.levels,
          {
            name: targetFloor,
            elevation: 0,
            nav_graphs: [draft.navGraph],
            doors: [],
            wall_segments: [],
            images: draft.imageDataUrl
              ? [{ name: draft.imageFilename || `${draft.buildingName}_${draft.levelName}.png`, data: draft.imageDataUrl, scale: 1, x_offset: 0, y_offset: 0, yaw: 0 }]
              : [],
          },
        ];

    saveBuildingMap({
      ...buildingMap,
      name: draft.buildingName,
      levels: updatedLevels,
    });

    setShowDraftsModal(false);
    setDetectedDraftBanner(null);
    showToast(`✓ Đã khôi phục bản nháp: "${draft.buildingName} - ${draft.levelName}" (${draft.waypointsCount} điểm, ${draft.lanesCount} đường)!`);
  };

  // Delete Draft from IndexedDB
  const handleDeleteDraft = async (draftId: string) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa bản nháp này khỏi bộ nhớ máy?')) {
      await trafficDraftStorage.deleteDraft(draftId);
      refreshDraftsList();
      showToast('Đã xóa bản nháp khỏi IndexedDB');
    }
  };

  // Clear all Drafts
  const handleClearAllDrafts = async () => {
    if (window.confirm('CẢNH BÁO: Xóa tất cả các bản nháp đang lưu trong IndexedDB của trình duyệt?')) {
      await trafficDraftStorage.clearAllDrafts();
      refreshDraftsList();
      showToast('Đã xóa toàn bộ bản nháp');
    }
  };

  // Process 2D Map Image upload
  const handleProcessImageImport = async (
    file: File,
    buildingNameVal = importBuildingName,
    floorNameVal = importFloorName,
    clearExisting = importClearExisting
  ) => {
    // If creating a new map and current has waypoints, save a backup draft of the current map first!
    if (importPurpose === 'new-map' && workingGraph.vertices.length > 0) {
      try {
        await trafficDraftStorage.saveDraft({
          id: `${(buildingMap.name || 'Building').trim()}:${selectedFloor}`,
          buildingName: buildingMap.name || 'Building',
          levelName: selectedFloor,
          updatedAt: Date.now(),
          waypointsCount: workingGraph.vertices.length,
          lanesCount: workingGraph.lanes.length,
          imageDataUrl: uploadedImageDataUrl || currentLevel?.images?.[0]?.data || null,
          imageFilename: uploadedImageName || currentLevel?.images?.[0]?.name || null,
          imageDimensions: uploadedImageDimensions,
          navGraph: workingGraph,
          meterScale: meterScale,
          isDirty: true,
        });
        refreshDraftsList();
      } catch (e) {
        console.warn('Backup draft error:', e);
      }
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        setUploadedImageFile(file);
        setUploadedImageName(file.name);
        setUploadedImageDataUrl(dataUrl);
        setUploadedImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        setFloorplanImg(img);

        const shouldResetGraph = importPurpose === 'new-map' || clearExisting;
        if (shouldResetGraph) {
          // 🆕 TẠO BẢN ĐỒ MỚI HOÀN TOÀN - Reset sạch canvas và tọa độ
          const targetFloor = floorNameVal || 'L1';
          const freshGraph: NavGraph = {
            name: 'default',
            vertices: [],
            lanes: [],
          };
          setWorkingGraph(freshGraph);
          setHistory([JSON.parse(JSON.stringify(freshGraph))]);
          setHistoryIndex(0);
          setSelectedVertexIndex(null);
          setSelectedLaneIndex(null);
          setLaneStartVertex(null);
          setSelectedFloor(targetFloor);

          // Update tracking refs so sync effect does not reload previous graph
          lastLoadedFloorRef.current = targetFloor;
          const cleanName = (buildingNameVal || 'New_Building').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
          lastLoadedMapNameRef.current = cleanName;

          saveBuildingMap({
            name: cleanName,
            levels: [
              {
                name: targetFloor,
                elevation: 0,
                nav_graphs: [freshGraph],
                doors: [],
                wall_segments: [],
                images: [
                  {
                    name: file.name,
                    data: dataUrl,
                    scale: 1,
                    x_offset: 0,
                    y_offset: 0,
                    yaw: 0,
                  },
                ],
              },
            ],
            lifts: [],
          });
          showToast(`✓ Đã tạo bản đồ mới: "${cleanName} - ${targetFloor}". Toàn bộ điểm và đường cũ đã được xóa sạch.`);
        } else {
          // 🛠️ CẬP NHẬT BẢN ĐỒ HIỆN TẠI
          if (editAction === 'replace-image') {
            // Case 1: Chỉ thay ảnh nền, GIỮ NGUYÊN 100% tọa độ waypoints & lanes
            // Xóa tường cũ của toà nhà trước để không bị dính đè lên bản đồ mới
            const targetFloor = selectedFloor || 'L1';
            const updatedLevels = buildingMap.levels.map((lvl) => {
              if (lvl.name !== targetFloor) return lvl;
              return {
                ...lvl,
                wall_segments: [],
                doors: [],
                images: [
                  {
                    name: file.name,
                    data: dataUrl,
                    scale: 1,
                    x_offset: 0,
                    y_offset: 0,
                    yaw: 0,
                  },
                ],
              };
            });
            saveBuildingMap({
              ...buildingMap,
              levels: updatedLevels,
            });
            showToast(`✓ Đã thay ảnh nền 2D mới cho "${buildingMap.name} - ${targetFloor}". Giữ nguyên ${workingGraph.vertices.length} waypoints & ${workingGraph.lanes.length} lanes!`);
          } else if (editAction === 'add-level') {
            // Case 2: Thêm tầng mới vào toà nhà hiện tại
            const newFloorName = floorNameVal || `L${buildingMap.levels.length + 1}`;
            const freshGraph: NavGraph = { name: 'default', vertices: [], lanes: [] };
            const newLevel = {
              name: newFloorName,
              elevation: buildingMap.levels.length * 3.5,
              nav_graphs: [freshGraph],
              doors: [],
              wall_segments: [],
              images: [
                {
                  name: file.name,
                  data: dataUrl,
                  scale: 1,
                  x_offset: 0,
                  y_offset: 0,
                  yaw: 0,
                },
              ],
            };
            saveBuildingMap({
              ...buildingMap,
              levels: [...buildingMap.levels, newLevel],
            });
            setSelectedFloor(newFloorName);
            setWorkingGraph(freshGraph);
            setHistory([JSON.parse(JSON.stringify(freshGraph))]);
            setHistoryIndex(0);
            showToast(`✓ Đã thêm tầng mới "${newFloorName}" vào tòa nhà "${buildingMap.name}"!`);
          } else {
            // Case 3: Ghi đè tầng hiện tại
            const targetFloor = floorNameVal || selectedFloor || 'L1';
            const updatedLevels = buildingMap.levels.map((lvl) => {
              if (lvl.name !== targetFloor) return lvl;
              return {
                ...lvl,
                images: [
                  {
                    name: file.name,
                    data: dataUrl,
                    scale: 1,
                    x_offset: 0,
                    y_offset: 0,
                    yaw: 0,
                  },
                ],
              };
            });
            saveBuildingMap({ ...buildingMap, levels: updatedLevels });
            showToast(`✓ Đã cập nhật ảnh tầng "${targetFloor}".`);
          }
        }

        setIsDirty(true);
        setActiveTool('add-waypoint');
        fitViewToImage(img.naturalWidth, img.naturalHeight);
        setShowImportModal(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Process ZIP Map Package upload
  const handleProcessZipImport = async (file: File) => {
    try {
      setIsUnzipping(true);
      const extracted = await extractBuildingMapZip(file);
      if (!extracted.imageBlob && !extracted.yamlContent) {
        alert('Could not find 2D image or YAML in the uploaded ZIP file.');
        return;
      }

      // Check if importing a different building: save current draft first
      if (workingGraph.vertices.length > 0) {
        try {
          await trafficDraftStorage.saveDraft({
            id: `${(buildingMap.name || 'Building').trim()}:${selectedFloor}`,
            buildingName: buildingMap.name || 'Building',
            levelName: selectedFloor,
            updatedAt: Date.now(),
            waypointsCount: workingGraph.vertices.length,
            lanesCount: workingGraph.lanes.length,
            imageDataUrl: uploadedImageDataUrl || currentLevel?.images?.[0]?.data || null,
            imageFilename: uploadedImageName || currentLevel?.images?.[0]?.name || null,
            imageDimensions: uploadedImageDimensions,
            navGraph: workingGraph,
            meterScale: meterScale,
            isDirty: isDirty,
          });
          refreshDraftsList();
        } catch (e) {
          console.warn('Backup draft error:', e);
        }
      }

      if (extracted.buildingName) {
        setImportBuildingName(extracted.buildingName);
        lastLoadedMapNameRef.current = extracted.buildingName;
      }
      if (extracted.floorName) {
        setSelectedFloor(extracted.floorName);
        lastLoadedFloorRef.current = extracted.floorName;
      }

      if (extracted.imageDataUrl && extracted.imageBlob && extracted.imageFilename) {
        setUploadedImageFile(extracted.imageBlob);
        setUploadedImageName(extracted.imageFilename);
        setUploadedImageDataUrl(extracted.imageDataUrl);
        const img = new Image();
        img.onload = () => {
          setFloorplanImg(img);
          setUploadedImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          fitViewToImage(img.naturalWidth, img.naturalHeight);
        };
        img.src = extracted.imageDataUrl;
      }

      if (extracted.parsedGraph && extracted.parsedGraph.vertices && extracted.parsedGraph.vertices.length > 0) {
        const newGraph: NavGraph = {
          name: extracted.parsedGraph.name || 'default',
          vertices: (extracted.parsedGraph.vertices || []) as MapVertex[],
          lanes: (extracted.parsedGraph.lanes || []) as MapLane[],
        };
        commitWorkingGraph(newGraph);
      } else {
        const freshGraph: NavGraph = { name: 'default', vertices: [], lanes: [] };
        commitWorkingGraph(freshGraph);
      }

      setIsDirty(true);
      setShowImportModal(false);
      showToast(`✓ Đã nạp thành công gói bản đồ từ "${file.name}"!`);
    } catch (err: any) {
      console.error('Failed to extract zip:', err);
      alert(`Error extracting ZIP: ${err?.message || 'Invalid format'}`);
    } finally {
      setIsUnzipping(false);
    }
  };

  // Save changes & Deploy: Package ZIP (image + YAML), POST /building-map, GET /building-map
  const handleSaveChanges = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveStepMessage('1/3: Preparing 2D Map & YAML...');

    try {
      // 1. Determine image Blob & filename
      let imageBlob: Blob | null = uploadedImageFile;
      let imgFileName = uploadedImageName || currentLevel?.images?.[0]?.name;

      if (!imageBlob && uploadedImageDataUrl) {
        try {
          const resp = await fetch(uploadedImageDataUrl);
          imageBlob = await resp.blob();
        } catch (e) {
          console.warn('Could not extract blob from uploadedImageDataUrl', e);
        }
      }

      if (!imageBlob && currentLevel?.images?.[0]?.data) {
        try {
          const resp = await fetch(currentLevel.images[0].data);
          imageBlob = await resp.blob();
        } catch (e) {
          console.warn('Could not fetch existing image data', e);
        }
      }

      // If still no blob, try default /maps/office.png
      if (!imageBlob) {
        try {
          const resp = await fetch('/maps/office.png');
          if (resp.ok) {
            imageBlob = await resp.blob();
            if (!imgFileName) imgFileName = 'office.png';
          }
        } catch (e) {
          console.warn('Could not fetch fallback /maps/office.png', e);
        }
      }

      // If still no blob, extract from floorplanImg
      if (!imageBlob && floorplanImg && floorplanImg.naturalWidth > 0) {
        try {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = floorplanImg.naturalWidth;
          offCanvas.height = floorplanImg.naturalHeight;
          const offCtx = offCanvas.getContext('2d');
          if (offCtx) {
            offCtx.drawImage(floorplanImg, 0, 0);
            imageBlob = await new Promise<Blob | null>((resolve) => offCanvas.toBlob(resolve, 'image/png'));
          }
        } catch (e) {
          console.warn('Could not extract blob from floorplan image', e);
        }
      }

      if (!imgFileName) {
        imgFileName = `${(buildingMap.name || 'map').replace(/\s+/g, '_')}_${selectedFloor}.png`;
      } else if (!imgFileName.includes('.')) {
        imgFileName = `${imgFileName}.png`;
      }

      if (!imageBlob) {
        throw new Error('Unable to construct 2D map image for ZIP packaging.');
      }

      // 2. Build ZIP Package containing:
      // - 2D Map Image (e.g. office.png / custom_map.png)
      // - YAML File (<building_name>.building.yaml)
      setSaveStepMessage('2/3: Zipping 2D Map image and YAML...');
      const cleanBuildingName = (buildingMap.name || 'building').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const zipPackage = await createBuildingMapZip({
        buildingName: cleanBuildingName,
        floorName: selectedFloor,
        navGraph: workingGraph,
        graphIndex: selectedGraphIndex,
        imageBlob: imageBlob,
        imageFilename: imgFileName,
        buildingMap: buildingMap,
      });

      const zipFilename = `${cleanBuildingName}.zip`;
      setLastSavedZipBlob(zipPackage.zipBlob);
      setLastSavedZipFilename(zipFilename);

      // 3. Call API 1: POST /building-map (Upload Building Map)
      setSaveStepMessage('3/3: Calling POST /building-map (Uploading ZIP)...');
      let uploadStatus = 'Success (201 Created)';
      let uploadRes: any = null;
      try {
        uploadRes = await rmfClient.uploadBuildingMap(zipPackage.zipBlob, zipFilename);
        console.log('POST /building-map response:', uploadRes);
        if (uploadRes && uploadRes.success === false) {
          const detail = uploadRes.errors?.[0]?.detail || uploadRes.message || 'Server rejected building map';
          throw new Error(detail);
        }
      } catch (err: any) {
        console.warn('POST /building-map request error:', err);
        const serverDetail = err?.response?.data?.errors?.[0]?.detail || err?.response?.data?.message;
        if (serverDetail) {
          throw new Error(`RMF Server rejected map: ${serverDetail}`);
        }
        uploadStatus = `Notice: Offline (${err?.message || 'Saved locally'})`;
      }

      // 4. Call API 2: GET /building-map (Fetch verified map)
      setSaveStepMessage('Calling GET /building-map (Retrieving updated map)...');
      let refreshStatus = 'Success (200 OK)';
      let freshMap: BuildingMap | null = null;
      try {
        freshMap = await rmfClient.getBuildingMap();
        const servedVertices = freshMap.levels.find((lvl) => lvl.name === selectedFloor)?.nav_graphs?.[selectedGraphIndex]?.vertices;
        if (
          servedVertices &&
          servedVertices.length === workingGraph.vertices.length &&
          servedVertices.some((v, i) => Math.hypot(v.x - workingGraph.vertices[i].x, v.y - workingGraph.vertices[i].y) > 0.05)
        ) {
          refreshStatus = 'WARNING: the nav graph generated by the server does not match the editor (coordinates differ). Do not assign it to a fleet.';
          showToast(`⚠️ ${refreshStatus}`);
        }
      } catch (err: any) {
        console.warn('GET /building-map request error:', err);
        refreshStatus = `Notice: ${err?.response?.data?.message || err?.message || 'Using local state'}`;
      }

      // 5. Update FMS state & Context (Enrich with calibrated scale and image data)
      updateNavGraph(selectedFloor, selectedGraphIndex, workingGraph);

      const targetScale = effectiveScale;
      lastLoadedFloorRef.current = selectedFloor;
      lastLoadedMapNameRef.current = freshMap?.name || cleanBuildingName;

      if (freshMap && freshMap.levels && freshMap.levels.length > 0) {
        const enrichedLevels = freshMap.levels.map((lvl) => {
          const isTargetLevel = lvl.name === selectedFloor;
          const matchingOldLevel = buildingMap.levels.find((l) => l.name === lvl.name);
          const oldImage = matchingOldLevel?.images?.[0];
          const preferredData =
            (uploadedImageDataUrl?.startsWith('data:') ? uploadedImageDataUrl : null) ||
            (oldImage?.data?.startsWith('data:') ? oldImage.data : null) ||
            lvl.images?.[0]?.data ||
            floorplanImg?.src ||
            uploadedImageDataUrl;
          const enrichedImages = (lvl.images && lvl.images.length > 0)
            ? lvl.images.map((img) => ({
                ...img,
                scale: (img.scale && img.scale > 0.0001 && img.scale < 0.4) ? img.scale : targetScale,
                data: preferredData || img.data,
              }))
            : [{ name: imgFileName || 'map.png', data: preferredData || uploadedImageDataUrl || '', scale: targetScale, x_offset: 0, y_offset: 0, yaw: 0 }];

          // Keep user's workingGraph on the edited level
          const graphs = isTargetLevel
            ? (lvl.nav_graphs && lvl.nav_graphs.length > 0
                ? lvl.nav_graphs.map((g, idx) => (idx === selectedGraphIndex ? workingGraph : g))
                : [workingGraph])
            : (lvl.nav_graphs || []);

          // Clear residual old walls & doors when using custom uploaded map
          const wallSegments = (uploadedImageDataUrl || importPurpose === 'new-map') ? [] : (lvl.wall_segments || []);
          const doors = (uploadedImageDataUrl || importPurpose === 'new-map') ? [] : (lvl.doors || []);

          return {
            ...lvl,
            wall_segments: wallSegments,
            doors: doors,
            nav_graphs: graphs,
            images: enrichedImages,
          };
        });
        saveBuildingMap({ ...freshMap, name: cleanBuildingName, levels: enrichedLevels });
      } else {
        const localUpdatedLevels = buildingMap.levels.map((lvl) => {
          if (lvl.name !== selectedFloor) return lvl;
          const graphs = [...(lvl.nav_graphs || [])];
          graphs[selectedGraphIndex] = workingGraph;
          const images = uploadedImageDataUrl
            ? [{ name: imgFileName, data: uploadedImageDataUrl, scale: targetScale, x_offset: 0, y_offset: 0, yaw: 0 }]
            : lvl.images?.map((img) => ({
                ...img,
                scale: (img.scale && img.scale > 0.0001 && img.scale < 0.4) ? img.scale : targetScale,
              }));
          const wallSegments = (uploadedImageDataUrl || importPurpose === 'new-map') ? [] : (lvl.wall_segments || []);
          const doors = (uploadedImageDataUrl || importPurpose === 'new-map') ? [] : (lvl.doors || []);
          return { ...lvl, wall_segments: wallSegments, doors: doors, nav_graphs: graphs, images };
        });
        saveBuildingMap({ ...buildingMap, name: cleanBuildingName, levels: localUpdatedLevels });
      }

      // Delete draft for this level from IndexedDB so the unsaved banner clears
      try {
        await trafficDraftStorage.deleteDraft(`${cleanBuildingName}:${selectedFloor}`);
        setDetectedDraftBanner(null);
        refreshDraftsList();
      } catch (e) {
        console.warn('Draft cleanup notice:', e);
      }

      setIsDirty(false);
      setDeployedMapSummary({
        buildingName: freshMap?.name || cleanBuildingName,
        levelName: selectedFloor,
        waypointsCount: workingGraph.vertices.length,
        lanesCount: workingGraph.lanes.length,
        imageFilename: imgFileName,
        uploadStatus,
        refreshStatus,
      });

      setShowSaveSuccessModal(true);
      showToast('✓ Saved & Deployed to RMF! Digital Twin Map updated.');
    } catch (error: any) {
      console.error('Failed to save & deploy building map:', error);
      showToast(`⚠️ Save Error: ${error?.message || 'Could not save map'}`);
    } finally {
      setIsSaving(false);
      setSaveStepMessage('');
    }
  };

  // Hit testing helpers
  const findVertexAt = (cx: number, cy: number, threshold = 14): number | null => {
    for (let i = 0; i < workingGraph.vertices.length; i++) {
      const v = workingGraph.vertices[i];
      const p = toCanvasPos(v.x, v.y);
      if (Math.hypot(p.x - cx, p.y - cy) <= threshold) {
        return i;
      }
    }
    return null;
  };

  // Distance from point (px, py) to segment (ax, ay) -> (bx, by)
  const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const l2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
  };

  const findLaneAt = (cx: number, cy: number, threshold = 10): number | null => {
    for (let i = 0; i < workingGraph.lanes.length; i++) {
      const lane = workingGraph.lanes[i];
      const v1 = workingGraph.vertices[lane.entry];
      const v2 = workingGraph.vertices[lane.exit];
      if (!v1 || !v2) continue;
      const p1 = toCanvasPos(v1.x, v1.y);
      const p2 = toCanvasPos(v2.x, v2.y);
      if (distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) <= threshold) {
        return i;
      }
    }
    return null;
  };

  // Delete Vertex with index remapping
  const deleteVertex = (vIdx: number) => {
    const nextVertices = workingGraph.vertices.filter((_, idx) => idx !== vIdx);
    // Remap remaining vertices indices
    nextVertices.forEach((v, idx) => {
      v.index = idx;
    });

    // Remove connected lanes and remap endpoints
    const nextLanes: MapLane[] = [];
    workingGraph.lanes.forEach((l) => {
      if (l.entry === vIdx || l.exit === vIdx) return;
      const newEntry = l.entry > vIdx ? l.entry - 1 : l.entry;
      const newExit = l.exit > vIdx ? l.exit - 1 : l.exit;
      nextLanes.push({
        ...l,
        entry: newEntry,
        exit: newExit,
        index: nextLanes.length,
      });
    });

    commitWorkingGraph({
      ...workingGraph,
      vertices: nextVertices,
      lanes: nextLanes,
    });
    setSelectedVertexIndex(null);
    setSelectedLaneIndex(null);
    showToast(`Deleted Waypoint WP_${vIdx}`);
  };

  // Delete Lane
  const deleteLane = (lIdx: number) => {
    const nextLanes = workingGraph.lanes.filter((_, idx) => idx !== lIdx);
    nextLanes.forEach((l, idx) => {
      l.index = idx;
    });
    commitWorkingGraph({
      ...workingGraph,
      lanes: nextLanes,
    });
    setSelectedLaneIndex(null);
    showToast(`Deleted Lane #${lIdx}`);
  };

  // Toggle lane direction
  const cycleLaneDirection = (lIdx: number) => {
    const lane = workingGraph.lanes[lIdx];
    if (!lane) return;
    const nextLanes = [...workingGraph.lanes];
    if (lane.two_way) {
      // 2-way -> 1-way forward
      nextLanes[lIdx] = { ...lane, two_way: false };
      showToast('Set Lane to One-Way (Entry ➔ Exit)');
    } else {
      // 1-way -> Reverse or back to 2-way
      // Toggle endpoints
      nextLanes[lIdx] = {
        ...lane,
        entry: lane.exit,
        exit: lane.entry,
        two_way: true,
      };
      showToast('Set Lane to Two-Way (Bidirectional)');
    }
    commitWorkingGraph({ ...workingGraph, lanes: nextLanes });
  };

  // Toggle lane closure (maintenance mode)
  const toggleLaneClosure = (lIdx: number) => {
    const lane = workingGraph.lanes[lIdx];
    if (!lane) return;
    const nextLanes = [...workingGraph.lanes];
    const isClosed = !lane.is_closed;
    nextLanes[lIdx] = { ...lane, is_closed: isClosed };
    commitWorkingGraph({ ...workingGraph, lanes: nextLanes });
    showToast(isClosed ? '🔴 Lane CLOSED (Keep-out / Maintenance)' : '🟢 Lane OPEN (Active traffic)');
  };

  // Canvas Mouse Events
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const nextZoom = Math.min(Math.max(0.2, zoom * zoomFactor), 4.5);
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
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left - offset.x) / zoom;
    const cy = (e.clientY - rect.top - offset.y) / zoom;

    // Middle button or right button or space key initiates panning
    if (e.button === 1 || e.button === 2) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    if (e.button === 0) {
      const clickedV = findVertexAt(cx, cy);
      const clickedL = clickedV === null ? findLaneAt(cx, cy) : null;

      // Handle Tools
      if (activeTool === 'select') {
        if (clickedV !== null) {
          setSelectedVertexIndex(clickedV);
          setSelectedLaneIndex(null);
          setIsDraggingVertex(true);
        } else if (clickedL !== null) {
          setSelectedLaneIndex(clickedL);
          setSelectedVertexIndex(null);
        } else {
          // Clicked empty space -> pan
          setIsPanning(true);
          setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
          setSelectedVertexIndex(null);
          setSelectedLaneIndex(null);
        }
      } else if (activeTool === 'add-waypoint') {
        // Drop new waypoint
        let mCoords = fromCanvasPos(cx, cy);
        if (snapToGrid) {
          mCoords = {
            x: Math.round(mCoords.x / gridStep) * gridStep,
            y: Math.round(mCoords.y / gridStep) * gridStep,
          };
        }
        const newIdx = workingGraph.vertices.length;
        const newVertex: MapVertex = {
          index: newIdx,
          x: parseFloat(mCoords.x.toFixed(3)),
          y: parseFloat(mCoords.y.toFixed(3)),
          name: `wp_${newIdx + 1}`,
          is_charger: false,
          is_parking_spot: false,
          is_holding_point: false,
        };
        const nextVertices = [...workingGraph.vertices, newVertex];
        commitWorkingGraph({ ...workingGraph, vertices: nextVertices });
        setSelectedVertexIndex(newIdx);
        showToast(`Added Waypoint ${newVertex.name}`);
      } else if (activeTool === 'add-lane') {
        if (clickedV !== null) {
          if (laneStartVertex === null) {
            // First waypoint selected
            setLaneStartVertex(clickedV);
            setSelectedVertexIndex(clickedV);
          } else {
            // Second waypoint selected -> create lane
            if (laneStartVertex === clickedV) {
              setLaneStartVertex(null); // Clicked same waypoint, cancel
            } else {
              // Check if lane already exists between them
              const exists = workingGraph.lanes.some(
                (l) =>
                  (l.entry === laneStartVertex && l.exit === clickedV) ||
                  (l.entry === clickedV && l.exit === laneStartVertex)
              );
              if (exists) {
                showToast('Lane already exists between these two waypoints');
              } else {
                const newLane: MapLane = {
                  index: workingGraph.lanes.length,
                  entry: laneStartVertex,
                  exit: clickedV,
                  two_way: true,
                };
                const nextLanes = [...workingGraph.lanes, newLane];
                commitWorkingGraph({ ...workingGraph, lanes: nextLanes });
                showToast(`Created Lane between WP_${laneStartVertex} and WP_${clickedV}`);
              }
              setLaneStartVertex(null);
            }
          }
        } else {
          setLaneStartVertex(null);
        }
      } else if (activeTool === 'toggle-direction') {
        if (clickedL !== null) {
          cycleLaneDirection(clickedL);
        }
      } else if (activeTool === 'toggle-closure') {
        if (clickedL !== null) {
          toggleLaneClosure(clickedL);
        }
      } else if (activeTool === 'delete') {
        if (clickedV !== null) {
          deleteVertex(clickedV);
        } else if (clickedL !== null) {
          deleteLane(clickedL);
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left - offset.x) / zoom;
    const cy = (e.clientY - rect.top - offset.y) / zoom;
    setMouseCanvasPos({ x: cx, y: cy });

    const mPos = fromCanvasPos(cx, cy);
    setMouseMetricPos({
      x: parseFloat(mPos.x.toFixed(2)),
      y: parseFloat(mPos.y.toFixed(2)),
    });

    if (isPanning) {
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (isDraggingVertex && selectedVertexIndex !== null) {
      let nextCoords = fromCanvasPos(cx, cy);
      if (snapToGrid) {
        nextCoords = {
          x: Math.round(nextCoords.x / gridStep) * gridStep,
          y: Math.round(nextCoords.y / gridStep) * gridStep,
        };
      }
      const nextVertices = [...workingGraph.vertices];
      nextVertices[selectedVertexIndex] = {
        ...nextVertices[selectedVertexIndex],
        x: parseFloat(nextCoords.x.toFixed(3)),
        y: parseFloat(nextCoords.y.toFixed(3)),
      };
      setWorkingGraph((prev) => ({ ...prev, vertices: nextVertices }));
      setIsDirty(true);
      return;
    }

    // Hover detection
    const vHover = findVertexAt(cx, cy);
    setHoveredVertex(vHover);
    if (vHover === null) {
      const lHover = findLaneAt(cx, cy);
      setHoveredLane(lHover);
    } else {
      setHoveredLane(null);
    }
  };

  const handleMouseUp = () => {
    if (isDraggingVertex) {
      // Commit move to history
      commitWorkingGraph(workingGraph);
      setIsDraggingVertex(false);
    }
    setIsPanning(false);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveChanges();
      } else if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
      } else if (e.key === 'w' || e.key === 'W') {
        setActiveTool('add-waypoint');
      } else if (e.key === 'l' || e.key === 'L') {
        setActiveTool('add-lane');
      } else if (e.key === 'd' || e.key === 'D') {
        setActiveTool('toggle-direction');
      } else if (e.key === 'c' || e.key === 'C') {
        setActiveTool('toggle-closure');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedVertexIndex !== null) deleteVertex(selectedVertexIndex);
        else if (selectedLaneIndex !== null) deleteLane(selectedLaneIndex);
      } else if (e.key === 'Escape') {
        setLaneStartVertex(null);
        setSelectedVertexIndex(null);
        setSelectedLaneIndex(null);
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Render Canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Deep Blueprint Background
    ctx.fillStyle = '#06080E';
    ctx.fillRect(0, 0, width, height);

    // Grid Rendering
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
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

    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    // 1. Draw Floorplan Blueprint Underlay
    if (showFloorplan && floorplanImg) {
      const originPos = toCanvasPos(0, 0);
      ctx.save();
      ctx.globalAlpha = floorplanOpacity;
      const planImage = darkFloorplan ? getDarkFloorplan(floorplanImg) : floorplanImg;
      ctx.drawImage(planImage, originPos.x, originPos.y, floorplanImg.naturalWidth, floorplanImg.naturalHeight);
      ctx.restore();
    }

    // 2. Draw Walls for Spatial Reference
    if (showWalls && currentLevel?.wall_segments) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      currentLevel.wall_segments.forEach((w) => {
        const p1 = toCanvasPos(w.x1, w.y1);
        const p2 = toCanvasPos(w.x2, w.y2);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      });

      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      currentLevel.wall_segments.forEach((w) => {
        const p1 = toCanvasPos(w.x1, w.y1);
        const p2 = toCanvasPos(w.x2, w.y2);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      });
    }

    // 3. Draw Lanes (Edges)
    workingGraph.lanes.forEach((lane, lIdx) => {
      const v1 = workingGraph.vertices[lane.entry];
      const v2 = workingGraph.vertices[lane.exit];
      if (!v1 || !v2) return;

      const p1 = toCanvasPos(v1.x, v1.y);
      const p2 = toCanvasPos(v2.x, v2.y);
      const isSelected = selectedLaneIndex === lIdx;
      const isHovered = hoveredLane === lIdx;
      const isClosed = Boolean(lane.is_closed);

      ctx.save();

      // Selected / Hovered Halo
      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? '#00F0FF' : 'rgba(0, 240, 255, 0.4)';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Lane line body
      if (isClosed) {
        // Red dashed line for closed lanes
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 3.5;
        ctx.setLineDash([8, 6]);
      } else {
        ctx.strokeStyle = isSelected ? '#FFFFFF' : '#00F0FF';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Directional Arrows
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);

      if (isClosed) {
        // Red 'X' warning badge on closed lane
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-3, -3);
        ctx.lineTo(3, 3);
        ctx.moveTo(3, -3);
        ctx.lineTo(-3, 3);
        ctx.stroke();
      } else if (lane.two_way) {
        // Double-ended arrow
        ctx.fillStyle = isSelected ? '#00F0FF' : 'rgba(0, 240, 255, 0.9)';
        ctx.beginPath();
        // Arrow pointing right
        ctx.moveTo(5, -4);
        ctx.lineTo(12, 0);
        ctx.lineTo(5, 4);
        // Arrow pointing left
        ctx.moveTo(-5, -4);
        ctx.lineTo(-12, 0);
        ctx.lineTo(-5, 4);
        ctx.fill();
      } else {
        // Single forward arrow
        ctx.fillStyle = isSelected ? '#00F0FF' : 'rgba(0, 240, 255, 0.95)';
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(8, 0);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.restore();
    });

    // 4. Draw Temporary Lane being created
    if (laneStartVertex !== null && workingGraph.vertices[laneStartVertex]) {
      const startV = workingGraph.vertices[laneStartVertex];
      const pStart = toCanvasPos(startV.x, startV.y);

      ctx.save();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(mouseCanvasPos.x, mouseCanvasPos.y);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Draw Waypoints (Vertices)
    workingGraph.vertices.forEach((v, vIdx) => {
      const p = toCanvasPos(v.x, v.y);
      const isSelected = selectedVertexIndex === vIdx;
      const isHovered = hoveredVertex === vIdx;
      const isLaneSource = laneStartVertex === vIdx;

      ctx.save();

      // Outer Selection Glow
      if (isSelected || isLaneSource) {
        ctx.strokeStyle = isLaneSource ? '#F59E0B' : '#00F0FF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = isLaneSource ? 'rgba(245, 158, 11, 0.25)' : 'rgba(0, 240, 255, 0.25)';
        ctx.fill();
      } else if (isHovered) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Waypoint Type icon/color
      if (v.is_charger) {
        // Charger
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Little lightning icon
        ctx.fillStyle = '#07090E';
        ctx.font = 'bold 8px "Inter"';
        ctx.textAlign = 'center';
        ctx.fillText('⚡', p.x, p.y + 3);
      } else if (v.is_parking_spot || v.is_holding_point) {
        // Parking Spot
        ctx.fillStyle = '#10B981';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#07090E';
        ctx.font = 'bold 8px "Inter"';
        ctx.textAlign = 'center';
        ctx.fillText('P', p.x, p.y + 3);
      } else {
        // Regular Waypoint
        ctx.fillStyle = isSelected ? '#00F0FF' : '#38BDF8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#07090E';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Labels
      if (showLabels && v.name) {
        ctx.font = isSelected ? 'bold 11px "JetBrains Mono"' : '10px "JetBrains Mono"';
        ctx.fillStyle = isSelected ? '#00F0FF' : 'rgba(255, 255, 255, 0.75)';
        ctx.textAlign = 'left';
        ctx.fillText(v.name, p.x + 9, p.y + 3.5);
      }

      ctx.restore();
    });

    ctx.restore();
  }, [
    zoom,
    offset,
    showFloorplan,
    darkFloorplan,
    floorplanImg,
    currentLevel,
    floorplanOpacity,
    meterScale,
    toCanvasPos,
    showWalls,
    workingGraph,
    selectedLaneIndex,
    hoveredLane,
    laneStartVertex,
    mouseCanvasPos,
    selectedVertexIndex,
    hoveredVertex,
    showLabels,
  ]);

  // Animation Loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      render();
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [render]);

  // Selected entities for sidebar inspector
  const currentSelectedVertex =
    selectedVertexIndex !== null ? workingGraph.vertices[selectedVertexIndex] : null;
  const currentSelectedLane =
    selectedLaneIndex !== null ? workingGraph.lanes[selectedLaneIndex] : null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* TOP WORKSPACE TOOLBAR */}
      <div
        style={{
          height: '56px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 20,
          gap: '12px',
          flexShrink: 0,
        }}
      >
        {/* Left: Studio branding & Floor/Graph switchers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.2) 0%, rgba(0, 240, 255, 0.05) 100%)',
                border: '1px solid var(--border-glow)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-cyan)',
              }}
            >
              <Route size={18} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.3px' }}>
                Traffic Graph Editor
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                RMF Waypoints & Lanes Studio
              </div>
            </div>
          </div>

          <div style={{ width: '1px', height: '28px', background: 'var(--border-subtle)' }} />

          {/* Floor Level selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>LEVEL:</span>
            <div style={{ display: 'flex', background: 'var(--bg-surface)', borderRadius: '6px', padding: '2px' }}>
              {buildingMap.levels.map((lvl) => (
                <button
                  key={lvl.name}
                  onClick={() => setSelectedFloor(lvl.name)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: selectedFloor === lvl.name ? 'var(--accent-cyan)' : 'transparent',
                    color: selectedFloor === lvl.name ? '#07090E' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >
                  {lvl.name}
                </button>
              ))}
            </div>
          </div>

          {/* Graph selector */}
          {currentLevel?.nav_graphs && currentLevel.nav_graphs.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>GRAPH:</span>
              <select
                value={selectedGraphIndex}
                onChange={(e) => setSelectedGraphIndex(parseInt(e.target.value, 10))}
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {currentLevel.nav_graphs.map((g, idx) => (
                  <option key={idx} value={idx}>
                    #{idx} {g.name || 'Fleet Graph'}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Center: Interactive Tool Palette */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '3px',
            gap: '2px',
          }}
        >
          {(
            [
              { id: 'select', label: 'Select / Move (V)', icon: <MousePointer size={15} /> },
              { id: 'add-waypoint', label: 'Add Waypoint (W)', icon: <MapPin size={15} /> },
              { id: 'add-lane', label: 'Add Lane (L)', icon: <Route size={15} /> },
              { id: 'toggle-direction', label: 'Toggle Direction (D)', icon: <ArrowLeftRight size={15} /> },
              { id: 'toggle-closure', label: 'Lane Closure (C)', icon: <ShieldAlert size={15} /> },
              { id: 'delete', label: 'Delete Entity (Del)', icon: <Trash2 size={15} /> },
            ] as const
          ).map((t) => {
            const isActive = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTool(t.id);
                  setLaneStartVertex(null);
                }}
                title={t.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isActive ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  transition: 'all 0.15s ease',
                  outline: 'none',
                }}
              >
                {t.icon}
                <span className="editor-tool-label">
                  {t.id === 'select'
                    ? 'Select'
                    : t.id === 'add-waypoint'
                      ? 'Point'
                      : t.id === 'add-lane'
                        ? 'Lane'
                        : t.id === 'toggle-direction'
                          ? 'Direction'
                          : t.id === 'toggle-closure'
                            ? 'Closure'
                            : 'Delete'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: History, Import/Export, Drafts, Save */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Undo / Redo */}
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="btn btn-secondary btn-sm"
              title="Undo (Ctrl+Z)"
              style={{ padding: '6px 8px', opacity: historyIndex <= 0 ? 0.4 : 1 }}
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="btn btn-secondary btn-sm"
              title="Redo (Ctrl+Y)"
              style={{ padding: '6px 8px', opacity: historyIndex >= history.length - 1 ? 0.4 : 1 }}
            >
              <Redo2 size={14} />
            </button>
          </div>

          <div style={{ width: '1px', height: '24px', background: 'var(--border-subtle)' }} />

          {/* Import / Export */}
          <button
            onClick={() => setShowImportModal(true)}
            className="btn btn-secondary btn-sm"
            title="Import YAML / JSON"
            style={{ padding: '6px 10px', fontSize: '12px' }}
          >
            <Upload size={14} />
            Import
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            className="btn btn-secondary btn-sm"
            title="Export YAML / JSON"
            style={{ padding: '6px 10px', fontSize: '12px' }}
          >
            <Download size={14} />
            Export
          </button>

          {/* Drafts Manager */}
          <button
            onClick={() => {
              refreshDraftsList();
              setShowDraftsModal(true);
            }}
            className="btn btn-secondary btn-sm"
            title="Quản lý bản nháp lưu trữ cục bộ (IndexedDB)"
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: savedDraftsCount > 0 ? 'rgba(0, 240, 255, 0.08)' : undefined,
              borderColor: savedDraftsCount > 0 ? 'rgba(0, 240, 255, 0.4)' : undefined,
            }}
          >
            <Database size={14} color="var(--accent-cyan)" />
            <span>Bản nháp</span>
            {savedDraftsCount > 0 && (
              <span
                style={{
                  background: 'var(--accent-cyan)',
                  color: '#07090E',
                  borderRadius: '10px',
                  padding: '1px 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  marginLeft: '2px',
                }}
              >
                {savedDraftsCount}
              </span>
            )}
          </button>

          {/* Save & Deploy to RMF */}
          <button
            onClick={handleSaveChanges}
            disabled={isSaving}
            className="btn btn-primary btn-sm"
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              opacity: isSaving ? 0.8 : 1,
              cursor: isSaving ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: isDirty
                ? 'linear-gradient(135deg, var(--accent-cyan) 0%, #0099FF 100%)'
                : 'linear-gradient(135deg, rgba(0, 240, 255, 0.25) 0%, rgba(0, 153, 255, 0.25) 100%)',
              color: isDirty ? '#07090E' : 'var(--accent-cyan)',
              border: isDirty ? 'none' : '1px solid var(--accent-cyan)',
            }}
            title="Save map, package ZIP with 2D Map & YAML, call POST /building-map and refresh GET /building-map"
          >
            {isSaving ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>{saveStepMessage || 'Saving & Deploying...'}</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>{isDirty ? 'Save Changes' : 'Saved'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* WORKSPACE BODY: Canvas + Floating Panels */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Interactive 2D Canvas */}
        <canvas
          ref={canvasRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={async (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const file = e.dataTransfer.files[0];
              const lower = file.name.toLowerCase();
              if (lower.endsWith('.zip')) {
                await handleProcessZipImport(file);
              } else if (
                file.type.startsWith('image/') ||
                lower.endsWith('.png') ||
                lower.endsWith('.jpg') ||
                lower.endsWith('.jpeg') ||
                lower.endsWith('.svg') ||
                lower.endsWith('.webp')
              ) {
                handleProcessImageImport(file);
              }
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor:
              activeTool === 'add-waypoint'
                ? 'crosshair'
                : activeTool === 'add-lane'
                  ? 'pointer'
                  : activeTool === 'delete'
                    ? 'not-allowed'
                    : isPanning
                      ? 'grabbing'
                      : isDraggingVertex
                        ? 'grabbing'
                        : 'default',
          }}
        />

        {/* Floating Quick Action / View Controls (Top Left) */}
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: 'rgba(13, 18, 29, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: 10,
          }}
        >
          {/* Snap to grid switch */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => setSnapToGrid(e.target.checked)}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
            <span>Snap Grid (0.5m)</span>
          </label>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-subtle)' }} />

          {/* Toggle Labels */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
            <span>Labels</span>
          </label>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-subtle)' }} />

          {/* Toggle Walls */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showWalls}
              onChange={(e) => setShowWalls(e.target.checked)}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
            <span>Walls</span>
          </label>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-subtle)' }} />

          {/* Toggle Floorplan & Opacity */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showFloorplan}
              onChange={(e) => setShowFloorplan(e.target.checked)}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
            <span>Blueprint</span>
          </label>

          {showFloorplan && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={darkFloorplan}
                onChange={(e) => setDarkFloorplan(e.target.checked)}
                style={{ accentColor: 'var(--accent-cyan)' }}
              />
              <span>Dark</span>
            </label>
          )}

          {showFloorplan && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={floorplanOpacity}
                onChange={(e) => setFloorplanOpacity(parseFloat(e.target.value))}
                style={{ width: '65px', accentColor: 'var(--accent-cyan)' }}
              />
            </div>
          )}
        </div>

        {/* Active Tool Instruction Banner */}
        {!detectedDraftBanner && (
          <div
            style={{
              position: 'absolute',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(13, 18, 29, 0.9)',
              backdropFilter: 'blur(12px)',
              border: '1px solid var(--border-glow)',
              borderRadius: '20px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--accent-cyan)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <Compass size={14} />
            {activeTool === 'select' && 'Click waypoint to edit/drag, or lane to configure properties.'}
            {activeTool === 'add-waypoint' && 'Click anywhere on map to drop a new Waypoint.'}
            {activeTool === 'add-lane' &&
              (laneStartVertex === null
                ? 'Click the FIRST Waypoint to start lane.'
                : `Click the SECOND Waypoint to connect from WP_${laneStartVertex}.`)}
            {activeTool === 'toggle-direction' && 'Click any lane to cycle: Two-way ⇄ / One-way ➔ / Reverse.'}
            {activeTool === 'toggle-closure' && 'Click any lane to toggle Closed (Maintenance) / Open status.'}
            {activeTool === 'delete' && 'Click any waypoint or lane to permanently delete.'}
          </div>
        )}

        {/* Floating Zoom & Map Controls (Top Right) */}
        <div
          style={{
            position: 'absolute',
            top: '16px',
            right: currentSelectedVertex || currentSelectedLane ? '340px' : '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 10,
            transition: 'right 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(13, 18, 29, 0.85)',
              backdropFilter: 'blur(12px)',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setZoom((z) => Math.min(4.5, z * 1.2))}
              className="btn btn-secondary"
              title="Zoom In"
              style={{ borderRadius: 0, padding: '8px', border: 'none' }}
            >
              <ZoomIn size={16} />
            </button>
            <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
            <button
              onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
              className="btn btn-secondary"
              title="Zoom Out"
              style={{ borderRadius: 0, padding: '8px', border: 'none' }}
            >
              <ZoomOut size={16} />
            </button>
            <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
            <button
              onClick={handleResetView}
              className="btn btn-secondary"
              title="Fit View"
              style={{ borderRadius: 0, padding: '8px', border: 'none' }}
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </div>

        {/* Floating Detected Draft Banner */}
        {detectedDraftBanner && (
          <div
            style={{
              position: 'absolute',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(13, 18, 29, 0.95)',
              border: '1px solid var(--accent-cyan)',
              boxShadow: '0 8px 30px rgba(0, 240, 255, 0.3)',
              borderRadius: '10px',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '12px',
              zIndex: 35,
              backdropFilter: 'blur(10px)',
            }}
          >
            <Clock size={16} color="var(--accent-cyan)" />
            <span style={{ color: '#FFFFFF' }}>
              Tìm thấy bản nháp chưa lưu: <strong>{detectedDraftBanner.buildingName} - {detectedDraftBanner.levelName}</strong> ({detectedDraftBanner.waypointsCount} điểm, {detectedDraftBanner.lanesCount} đường)
            </span>
            <button
              onClick={() => handleRestoreDraft(detectedDraftBanner)}
              className="btn btn-primary btn-sm"
              style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>Khôi phục</span>
            </button>
            <button
              onClick={() => setDetectedDraftBanner(null)}
              className="btn btn-secondary btn-sm"
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              Bỏ qua
            </button>
          </div>
        )}

        {/* Live Coordinate Status Indicator (Bottom Left) */}
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            background: 'rgba(13, 18, 29, 0.85)',
            backdropFilter: 'blur(8px)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            pointerEvents: 'none',
            display: 'flex',
            gap: '14px',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <span>
            {coordSys.isPixelMode ? (
              <>
                Cursor Pixel: <strong style={{ color: '#00F0FF' }}>X: {Math.round(mouseMetricPos.x)}px, Y: {Math.round(-mouseMetricPos.y)}px</strong>
                {' '}<span style={{ opacity: 0.65 }}>(~{(mouseMetricPos.x * 0.05).toFixed(1)}m, {(-mouseMetricPos.y * 0.05).toFixed(1)}m)</span>
              </>
            ) : (
              <>
                Cursor Metric: <strong style={{ color: '#00F0FF' }}>X: {mouseMetricPos.x}m, Y: {mouseMetricPos.y}m</strong>
              </>
            )}
          </span>
          <span>
            Zoom: <strong>{Math.round(zoom * 100)}%</strong>
          </span>
          <span>
            Waypoints: <strong>{workingGraph.vertices.length}</strong>
          </span>
          <span>
            Lanes: <strong>{workingGraph.lanes.length}</strong>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#10B981',
                boxShadow: '0 0 6px #10B981',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#10B981' }}>
              {lastAutoSavedTime ? `Đã lưu nháp: ${lastAutoSavedTime}` : 'Tự động lưu nháp: Sẵn sàng'}
            </span>
          </span>
        </div>

        {/* RIGHT PROPERTIES INSPECTOR DRAWER */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '320px',
            background: 'rgba(13, 18, 29, 0.95)',
            backdropFilter: 'blur(16px)',
            borderLeft: '1px solid var(--border-subtle)',
            zIndex: 15,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: '16px',
            gap: '16px',
            boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
          }}
        >
          {/* Case 1: Waypoint Selected */}
          {currentSelectedVertex && selectedVertexIndex !== null && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: 'rgba(0, 240, 255, 0.15)',
                      border: '1px solid var(--accent-cyan)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-cyan)',
                    }}
                  >
                    <MapPin size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>Waypoint Properties</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Index: #{selectedVertexIndex}</div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedVertexIndex(null)}
                  className="btn btn-secondary"
                  style={{ padding: '4px', borderRadius: '4px' }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Waypoint Name */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  WAYPOINT NAME / LABEL
                </label>
                <input
                  type="text"
                  value={currentSelectedVertex.name || ''}
                  onChange={(e) => {
                    const nextV = [...workingGraph.vertices];
                    nextV[selectedVertexIndex] = { ...currentSelectedVertex, name: e.target.value };
                    commitWorkingGraph({ ...workingGraph, vertices: nextV });
                  }}
                  placeholder="e.g. charger_01, pickup_A"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Metric Coordinates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>X Coordinate (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={currentSelectedVertex.x}
                    onChange={(e) => {
                      const nextV = [...workingGraph.vertices];
                      nextV[selectedVertexIndex] = {
                        ...currentSelectedVertex,
                        x: parseFloat(e.target.value) || 0,
                      };
                      commitWorkingGraph({ ...workingGraph, vertices: nextV });
                    }}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      color: 'var(--accent-cyan)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Y Coordinate (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={currentSelectedVertex.y}
                    onChange={(e) => {
                      const nextV = [...workingGraph.vertices];
                      nextV[selectedVertexIndex] = {
                        ...currentSelectedVertex,
                        y: parseFloat(e.target.value) || 0,
                      };
                      commitWorkingGraph({ ...workingGraph, vertices: nextV });
                    }}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      color: 'var(--accent-cyan)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Waypoint Special Roles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  STATION & ROLE FLAGS
                </label>

                {/* Charger */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: currentSelectedVertex.is_charger ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-surface)',
                    border: `1px solid ${currentSelectedVertex.is_charger ? '#F59E0B' : 'var(--border-subtle)'}`,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(currentSelectedVertex.is_charger)}
                    onChange={(e) => {
                      const nextV = [...workingGraph.vertices];
                      nextV[selectedVertexIndex] = { ...currentSelectedVertex, is_charger: e.target.checked };
                      commitWorkingGraph({ ...workingGraph, vertices: nextV });
                    }}
                    style={{ accentColor: '#F59E0B' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Zap size={14} color="#F59E0B" />
                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#FFFFFF' }}>Charging Station</span>
                  </div>
                </label>

                {/* Parking Spot */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: currentSelectedVertex.is_parking_spot ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-surface)',
                    border: `1px solid ${currentSelectedVertex.is_parking_spot ? '#10B981' : 'var(--border-subtle)'}`,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(currentSelectedVertex.is_parking_spot)}
                    onChange={(e) => {
                      const nextV = [...workingGraph.vertices];
                      nextV[selectedVertexIndex] = { ...currentSelectedVertex, is_parking_spot: e.target.checked };
                      commitWorkingGraph({ ...workingGraph, vertices: nextV });
                    }}
                    style={{ accentColor: '#10B981' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ParkingSquare size={14} color="#10B981" />
                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#FFFFFF' }}>Parking / Standby Spot</span>
                  </div>
                </label>
              </div>

              {/* Delete Waypoint Button */}
              <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                <button
                  onClick={() => deleteVertex(selectedVertexIndex)}
                  className="btn btn-danger"
                  style={{ width: '100%', padding: '10px', fontSize: '12px' }}
                >
                  <Trash2 size={14} />
                  Delete Waypoint
                </button>
              </div>
            </>
          )}

          {/* Case 2: Lane Selected */}
          {currentSelectedLane && selectedLaneIndex !== null && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: 'rgba(0, 240, 255, 0.15)',
                      border: '1px solid var(--accent-cyan)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-cyan)',
                    }}
                  >
                    <Route size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>Lane Properties</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Index: #{selectedLaneIndex}</div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLaneIndex(null)}
                  className="btn btn-secondary"
                  style={{ padding: '4px', borderRadius: '4px' }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Endpoints */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>FROM (ENTRY)</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    {workingGraph.vertices[currentSelectedLane.entry]?.name || `WP_${currentSelectedLane.entry}`}
                  </div>
                </div>
                <ArrowLeftRight size={16} color="var(--text-muted)" />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TO (EXIT)</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    {workingGraph.vertices[currentSelectedLane.exit]?.name || `WP_${currentSelectedLane.exit}`}
                  </div>
                </div>
              </div>

              {/* Traffic Direction Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  TRAFFIC FLOW DIRECTION
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    onClick={() => {
                      const nextL = [...workingGraph.lanes];
                      nextL[selectedLaneIndex] = { ...currentSelectedLane, two_way: true };
                      commitWorkingGraph({ ...workingGraph, lanes: nextL });
                    }}
                    style={{
                      padding: '8px',
                      borderRadius: '6px',
                      border: currentSelectedLane.two_way ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                      background: currentSelectedLane.two_way ? 'rgba(0, 240, 255, 0.15)' : 'var(--bg-surface)',
                      color: currentSelectedLane.two_way ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ⇄ Two-Way
                  </button>
                  <button
                    onClick={() => {
                      const nextL = [...workingGraph.lanes];
                      nextL[selectedLaneIndex] = { ...currentSelectedLane, two_way: false };
                      commitWorkingGraph({ ...workingGraph, lanes: nextL });
                    }}
                    style={{
                      padding: '8px',
                      borderRadius: '6px',
                      border: !currentSelectedLane.two_way ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                      background: !currentSelectedLane.two_way ? 'rgba(0, 240, 255, 0.15)' : 'var(--bg-surface)',
                      color: !currentSelectedLane.two_way ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ➔ One-Way
                  </button>
                </div>
              </div>

              {/* Lane Closure Status */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  OPERATIONAL DISPATCH STATUS
                </label>
                <button
                  onClick={() => toggleLaneClosure(selectedLaneIndex)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '10px',
                    borderRadius: '8px',
                    border: currentSelectedLane.is_closed ? '1px solid #EF4444' : '1px solid #10B981',
                    background: currentSelectedLane.is_closed ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: currentSelectedLane.is_closed ? '#F87171' : '#34D399',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <ShieldAlert size={16} />
                  {currentSelectedLane.is_closed ? 'LANE IS CLOSED (Blocked)' : 'LANE IS OPEN (Active)'}
                </button>
              </div>

              {/* Speed Limit */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  SPEED LIMIT (m/s)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="3.0"
                  value={currentSelectedLane.speed_limit || 1.2}
                  onChange={(e) => {
                    const nextL = [...workingGraph.lanes];
                    nextL[selectedLaneIndex] = {
                      ...currentSelectedLane,
                      speed_limit: parseFloat(e.target.value) || 1.2,
                    };
                    commitWorkingGraph({ ...workingGraph, lanes: nextL });
                  }}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Delete Lane Button */}
              <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                <button
                  onClick={() => deleteLane(selectedLaneIndex)}
                  className="btn btn-danger"
                  style={{ width: '100%', padding: '10px', fontSize: '12px' }}
                >
                  <Trash2 size={14} />
                  Delete Lane
                </button>
              </div>
            </>
          )}

          {/* Case 3: Nothing Selected -> Overview Statistics & Quick Guide */}
          {!currentSelectedVertex && !currentSelectedLane && (
            <>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>Traffic Overview</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Level {selectedFloor} • Graph #{selectedGraphIndex}
                </div>
              </div>

              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TOTAL WAYPOINTS</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                    {workingGraph.vertices.length}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TOTAL LANES</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
                    {workingGraph.lanes.length}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>CHARGING DOCKS</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#F59E0B', fontFamily: 'var(--font-mono)' }}>
                    {workingGraph.vertices.filter((v) => v.is_charger).length}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>CLOSED LANES</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#EF4444', fontFamily: 'var(--font-mono)' }}>
                    {workingGraph.lanes.filter((l) => l.is_closed).length}
                  </div>
                </div>
              </div>

              {/* Reset to Default */}
              <div style={{ background: 'var(--bg-surface)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  RESET MAP CONFIG
                </div>
                <button
                  onClick={() => {
                    if (window.confirm('Reset this map to default original configuration? Any unsaved custom edits will be reverted.')) {
                      resetBuildingMap();
                      showToast('Map reset to initial blueprint');
                    }
                  }}
                  className="btn btn-secondary"
                  style={{ width: '100%', padding: '8px', fontSize: '11px', color: 'var(--text-muted)' }}
                >
                  <RotateCcw size={12} />
                  Restore Default Building Graph
                </button>
              </div>

              {/* Keyboard Shortcuts Cheatsheet */}
              <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Shortcuts
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Select / Move tool:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>V</kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Add Waypoint:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>W</kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Add Lane:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>L</kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Toggle Direction:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>D</kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Lane Closure:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>C</kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Delete Selected:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>Del</kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Save Changes:</span> <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>Ctrl+S</kbd>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* FLOATING TOAST NOTIFICATION */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(13, 18, 29, 0.95)',
            border: '1px solid var(--accent-cyan)',
            boxShadow: '0 8px 32px rgba(0, 240, 255, 0.3)',
            padding: '10px 24px',
            borderRadius: '24px',
            color: '#FFFFFF',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 50,
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          <span>{toastMessage}</span>
        </div>
      )}

      {/* EXPORT MODAL */}
      {showExportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '560px',
              maxHeight: '85vh',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glow)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-card)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF' }}>
                Export Open-RMF Traffic Graph
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="btn btn-secondary"
                style={{ padding: '6px' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '8px' }}>
                <button
                  onClick={() => setExportFormat('building-yaml')}
                  className={`btn ${exportFormat === 'building-yaml' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 10px', fontSize: '11px', whiteSpace: 'nowrap' }}
                  title="Full standard Open-RMF file (with coordinate_system, drawing, [type, value] encoding)"
                >
                  ★ Open-RMF .building.yaml
                </button>
                <button
                  onClick={() => setExportFormat('nav-yaml')}
                  className={`btn ${exportFormat === 'nav-yaml' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 10px', fontSize: '11px', whiteSpace: 'nowrap' }}
                >
                  NavGraph Snippet
                </button>
                <button
                  onClick={() => setExportFormat('json')}
                  className={`btn ${exportFormat === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 10px', fontSize: '11px', whiteSpace: 'nowrap' }}
                >
                  FMS JSON
                </button>
              </div>

              {/* {exportFormat === 'building-yaml' && (
                <div style={{ fontSize: '11px', color: '#10B981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>✓ 100% chuẩn Open-RMF traffic_editor (sử dụng parameter encoding `[type_id, value]`)</span>
                </div>
              )} */}

              <textarea
                readOnly
                value={
                  exportFormat === 'building-yaml'
                    ? exportStandardBuildingYaml(buildingMap, selectedFloor, workingGraph, selectedGraphIndex)
                    : exportFormat === 'nav-yaml'
                      ? exportNavGraphToYaml(workingGraph, selectedFloor, selectedGraphIndex)
                      : JSON.stringify(workingGraph, null, 2)
                }
                style={{
                  width: '100%',
                  height: '320px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  color: 'var(--accent-cyan)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  padding: '12px',
                  resize: 'none',
                  outline: 'none',
                }}
              />
            </div>

            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              <button
                onClick={() => {
                  const content =
                    exportFormat === 'building-yaml'
                      ? exportStandardBuildingYaml(buildingMap, selectedFloor, workingGraph, selectedGraphIndex)
                      : exportFormat === 'nav-yaml'
                        ? exportNavGraphToYaml(workingGraph, selectedFloor, selectedGraphIndex)
                        : JSON.stringify(workingGraph, null, 2);
                  navigator.clipboard.writeText(content);
                  showToast('Copied content to clipboard!');
                }}
                className="btn btn-secondary"
              >
                <Copy size={14} />
                Copy
              </button>
              <button
                onClick={() => {
                  const content =
                    exportFormat === 'building-yaml'
                      ? exportStandardBuildingYaml(buildingMap, selectedFloor, workingGraph, selectedGraphIndex)
                      : exportFormat === 'nav-yaml'
                        ? exportNavGraphToYaml(workingGraph, selectedFloor, selectedGraphIndex)
                        : JSON.stringify(workingGraph, null, 2);
                  const filename =
                    exportFormat === 'building-yaml'
                      ? `${buildingMap.name || 'map'}.building.yaml`
                      : exportFormat === 'nav-yaml'
                        ? `${workingGraph.name || 'graph'}_${selectedFloor}.yaml`
                        : `${workingGraph.name || 'graph'}_${selectedFloor}.json`;
                  triggerFileDownload(content, filename);
                  showToast(`Downloaded ${filename}`);
                }}
                className="btn btn-primary"
              >
                <Download size={14} />
                Download File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT MODAL */}
      {showImportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '600px',
              maxHeight: '90vh',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glow)',
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 240, 255, 0.15)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Upload size={18} color="var(--accent-cyan)" />
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF' }}>
                  Import 2D Map & Traffic Graph
                </div>
              </div>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedImageFile(null);
                  setImagePreviewUrl(null);
                }}
                className="btn btn-secondary"
                style={{ padding: '6px' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                padding: '0 12px',
                gap: '4px',
              }}
            >
              <button
                onClick={() => setImportTab('image')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: importTab === 'image' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  color: importTab === 'image' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <ImageIcon size={14} />
                2D Map Image (Upload)
              </button>
              <button
                onClick={() => setImportTab('zip')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: importTab === 'zip' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  color: importTab === 'zip' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <FolderArchive size={14} />
                Map Package (.zip)
              </button>
              <button
                onClick={() => setImportTab('yaml')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: importTab === 'yaml' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  color: importTab === 'yaml' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <FileCode size={14} />
                YAML / JSON Text
              </button>
            </div>

            {/* Tab Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
              {/* TAB 1: 2D MAP IMAGE */}
              {importTab === 'image' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Mode Selector: New Map vs Edit Current */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setImportPurpose('new-map');
                        setImportClearExisting(true);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: importPurpose === 'new-map' ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                        background: importPurpose === 'new-map' ? 'rgba(0, 240, 255, 0.12)' : 'var(--bg-surface)',
                        color: importPurpose === 'new-map' ? '#FFFFFF' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12px', color: importPurpose === 'new-map' ? 'var(--accent-cyan)' : '#FFFFFF' }}>
                        <FilePlus size={15} />
                        <span>🆕 Tạo bản đồ mới (New Map)</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                        Khởi tạo dự án bản đồ mới. Xóa sạch tọa độ cũ và bắt đầu từ đầu.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setImportPurpose('edit-current');
                        setImportClearExisting(false);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: importPurpose === 'edit-current' ? '2px solid var(--accent-emerald)' : '1px solid var(--border-subtle)',
                        background: importPurpose === 'edit-current' ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-surface)',
                        color: importPurpose === 'edit-current' ? '#FFFFFF' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12px', color: importPurpose === 'edit-current' ? 'var(--accent-emerald)' : '#FFFFFF' }}>
                        <Layers size={15} />
                        <span>🛠️ Cập nhật bản đồ hiện tại</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                        Thay ảnh nền CAD mới (giữ nguyên waypoints) hoặc thêm tầng mới.
                      </div>
                    </button>
                  </div>

                  {/* Context notice when New Map is selected but current has points */}
                  {importPurpose === 'new-map' && workingGraph.vertices.length > 0 && (
                    <div
                      style={{
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '11.5px',
                        color: '#FCD34D',
                      }}
                    >
                      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <strong>Lưu ý:</strong> Bản đồ hiện tại đang có <strong>{workingGraph.vertices.length} waypoints</strong>. Khi tạo bản đồ mới, hệ thống sẽ tự động lưu bản nháp của <em>"{buildingMap.name || 'Building'}"</em> vào IndexedDB để bạn không bị mất dữ liệu!
                      </div>
                    </div>
                  )}

                  {/* Context options when Edit Current is selected */}
                  {importPurpose === 'edit-current' && (
                    <div
                      style={{
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: '8px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Đang sửa: {buildingMap.name || 'Building'} • Tầng {selectedFloor}</span>
                        <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>
                          ({workingGraph.vertices.length} waypoints, {workingGraph.lanes.length} lanes)
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '11.5px', color: '#FFFFFF', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="editAction"
                            checked={editAction === 'replace-image'}
                            onChange={() => setEditAction('replace-image')}
                            style={{ accentColor: 'var(--accent-emerald)', marginTop: '2px' }}
                          />
                          <div>
                            <strong>🖼️ Thay ảnh nền 2D</strong> (Khuyên dùng: giữ nguyên 100% tọa độ các waypoints & lanes đã vẽ)
                            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                              Thích hợp khi bản vẽ kiến trúc CAD cập nhật bổ sung vách ngăn/phòng mới.
                            </div>
                          </div>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '11.5px', color: '#FFFFFF', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="editAction"
                            checked={editAction === 'add-level'}
                            onChange={() => setEditAction('add-level')}
                            style={{ accentColor: 'var(--accent-emerald)', marginTop: '2px' }}
                          />
                          <div>
                            <strong>🏢 Thêm tầng mới vào tòa nhà</strong> (ví dụ: L2, L3, Hầm B1)
                            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                              Giữ nguyên tầng {selectedFloor}, nạp ảnh này thành tầng mới trong cùng tòa nhà.
                            </div>
                          </div>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '11.5px', color: '#FFFFFF', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="editAction"
                            checked={editAction === 'overwrite-level'}
                            onChange={() => setEditAction('overwrite-level')}
                            style={{ accentColor: 'var(--accent-emerald)', marginTop: '2px' }}
                          />
                          <div>
                            <strong>🔄 Ghi đè toàn bộ tầng hiện tại</strong>
                            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                              Thay thế ảnh và xóa sạch đồ thị của tầng {selectedFloor}.
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Dropzone */}
                  {!selectedImageFile && (
                    <label
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px dashed rgba(0, 240, 255, 0.35)',
                        background: 'rgba(0, 240, 255, 0.03)',
                        borderRadius: '10px',
                        padding: '30px 20px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          const file = e.dataTransfer.files[0];
                          if (file.type.startsWith('image/')) {
                            setSelectedImageFile(file);
                            const url = URL.createObjectURL(file);
                            setImagePreviewUrl(url);
                            const img = new Image();
                            img.onload = () => setImagePreviewDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                            img.src = url;
                          }
                        }
                      }}
                    >
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            const file = e.target.files[0];
                            setSelectedImageFile(file);
                            const url = URL.createObjectURL(file);
                            setImagePreviewUrl(url);
                            const img = new Image();
                            img.onload = () => setImagePreviewDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                            img.src = url;
                          }
                        }}
                      />
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '50%',
                          background: 'rgba(0, 240, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--accent-cyan)',
                          marginBottom: '10px',
                        }}
                      >
                        <ImageIcon size={24} />
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                        Click to select 2D Map Image, or drag & drop here
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Supported formats: PNG, JPG, JPEG, SVG, WebP
                      </div>
                    </label>
                  )}

                  {/* Selected Image Preview & Configuration */}
                  {selectedImageFile && imagePreviewUrl && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '14px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                        <img
                          src={imagePreviewUrl}
                          alt="Preview"
                          style={{
                            width: '120px',
                            height: '80px',
                            objectFit: 'contain',
                            background: '#04060A',
                            borderRadius: '6px',
                            border: '1px solid var(--border-subtle)',
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '13px',
                              fontWeight: 700,
                              color: '#FFFFFF',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {selectedImageFile.name}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                            {imagePreviewDimensions
                              ? `${imagePreviewDimensions.width} × ${imagePreviewDimensions.height} px`
                              : 'Loading dimensions...'}
                            {' • '}
                            {(selectedImageFile.size / 1024).toFixed(1)} KB
                          </div>
                          <button
                            onClick={() => {
                              setSelectedImageFile(null);
                              setImagePreviewUrl(null);
                              setImagePreviewDimensions(null);
                            }}
                            className="btn btn-secondary btn-sm"
                            style={{ marginTop: '8px', padding: '4px 8px', fontSize: '11px' }}
                          >
                            Choose Different Image
                          </button>
                        </div>
                      </div>

                      {/* Map Settings */}
                      {importPurpose === 'new-map' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                              TÊN TÒA NHÀ MỚI (BUILDING NAME)
                            </label>
                            <input
                              type="text"
                              value={importBuildingName}
                              onChange={(e) => setImportBuildingName(e.target.value)}
                              placeholder="e.g. warehouse_vntt"
                              style={{
                                width: '100%',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '6px',
                                padding: '6px 10px',
                                color: '#FFFFFF',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                              TÊN TẦNG (LEVEL / FLOOR)
                            </label>
                            <input
                              type="text"
                              value={importFloorName}
                              onChange={(e) => setImportFloorName(e.target.value)}
                              placeholder="e.g. L1"
                              style={{
                                width: '100%',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '6px',
                                padding: '6px 10px',
                                color: '#FFFFFF',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {importPurpose === 'edit-current' && editAction === 'add-level' && (
                        <div>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                            TÊN TẦNG MỚI ĐƯỢC THÊM (NEW LEVEL NAME)
                          </label>
                          <input
                            type="text"
                            value={importFloorName}
                            onChange={(e) => setImportFloorName(e.target.value)}
                            placeholder={`e.g. L${buildingMap.levels.length + 1}`}
                            style={{
                              width: '100%',
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '6px',
                              padding: '6px 10px',
                              color: '#FFFFFF',
                              fontSize: '12px',
                              outline: 'none',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: MAP PACKAGE (.ZIP) */}
              {importTab === 'zip' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    Upload an Open-RMF map archive (.zip) containing the 2D map image and `.building.yaml`.
                    Both the floorplan image and all existing waypoints/lanes will be loaded automatically.
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px dashed rgba(16, 185, 129, 0.35)',
                      background: 'rgba(16, 185, 129, 0.03)',
                      borderRadius: '10px',
                      padding: '32px 20px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <input
                      type="file"
                      accept=".zip"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          setSelectedZipFile(e.target.files[0]);
                        }
                      }}
                    />
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'rgba(16, 185, 129, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-emerald)',
                        marginBottom: '10px',
                      }}
                    >
                      <FolderArchive size={24} />
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                      {selectedZipFile ? selectedZipFile.name : 'Select or drop .zip Map Package'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {selectedZipFile
                        ? `${(selectedZipFile.size / 1024).toFixed(1)} KB ready to extract`
                        : 'Must contain 2D Map image (.png) and Open-RMF (.building.yaml)'}
                    </div>
                  </label>
                </div>
              )}

              {/* TAB 3: YAML / JSON TEXT */}
              {importTab === 'yaml' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Paste your Open-RMF `.building.yaml` snippet or JSON NavGraph definition:
                  </div>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Paste YAML or JSON here..."
                    style={{
                      width: '100%',
                      height: '240px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      padding: '12px',
                      resize: 'none',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedImageFile(null);
                  setImagePreviewUrl(null);
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>

              {importTab === 'image' && (
                <button
                  disabled={!selectedImageFile}
                  onClick={() => {
                    if (selectedImageFile) {
                      handleProcessImageImport(selectedImageFile);
                    }
                  }}
                  className="btn btn-primary"
                  style={{ opacity: selectedImageFile ? 1 : 0.5, cursor: selectedImageFile ? 'pointer' : 'default' }}
                >
                  <ImageIcon size={14} />
                  Load 2D Map into Editor
                </button>
              )}

              {importTab === 'zip' && (
                <button
                  disabled={!selectedZipFile || isUnzipping}
                  onClick={() => {
                    if (selectedZipFile) {
                      handleProcessZipImport(selectedZipFile);
                    }
                  }}
                  className="btn btn-primary"
                  style={{ opacity: selectedZipFile ? 1 : 0.5, cursor: selectedZipFile ? 'pointer' : 'default' }}
                >
                  {isUnzipping ? (
                    <>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <FolderArchive size={14} />
                      Extract & Load Map
                    </>
                  )}
                </button>
              )}

              {importTab === 'yaml' && (
                <button
                  onClick={() => {
                    if (!importText.trim()) return;
                    const parsed = parseNavGraphContent(importText);
                    if (parsed && parsed.vertices && parsed.vertices.length > 0) {
                      const newGraph: NavGraph = {
                        name: parsed.name || workingGraph.name || 'imported',
                        vertices: parsed.vertices as MapVertex[],
                        lanes: (parsed.lanes || []) as MapLane[],
                      };
                      commitWorkingGraph(newGraph);
                      setShowImportModal(false);
                      setImportText('');
                      showToast(`Successfully imported ${newGraph.vertices.length} waypoints and ${newGraph.lanes.length} lanes!`);
                    } else {
                      alert('Invalid format. Please verify valid YAML vertices/lanes or JSON NavGraph format.');
                    }
                  }}
                  className="btn btn-primary"
                >
                  Import and Load
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DRAFTS MANAGER MODAL (IndexedDB Local Storage) */}
      {showDraftsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 105,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '640px',
              maxHeight: '85vh',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glow)',
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 240, 255, 0.15)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'linear-gradient(180deg, rgba(0, 240, 255, 0.05) 0%, transparent 100%)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={18} color="var(--accent-cyan)" />
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF' }}>
                    Quản lý Bản nháp Cục bộ (IndexedDB Local Drafts)
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Tiến trình được tự động lưu bền vững trong trình duyệt. Không mất khi F5 hoặc tắt tab.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowDraftsModal(false)}
                className="btn btn-secondary"
                style={{ padding: '6px' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Drafts List Body */}
            <div
              style={{
                padding: '20px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: '480px',
              }}
            >
              {draftsList.length === 0 ? (
                <div
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Archive size={24} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                    Chưa có bản nháp nào được lưu
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '320px' }}>
                    Khi bạn thêm điểm hoặc nối đường trên canvas, hệ thống sẽ tự động lưu tiến trình vào IndexedDB tại đây.
                  </div>
                </div>
              ) : (
                draftsList.map((draft) => {
                  const dateStr = new Date(draft.updatedAt).toLocaleString('vi-VN');
                  const isCurrentEditing =
                    draft.buildingName === (buildingMap.name || 'Building') &&
                    draft.levelName === selectedFloor;

                  return (
                    <div
                      key={draft.id}
                      style={{
                        background: isCurrentEditing ? 'rgba(0, 240, 255, 0.05)' : 'var(--bg-surface)',
                        border: isCurrentEditing
                          ? '1px solid rgba(0, 240, 255, 0.4)'
                          : '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '14px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Left: Thumbnail + Metadata */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        {draft.imageDataUrl ? (
                          <img
                            src={draft.imageDataUrl}
                            alt="Map thumbnail"
                            style={{
                              width: '54px',
                              height: '40px',
                              objectFit: 'cover',
                              borderRadius: '6px',
                              background: '#04060A',
                              border: '1px solid var(--border-subtle)',
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '54px',
                              height: '40px',
                              borderRadius: '6px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--text-muted)',
                              flexShrink: 0,
                            }}
                          >
                            <ImageIcon size={18} />
                          </div>
                        )}

                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
                              {draft.buildingName}
                            </span>
                            <span
                              style={{
                                background: 'rgba(0, 240, 255, 0.15)',
                                color: 'var(--accent-cyan)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 600,
                              }}
                            >
                              Tầng {draft.levelName}
                            </span>
                            {isCurrentEditing && (
                              <span
                                style={{
                                  background: 'rgba(16, 185, 129, 0.15)',
                                  color: '#34D399',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                }}
                              >
                                Đang mở
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-muted)',
                              marginTop: '3px',
                              display: 'flex',
                              gap: '10px',
                              alignItems: 'center',
                            }}
                          >
                            <span>
                              <strong style={{ color: 'var(--text-secondary)' }}>{draft.waypointsCount}</strong> waypoints
                            </span>
                            <span>•</span>
                            <span>
                              <strong style={{ color: 'var(--text-secondary)' }}>{draft.lanesCount}</strong> lanes
                            </span>
                            <span>•</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Clock size={11} />
                              {dateStr}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => handleRestoreDraft(draft)}
                          className="btn btn-primary btn-sm"
                          style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <RefreshCw size={12} />
                          Mở bản nháp
                        </button>
                        <button
                          onClick={() => handleDeleteDraft(draft.id)}
                          className="btn btn-secondary btn-sm"
                          title="Xóa bản nháp này"
                          style={{ padding: '6px 8px', color: '#EF4444' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {draftsList.length > 0 ? (
                <button
                  onClick={handleClearAllDrafts}
                  className="btn btn-secondary btn-sm"
                  style={{ color: '#EF4444', fontSize: '11px' }}
                >
                  <Trash2 size={12} />
                  Xóa tất cả bản nháp
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={() => setShowDraftsModal(false)}
                className="btn btn-secondary"
                style={{ fontSize: '12px' }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAVE & DEPLOY SUCCESS MODAL */}
      {showSaveSuccessModal && deployedMapSummary && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(10px)',
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '560px',
              background: 'var(--bg-secondary)',
              border: '1px solid rgba(0, 240, 255, 0.5)',
              borderRadius: '16px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 240, 255, 0.25)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              animation: 'fadeIn 0.2s ease-out',
            }}
          >
            {/* Header Banner */}
            <div
              style={{
                padding: '24px 24px 16px',
                background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.15) 0%, transparent 100%)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid #10B981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10B981',
                  flexShrink: 0,
                }}
              >
                <CheckCircle2 size={24} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '0.3px' }}>
                  Map Saved & Deployed to Open-RMF!
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  ZIP package uploaded and live building map synchronized successfully.
                </div>
              </div>
              <button
                onClick={() => setShowSaveSuccessModal(false)}
                className="btn btn-secondary"
                style={{ padding: '6px' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* API Pipeline Checklist */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Execution Pipeline
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: '#10B981' }}>✓</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: '#FFFFFF' }}>POST /building-map:</strong> Uploaded ZIP (2D Map Image + YAML)
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#10B981', fontFamily: 'var(--font-mono)' }}>
                    {deployedMapSummary.uploadStatus}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: '#10B981' }}>✓</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: '#FFFFFF' }}>GET /building-map:</strong> Refreshed verified building map
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#10B981', fontFamily: 'var(--font-mono)' }}>
                    {deployedMapSummary.refreshStatus}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: '#00F0FF' }}>✓</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: '#FFFFFF' }}>Digital Twin Map:</strong> Updated and ready for inspection
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#00F0FF', fontFamily: 'var(--font-mono)' }}>
                    Ready
                  </span>
                </div>
              </div>

              {/* Map Summary Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>BUILDING / LEVEL</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {deployedMapSummary.buildingName} • {deployedMapSummary.levelName}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>WAYPOINTS</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                    {deployedMapSummary.waypointsCount}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>LANES</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
                    {deployedMapSummary.lanesCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div
              style={{
                padding: '14px 24px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {lastSavedZipBlob ? (
                <button
                  onClick={() => {
                    triggerBlobDownload(lastSavedZipBlob, lastSavedZipFilename || 'building_map.zip');
                    showToast(`Downloaded ${lastSavedZipFilename}`);
                  }}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                >
                  <Download size={14} />
                  Download .zip
                </button>
              ) : (
                <div />
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={() => setShowSaveSuccessModal(false)}
                  className="btn btn-secondary"
                  style={{ fontSize: '12px' }}
                >
                  Keep Editing
                </button>
                <button
                  onClick={() => {
                    setShowSaveSuccessModal(false);
                    setActiveTab('map');
                    navigate('/map');
                  }}
                  className="btn btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 700,
                    boxShadow: '0 4px 16px rgba(0, 240, 255, 0.4)',
                  }}
                >
                  <span>View in Digital Twin Map</span>
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
