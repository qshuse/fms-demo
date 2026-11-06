import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  SlidersHorizontal,
  Navigation,
} from 'lucide-react';
import { MapLayerConfig } from '../../types/fms';

interface MapControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  layers: MapLayerConfig;
  onToggleLayer: (layer: keyof MapLayerConfig) => void;
  floors: string[];
  activeFloor: string;
  onSelectFloor: (floor: string) => void;
  followingRobot: string | null;
  onCancelFollow: () => void;
}

export const MapControls: React.FC<MapControlsProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  layers,
  onToggleLayer,
  floors,
  activeFloor,
  onSelectFloor,
  followingRobot,
  onCancelFollow,
}) => {
  const [showLayerMenu, setShowLayerMenu] = React.useState(false);

  return (
    <>
      {/* Floor Level Switcher HUD */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(13, 18, 29, 0.85)',
          backdropFilter: 'blur(12px)',
          padding: '4px',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)',
          zIndex: 10,
        }}
      >
        {floors.map((floor) => {
          const isActive = floor === activeFloor;
          return (
            <button
              key={floor}
              onClick={() => onSelectFloor(floor)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: isActive ? 'var(--accent-cyan)' : 'transparent',
                color: isActive ? '#07090E' : 'var(--text-secondary)',
                transition: 'all 0.2s',
              }}
            >
              Floor {floor}
            </button>
          );
        })}
      </div>

      {/* Robot Follow HUD indicator */}
      {followingRobot && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 240, 255, 0.15)',
            border: '1px solid var(--accent-cyan)',
            padding: '6px 16px',
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
          <span>Locked to: {followingRobot}</span>
          <button
            onClick={onCancelFollow}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              cursor: 'pointer',
              marginLeft: '6px',
              fontSize: '11px',
              textDecoration: 'underline',
            }}
          >
            Unlock
          </button>
        </div>
      )}

      {/* Map Tools on the top right */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(13, 18, 29, 0.85)',
            backdropFilter: 'blur(12px)',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={onZoomIn}
            className="btn btn-secondary"
            title="Zoom In"
            style={{ borderRadius: 0, padding: '10px', border: 'none' }}
          >
            <ZoomIn size={16} />
          </button>
          <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
          <button
            onClick={onZoomOut}
            className="btn btn-secondary"
            title="Zoom Out"
            style={{ borderRadius: 0, padding: '10px', border: 'none' }}
          >
            <ZoomOut size={16} />
          </button>
          <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
          <button
            onClick={onResetView}
            className="btn btn-secondary"
            title="Reset View"
            style={{ borderRadius: 0, padding: '10px', border: 'none' }}
          >
            <Maximize2 size={16} />
          </button>
        </div>

        {/* Layers Filter Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            className="btn btn-secondary"
            style={{
              padding: '10px',
              borderRadius: '10px',
              background: showLayerMenu ? 'rgba(0, 240, 255, 0.2)' : 'rgba(13, 18, 29, 0.85)',
              borderColor: showLayerMenu ? 'var(--accent-cyan)' : 'var(--border-subtle)',
            }}
            title="Toggle Map Layers"
          >
            <SlidersHorizontal size={16} />
          </button>

          {showLayerMenu && (
            <div
              style={{
                position: 'absolute',
                top: '0',
                right: '48px',
                width: '180px',
                background: 'rgba(19, 26, 41, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '12px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '4px',
                }}
              >
                Map Layers
              </div>

              {(
                [
                  ['showRobots', 'Robots'],
                  ['showTrajectories', 'Trajectories'],
                  ['showLanes', 'Nav Lanes'],
                  ['showWaypoints', 'Waypoints'],
                  ['showDoors', 'Doors'],
                  ['showLifts', 'Elevators'],
                  ['showWalls', 'Walls'],
                  ['showLabels', 'Labels'],
                  ['showGrid', 'Grid'],
                  ['darkFloorplan', 'Dark Floorplan'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={() => onToggleLayer(key)}
                    style={{ accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zoom scale info bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          background: 'rgba(13, 18, 29, 0.75)',
          backdropFilter: 'blur(8px)',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border-subtle)',
          pointerEvents: 'none',
        }}
      >
        Scale: {Math.round(zoom * 100)}%
      </div>
    </>
  );
};
