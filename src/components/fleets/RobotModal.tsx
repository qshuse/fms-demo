import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { describeApiError, rmfClient } from '../../services/rmf-client';
import { FleetConfigRecord, RobotRecord } from '../../types/fmsApi';
import { errorBoxStyle, hintStyle, inputStyle, labelStyle } from './formStyles';

interface Props {
  robot?: RobotRecord;
  fleets: FleetConfigRecord[];
  defaultFleet?: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}

export const RobotModal: React.FC<Props> = ({ robot, fleets, defaultFleet, onClose, onSaved }) => {
  const isEdit = Boolean(robot);
  const [fleetName, setFleetName] = useState<string>(robot?.fleet_name ?? defaultFleet ?? fleets[0]?.name ?? '');
  const [name, setName] = useState<string>(robot?.name ?? '');
  const [charger, setCharger] = useState<string>(robot?.charger ?? '');
  const [baseUrl, setBaseUrl] = useState<string>(String(robot?.robot_api.base_url ?? ''));
  const [secret, setSecret] = useState<string>(String(robot?.robot_api.secret ?? ''));
  const [chargers, setChargers] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [probe, setProbe] = useState<{ reachable: boolean; detail: string } | null>(null);
  const [probing, setProbing] = useState<boolean>(false);

  const navGraph = fleets.find((item) => item.name === fleetName)?.config.nav_graph ?? '';

  useEffect(() => {
    if (!navGraph) {
      setChargers([]);
      return;
    }
    let cancelled = false;
    rmfClient
      .getNavGraph(navGraph)
      .then((graph) => {
        if (!cancelled) setChargers(graph.chargers);
      })
      .catch((e) => {
        if (!cancelled) setError(describeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [navGraph]);

  const testConnection = async () => {
    setProbe(null);
    setProbing(true);
    try {
      setProbe(await rmfClient.testRobot({ base_url: baseUrl.trim(), secret }));
    } catch (e) {
      setProbe({ reachable: false, detail: describeApiError(e) });
    } finally {
      setProbing(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!fleetName) {
      setError('Pick a fleet first.');
      return;
    }
    if (!name.trim() || !charger || !baseUrl.trim() || !secret) {
      setError('Name, charger, base URL and secret are all required.');
      return;
    }
    const body = {
      charger,
      robot_api: { ...(robot?.robot_api ?? {}), base_url: baseUrl.trim(), secret },
    };

    setSubmitting(true);
    try {
      if (isEdit && robot) {
        await rmfClient.updateRobot(robot.fleet_name, robot.name, body);
        onSaved(`Robot ${robot.name} updated. The adapter of fleet ${robot.fleet_name} restarts to apply it.`);
      } else {
        await rmfClient.createRobot(fleetName, name.trim(), body);
        onSaved(`Robot ${name.trim()} added to fleet ${fleetName}. It shows in Fleets once the robot reports pose and battery.`);
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
      <div className="modal-card" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>
            {isEdit ? `Edit robot ${robot?.name}` : 'Add robot'}
          </h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={labelStyle}>
            Fleet
            <select
              style={inputStyle}
              value={fleetName}
              onChange={(e) => {
                setFleetName(e.target.value);
                setCharger('');
              }}
              disabled={isEdit}
            >
              {fleets.length === 0 && <option value="">No fleet yet - add one first</option>}
              {fleets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Robot name
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit} placeholder="axbot1" />
          </label>

          <label style={labelStyle}>
            Charger waypoint
            <select style={inputStyle} value={charger} onChange={(e) => setCharger(e.target.value)}>
              <option value="">Select a charger</option>
              {chargers.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              {charger && !chargers.includes(charger) && <option value={charger}>{charger}</option>}
            </select>
            <span style={hintStyle}>Chargers come from the nav graph of the fleet: {navGraph || 'none'}</span>
          </label>

          <label style={labelStyle}>
            Robot base URL
            <input style={inputStyle} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.25.25:8090" />
          </label>

          <label style={labelStyle}>
            Robot secret
            <input
              style={inputStyle}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
            <span style={hintStyle}>Stored in the FMS database and sent to the adapter as plain text.</span>
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void testConnection()}
              disabled={probing || !baseUrl.trim()}
            >
              {probing ? 'Testing...' : 'Test connection'}
            </button>
            {probe && (
              <span style={{ fontSize: '12px', color: probe.reachable ? '#6EE7B7' : '#FCA5A5' }}>{probe.detail}</span>
            )}
          </div>

          {error && <div style={errorBoxStyle}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : isEdit ? 'Save changes' : 'Add robot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
