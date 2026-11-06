import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { describeApiError, rmfClient } from '../../services/rmf-client';
import { FleetConfigRecord, RobotRecord } from '../../types/fmsApi';
import { FleetConfigModal } from './FleetConfigModal';
import { RobotModal } from './RobotModal';
import { errorBoxStyle } from './formStyles';

const STATE_COLORS: Record<string, string> = {
  running: 'var(--accent-emerald)',
  crashed: 'var(--accent-crimson)',
  waiting_for_nav_graph: 'var(--accent-amber)',
};

export const FleetManagement: React.FC = () => {
  const [fleets, setFleets] = useState<FleetConfigRecord[]>([]);
  const [robots, setRobots] = useState<RobotRecord[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fleetModal, setFleetModal] = useState<{ fleet?: FleetConfigRecord } | null>(null);
  const [robotModal, setRobotModal] = useState<{ robot?: RobotRecord } | null>(null);

  const load = useCallback(async () => {
    try {
      const [fleetList, robotList] = await Promise.all([rmfClient.listFleetConfigs(), rmfClient.listRobots()]);
      setFleets(fleetList);
      setRobots(robotList);
    } catch (e) {
      setNotice({ kind: 'error', text: describeApiError(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const saved = (text: string) => {
    setNotice({ kind: 'ok', text });
    void load();
  };

  const removeFleet = async (fleet: FleetConfigRecord) => {
    if (!window.confirm(`Delete fleet ${fleet.name}? Its adapter is stopped. Delete its robots first.`)) return;
    try {
      await rmfClient.deleteFleetConfig(fleet.name);
      saved(`Fleet ${fleet.name} deleted.`);
    } catch (e) {
      setNotice({ kind: 'error', text: describeApiError(e) });
    }
  };

  const removeRobot = async (robot: RobotRecord) => {
    if (
      !window.confirm(
        `Delete robot ${robot.name}? The adapter of fleet ${robot.fleet_name} restarts, which interrupts the tasks of every robot in that fleet.`,
      )
    )
      return;
    try {
      await rmfClient.deleteRobot(robot.fleet_name, robot.name);
      saved(`Robot ${robot.name} deleted.`);
    } catch (e) {
      setNotice({ kind: 'error', text: describeApiError(e) });
    }
  };

  const cell: React.CSSProperties = { padding: '8px 10px', fontSize: '12px', color: 'var(--text-primary)' };
  const head: React.CSSProperties = { ...cell, color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left' };

  return (
    <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>Fleet management</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Fleets and robots are stored in the FMS database. Editing or deleting a robot restarts the adapter of its fleet.
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => void load()}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setFleetModal({})}>
            <Plus size={13} /> Add fleet
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setRobotModal({})} disabled={fleets.length === 0}>
            <Plus size={13} /> Add robot
          </button>
        </div>
      </div>

      {notice && (
        <div
          style={
            notice.kind === 'error'
              ? errorBoxStyle
              : { ...errorBoxStyle, background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)', color: '#6EE7B7' }
          }
          onClick={() => setNotice(null)}
        >
          {notice.text}
        </div>
      )}

      <div className="table-responsive">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={head}>Fleet</th>
              <th style={head}>Nav graph</th>
              <th style={head}>Adapter</th>
              <th style={head}>Robots</th>
              <th style={head} />
            </tr>
          </thead>
          <tbody>
            {fleets.length === 0 && (
              <tr>
                <td style={{ ...cell, color: 'var(--text-muted)' }} colSpan={5}>
                  No fleet yet.
                </td>
              </tr>
            )}
            {fleets.map((fleet) => (
              <tr key={fleet.name} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ ...cell, fontWeight: 600 }}>{fleet.name}</td>
                <td style={{ ...cell, color: 'var(--text-secondary)' }}>{fleet.config.nav_graph}</td>
                <td style={cell}>
                  <span style={{ color: STATE_COLORS[fleet.status?.state ?? ''] ?? 'var(--text-muted)' }}>
                    {fleet.status?.state ?? 'unknown'}
                  </span>
                  {fleet.status && fleet.status.restarts > 0 ? ` (restarts: ${fleet.status.restarts})` : ''}
                </td>
                <td style={cell}>{robots.filter((robot) => robot.fleet_name === fleet.name).length}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setFleetModal({ fleet })}>
                    Edit
                  </button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => void removeFleet(fleet)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-responsive">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={head}>Robot</th>
              <th style={head}>Fleet</th>
              <th style={head}>Charger</th>
              <th style={head}>Base URL</th>
              <th style={head} />
            </tr>
          </thead>
          <tbody>
            {robots.length === 0 && (
              <tr>
                <td style={{ ...cell, color: 'var(--text-muted)' }} colSpan={5}>
                  No robot yet.
                </td>
              </tr>
            )}
            {robots.map((robot) => (
              <tr key={`${robot.fleet_name}/${robot.name}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ ...cell, fontWeight: 600 }}>{robot.name}</td>
                <td style={cell}>{robot.fleet_name}</td>
                <td style={cell}>{robot.charger}</td>
                <td style={{ ...cell, color: 'var(--text-secondary)' }}>{String(robot.robot_api.base_url ?? '')}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setRobotModal({ robot })}>
                    Edit
                  </button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => void removeRobot(robot)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fleetModal && (
        <FleetConfigModal fleet={fleetModal.fleet} onClose={() => setFleetModal(null)} onSaved={saved} />
      )}
      {robotModal && (
        <RobotModal robot={robotModal.robot} fleets={fleets} onClose={() => setRobotModal(null)} onSaved={saved} />
      )}
    </div>
  );
};
