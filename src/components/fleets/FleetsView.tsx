import React, { useState } from 'react';
import { Bot, Cpu, Plus, Radio, Layers, Activity } from 'lucide-react';
import { useFms } from '../../context/FmsContext';
import { RobotCard } from './RobotCard';
import { FleetManagement } from './FleetManagement';

export const FleetsView: React.FC = () => {
  const { fleets, setActiveTab } = useFms();
  const [selectedFleetFilter, setSelectedFleetFilter] = useState<string>('all');
  const [showManagement, setShowManagement] = useState<boolean>(false);

  const filteredFleets =
    selectedFleetFilter === 'all'
      ? fleets
      : fleets.filter((f) => f.name === selectedFleetFilter);

  const totalRobots = fleets.reduce((acc, f) => acc + f.robots.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#FFFFFF' }}>
            Fleets & Robotic Telemetry Hub
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Real-time RMF Robot Adapters, Battery States & Live Poses
          </span>
        </div>

        <button
          className={showManagement ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => setShowManagement((current) => !current)}
        >
          <Plus size={13} /> {showManagement ? 'Hide management' : 'Manage fleets & robots'}
        </button>

        {/* Fleet Tab Filters */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-surface-elevated)',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={() => setSelectedFleetFilter('all')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: selectedFleetFilter === 'all' ? 'var(--accent-cyan)' : 'transparent',
              color: selectedFleetFilter === 'all' ? '#07090E' : 'var(--text-secondary)',
              transition: 'all 0.15s ease',
            }}
          >
            All Fleets ({totalRobots})
          </button>

          {fleets.map((fleet) => {
            const isSelected = selectedFleetFilter === fleet.name;
            return (
              <button
                key={fleet.name}
                onClick={() => setSelectedFleetFilter(fleet.name)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--accent-cyan)' : 'transparent',
                  color: isSelected ? '#07090E' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease',
                }}
              >
                {fleet.name} ({fleet.robots.length})
              </button>
            );
          })}
        </div>
      </div>

      {showManagement && <FleetManagement />}

      {/* Fleets Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {filteredFleets.map((fleet) => (
          <div key={fleet.name} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Cpu size={18} color="var(--accent-cyan)" />
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>
                {fleet.name}
              </h3>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {fleet.robots.length} Units Online
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {fleet.robots.map((robot) => (
                <RobotCard key={robot.name} robot={robot} fleetName={fleet.name} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
