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

type Reference = FleetConfigBody['reference_coordinates'];
type RmfFleet = Record<string, any>;

const TASK_CAPABILITIES = ['loop', 'delivery', 'patrol', 'clean'];
const ACTIONS = ['jack_up', 'jack_down'];
const FINISHING_REQUESTS = ['charge', 'park', 'nothing'];

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '12px',
  borderRadius: '8px',
  border: '1px solid var(--border-subtle)',
};
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' };
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' };

const NumberField: React.FC<{ label: string; value: number; onChange: (value: number) => void; step?: number }> = ({
  label,
  value,
  onChange,
  step = 0.1,
}) => (
  <label style={labelStyle}>
    {label}
    <input
      style={inputStyle}
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </label>
);

const CheckField: React.FC<{ label: string; checked: boolean; onChange: (checked: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label style={checkStyle}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

const JsonField: React.FC<{ label: string; value: unknown; onChange: (value: any) => void }> = ({ label, value, onChange }) => {
  const [text, setText] = useState<string>(JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState<boolean>(false);

  useEffect(() => {
    setText((current) => {
      try {
        return JSON.stringify(JSON.parse(current)) === JSON.stringify(value) ? current : JSON.stringify(value, null, 2);
      } catch {
        return JSON.stringify(value, null, 2);
      }
    });
  }, [value]);

  return (
    <label style={labelStyle}>
      {label}
      <textarea
        style={{ ...inputStyle, minHeight: '140px', fontFamily: 'monospace', fontSize: '12px', borderColor: invalid ? '#EF4444' : undefined }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
    </label>
  );
};

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
  const [rmfFleet, setRmfFleet] = useState<RmfFleet>(fleet?.config.rmf_fleet ?? DEFAULT_RMF_FLEET);
  const [reference, setReference] = useState<Reference>(fleet?.config.reference_coordinates ?? {});
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
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
        setReference((current) => {
          const next: Reference = {};
          graph.levels.forEach((level) => {
            next[level] = current[level] ?? IDENTITY_REFERENCE;
          });
          return next;
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

  const setField = (path: (string | number)[], value: unknown) => {
    setRmfFleet((current) => {
      const next = JSON.parse(JSON.stringify(current));
      let target = next;
      path.slice(0, -1).forEach((key, index) => {
        if (target[key] === undefined || target[key] === null) target[key] = typeof path[index + 1] === 'number' ? [] : {};
        target = target[key];
      });
      target[path[path.length - 1]] = value;
      return next;
    });
  };

  const toggleListItem = (key: string, item: string, checked: boolean) => {
    const list: string[] = rmfFleet[key] ?? [];
    setField([key], checked ? [...list, item] : list.filter((entry) => entry !== item));
  };

  const setPoint = (level: string, row: number, field: 'rmf' | 'robot', axis: number, value: number) => {
    setReference((current) => {
      const entry = current[level] ?? IDENTITY_REFERENCE;
      const points = entry[field].map((point) => [...point]);
      points[row][axis] = value;
      return { ...current, [level]: { ...entry, [field]: points } };
    });
  };

  const addPoint = (level: string) => {
    setReference((current) => {
      const entry = current[level] ?? IDENTITY_REFERENCE;
      return { ...current, [level]: { rmf: [...entry.rmf, [0, 0]], robot: [...entry.robot, [0, 0]] } };
    });
  };

  const removePoint = (level: string, row: number) => {
    setReference((current) => {
      const entry = current[level] ?? IDENTITY_REFERENCE;
      return {
        ...current,
        [level]: { rmf: entry.rmf.filter((_, i) => i !== row), robot: entry.robot.filter((_, i) => i !== row) },
      };
    });
  };

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
    for (const level of detail.levels) {
      const points = reference[level]?.rmf ?? [];
      const distinct = new Set(points.map((point) => point.join(','))).size;
      if (points.length < 2 || distinct < 2) {
        setError(`Level ${level}: reference_coordinates needs at least two different points.`);
        return;
      }
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

          <div style={sectionStyle}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Coordinate calibration</span>
            <span style={hintStyle}>
              Pairs of the same physical point in RMF meters and in the robot map. Use at least two different points that are far apart. Identity values are only right when both maps share the same origin.
            </span>
            {(detail?.levels ?? Object.keys(reference)).map((level) => {
              const entry = reference[level] ?? IDENTITY_REFERENCE;
              return (
                <div key={level} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--accent-cyan)' }}>{level}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addPoint(level)}>
                      Add point
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setReference((current) => ({ ...current, [level]: IDENTITY_REFERENCE }))}
                    >
                      Identity
                    </button>
                  </div>
                  {entry.rmf.map((rmfPoint, row) => (
                    <div key={row} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: '6px', alignItems: 'end' }}>
                      <NumberField label="RMF x" value={rmfPoint[0]} step={0.01} onChange={(v) => setPoint(level, row, 'rmf', 0, v)} />
                      <NumberField label="RMF y" value={rmfPoint[1]} step={0.01} onChange={(v) => setPoint(level, row, 'rmf', 1, v)} />
                      <NumberField label="Robot x" value={entry.robot[row][0]} step={0.01} onChange={(v) => setPoint(level, row, 'robot', 0, v)} />
                      <NumberField label="Robot y" value={entry.robot[row][1]} step={0.01} onChange={(v) => setPoint(level, row, 'robot', 1, v)} />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => removePoint(level, row)}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={sectionStyle}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Speed and size</span>
            <div style={gridStyle}>
              <NumberField label="Linear speed (m/s)" value={rmfFleet.limits?.linear?.[0]} onChange={(v) => setField(['limits', 'linear', 0], v)} />
              <NumberField label="Linear accel (m/s2)" value={rmfFleet.limits?.linear?.[1]} onChange={(v) => setField(['limits', 'linear', 1], v)} />
              <NumberField label="Angular speed (rad/s)" value={rmfFleet.limits?.angular?.[0]} onChange={(v) => setField(['limits', 'angular', 0], v)} />
              <NumberField label="Angular accel (rad/s2)" value={rmfFleet.limits?.angular?.[1]} onChange={(v) => setField(['limits', 'angular', 1], v)} />
              <NumberField label="Footprint radius (m)" value={rmfFleet.profile?.footprint} onChange={(v) => setField(['profile', 'footprint'], v)} />
              <NumberField label="Vicinity radius (m)" value={rmfFleet.profile?.vicinity} onChange={(v) => setField(['profile', 'vicinity'], v)} />
            </div>
            <CheckField label="Robot can drive in reverse" checked={Boolean(rmfFleet.reversible)} onChange={(v) => setField(['reversible'], v)} />
          </div>

          <div style={sectionStyle}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Battery and power</span>
            <div style={gridStyle}>
              <NumberField label="Voltage (V)" value={rmfFleet.battery_system?.voltage} step={1} onChange={(v) => setField(['battery_system', 'voltage'], v)} />
              <NumberField label="Capacity (Ah)" value={rmfFleet.battery_system?.capacity} step={1} onChange={(v) => setField(['battery_system', 'capacity'], v)} />
              <NumberField label="Charging current (A)" value={rmfFleet.battery_system?.charging_current} step={1} onChange={(v) => setField(['battery_system', 'charging_current'], v)} />
              <NumberField label="Mass (kg)" value={rmfFleet.mechanical_system?.mass} step={1} onChange={(v) => setField(['mechanical_system', 'mass'], v)} />
              <NumberField label="Moment of inertia" value={rmfFleet.mechanical_system?.moment_of_inertia} step={1} onChange={(v) => setField(['mechanical_system', 'moment_of_inertia'], v)} />
              <NumberField label="Friction coefficient" value={rmfFleet.mechanical_system?.friction_coefficient} step={0.01} onChange={(v) => setField(['mechanical_system', 'friction_coefficient'], v)} />
              <NumberField label="Ambient power (W)" value={rmfFleet.ambient_system?.power} step={1} onChange={(v) => setField(['ambient_system', 'power'], v)} />
              <NumberField label="Tool power (W)" value={rmfFleet.tool_system?.power} step={1} onChange={(v) => setField(['tool_system', 'power'], v)} />
              <NumberField label="Recharge below (0-1)" value={rmfFleet.recharge_threshold} step={0.01} onChange={(v) => setField(['recharge_threshold'], v)} />
              <NumberField label="Charge up to (0-1)" value={rmfFleet.recharge_soc} step={0.01} onChange={(v) => setField(['recharge_soc'], v)} />
            </div>
            <CheckField label="Account for battery drain when planning" checked={Boolean(rmfFleet.account_for_battery_drain)} onChange={(v) => setField(['account_for_battery_drain'], v)} />
          </div>

          <div style={sectionStyle}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Tasks and behavior</span>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              {TASK_CAPABILITIES.map((name) => (
                <CheckField key={name} label={name} checked={Boolean(rmfFleet.task_capabilities?.[name])} onChange={(v) => setField(['task_capabilities', name], v)} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              {ACTIONS.map((name) => (
                <CheckField key={name} label={`action ${name}`} checked={(rmfFleet.actions ?? []).includes(name)} onChange={(v) => toggleListItem('actions', name, v)} />
              ))}
            </div>
            <div style={gridStyle}>
              <label style={labelStyle}>
                When a task ends
                <select style={inputStyle} value={rmfFleet.finishing_request ?? 'nothing'} onChange={(e) => setField(['finishing_request'], e.target.value)}>
                  {FINISHING_REQUESTS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField label="Fleet state rate (Hz)" value={rmfFleet.publish_fleet_state} step={1} onChange={(v) => setField(['publish_fleet_state'], v)} />
              <NumberField label="Robot update rate (Hz)" value={rmfFleet.robot_state_update_frequency} step={1} onChange={(v) => setField(['robot_state_update_frequency'], v)} />
            </div>
            <CheckField label="Responsive wait" checked={Boolean(rmfFleet.responsive_wait)} onChange={(v) => setField(['responsive_wait'], v)} />
          </div>

          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdvanced((current) => !current)}>
              {showAdvanced ? 'Hide advanced (JSON)' : 'Advanced (JSON)'}
            </button>
          </div>
          {showAdvanced && (
            <>
              <JsonField label="rmf_fleet" value={rmfFleet} onChange={setRmfFleet} />
              <JsonField label="reference_coordinates" value={reference} onChange={setReference} />
            </>
          )}

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
