import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { describeApiError, rmfClient } from '../../services/rmf-client';
import { FleetConfigBody, FleetConfigRecord, NavGraphDetail, NavGraphFile } from '../../types/fmsApi';
import { errorBoxStyle, hintStyle, inputStyle, labelStyle } from './formStyles';

const DEFAULT_RMF_FLEET = {
  limits: { linear: [0.8, 0.5], angular: [1.0, 1.0] },
  profile: { footprint: 0.3, vicinity: 0.5 },
  reversible: false,
  battery_system: { voltage: 24.0, capacity: 40.0, charging_current: 10.0 },
  mechanical_system: { mass: 60.0, moment_of_inertia: 10.0, friction_coefficient: 0.22 },
  ambient_system: { power: 20.0 },
  tool_system: { power: 0.0 },
  recharge_threshold: 0.15,
  recharge_soc: 1.0,
  publish_fleet_state: 10.0,
  account_for_battery_drain: true,
  task_capabilities: { loop: true, delivery: true, patrol: true },
  actions: ['jack_up', 'jack_down'],
  finishing_request: 'charge',
  responsive_wait: false,
  robot_state_update_frequency: 10.0,
};

const IDENTITY_REFERENCE = { rmf: [[0, 0], [10, 0]], robot: [[0, 0], [10, 0]] };

interface LevelMap {
  map_id: string;
  map_name: string;
}

interface Props {
  fleet?: FleetConfigRecord;
  onClose: () => void;
  onSaved: (text: string) => void;
}

export const FleetConfigModal: React.FC<Props> = ({ fleet, onClose, onSaved }) => {
  const isEdit = Boolean(fleet);
  const [name, setName] = useState<string>(fleet?.name ?? '');
  const [navGraphs, setNavGraphs] = useState<NavGraphFile[]>([]);
  const [navGraph, setNavGraph] = useState<string>(fleet?.config.nav_graph ?? '');
  const [detail, setDetail] = useState<NavGraphDetail | null>(null);
  const [levelMaps, setLevelMaps] = useState<Record<string, LevelMap>>(() => {
    const maps = fleet?.config.robot_api.maps ?? {};
    return Object.fromEntries(
      Object.entries(maps).map(([level, value]) => [
        level,
        { map_id: String(value.map_id ?? ''), map_name: String(value.map_name ?? '') },
      ]),
    );
  });
  const [rmfFleetText, setRmfFleetText] = useState<string>(
    JSON.stringify(fleet?.config.rmf_fleet ?? DEFAULT_RMF_FLEET, null, 2),
  );
  const [referenceText, setReferenceText] = useState<string>(
    JSON.stringify(fleet?.config.reference_coordinates ?? {}, null, 2),
  );
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    rmfClient
      .listNavGraphs()
      .then((files) => setNavGraphs([...files].sort((a, b) => b.modified_at.localeCompare(a.modified_at))))
      .catch((e) => setError(describeApiError(e)));
  }, []);

  useEffect(() => {
    if (!navGraph) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    rmfClient
      .getNavGraph(navGraph)
      .then((graph) => {
        if (cancelled) return;
        setDetail(graph);
        setLevelMaps((current) => {
          const next: Record<string, LevelMap> = {};
          graph.levels.forEach((level, index) => {
            next[level] = current[level] ?? { map_id: String(index + 1), map_name: level };
          });
          return next;
        });
        setReferenceText((current) => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(current || '{}');
          } catch {
            return current;
          }
          const next: Record<string, unknown> = {};
          graph.levels.forEach((level) => {
            next[level] = parsed[level] ?? IDENTITY_REFERENCE;
          });
          return JSON.stringify(next, null, 2);
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setError(describeApiError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [navGraph]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isEdit && !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      setError('Name must start with a letter and contain only letters, digits and underscores.');
      return;
    }
    if (!navGraph || !detail) {
      setError('Pick a nav graph first.');
      return;
    }
    let rmfFleet: Record<string, unknown>;
    let reference: FleetConfigBody['reference_coordinates'];
    try {
      rmfFleet = JSON.parse(rmfFleetText);
      reference = JSON.parse(referenceText);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const maps: Record<string, Record<string, unknown>> = {};
    for (const level of detail.levels) {
      const entry = levelMaps[level];
      if (!entry || !/^\d+$/.test(entry.map_id) || !entry.map_name) {
        setError(`Level ${level}: map_id must be an integer and map_name is required.`);
        return;
      }
      maps[level] = { map_id: Number(entry.map_id), map_name: entry.map_name };
    }
    const body: FleetConfigBody = {
      nav_graph: navGraph,
      rmf_fleet: rmfFleet,
      robot_api: {
        type: 'axbot',
        creator: 'fms',
        timeout: 5.0,
        dock_at_charger: true,
        ...(fleet?.config.robot_api ?? {}),
        maps,
      },
      reference_coordinates: reference,
    };

    setSubmitting(true);
    try {
      if (isEdit && fleet) {
        await rmfClient.updateFleetConfig(fleet.name, body);
        onSaved(`Fleet ${fleet.name} updated. Its adapter restarts to apply the change.`);
      } else {
        await rmfClient.createFleetConfig(name, body);
        onSaved(`Fleet ${name} created.`);
      }
      onClose();
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>
            {isEdit ? `Edit fleet ${fleet?.name}` : 'Add fleet'}
          </h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={labelStyle}>
            Fleet name
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder="office"
            />
          </label>

          <label style={labelStyle}>
            Nav graph
            <select style={inputStyle} value={navGraph} onChange={(e) => setNavGraph(e.target.value)}>
              <option value="">Select a nav graph</option>
              {navGraphs.map((file) => (
                <option key={file.name} value={file.name}>
                  {file.name}
                </option>
              ))}
            </select>
            {detail && (
              <span style={hintStyle}>
                {detail.valid ? 'Valid' : `Invalid: ${detail.error ?? ''}`} - levels: {detail.levels.join(', ') || 'none'}
                {' - '}waypoints: {detail.waypoints.length} - lanes: {detail.lanes} - chargers:{' '}
                {detail.chargers.join(', ') || 'none'}
              </span>
            )}
          </label>

          {detail && detail.levels.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Robot map of each level (map_id and map_name inside the robot)
              </span>
              {detail.levels.map((level) => (
                <div key={level} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 2fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--accent-cyan)' }}>{level}</span>
                  <input
                    style={inputStyle}
                    placeholder="map_id"
                    value={levelMaps[level]?.map_id ?? ''}
                    onChange={(e) =>
                      setLevelMaps((current) => ({ ...current, [level]: { ...current[level], map_id: e.target.value } }))
                    }
                  />
                  <input
                    style={inputStyle}
                    placeholder="map_name"
                    value={levelMaps[level]?.map_name ?? ''}
                    onChange={(e) =>
                      setLevelMaps((current) => ({ ...current, [level]: { ...current[level], map_name: e.target.value } }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <label style={labelStyle}>
            reference_coordinates (JSON, RMF point to robot point per level)
            <textarea
              style={{ ...inputStyle, minHeight: '110px', fontFamily: 'monospace', fontSize: '12px' }}
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
            />
            <span style={hintStyle}>
              Needs at least two different points per level. Identity points are only right when the robot map and the RMF
              map share the same origin.
            </span>
          </label>

          <label style={labelStyle}>
            rmf_fleet (JSON: speed limits, battery, task_capabilities...)
            <textarea
              style={{ ...inputStyle, minHeight: '180px', fontFamily: 'monospace', fontSize: '12px' }}
              value={rmfFleetText}
              onChange={(e) => setRmfFleetText(e.target.value)}
            />
          </label>

          {error && <div style={errorBoxStyle}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : isEdit ? 'Save changes' : 'Create fleet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
