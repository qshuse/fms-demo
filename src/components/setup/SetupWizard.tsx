import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useFms } from '../../context/FmsContext';
import { describeApiError, rmfClient } from '../../services/rmf-client';
import { FleetConfigRecord, NavGraphDetail, RobotRecord } from '../../types/fmsApi';
import { FleetConfigModal } from '../fleets/FleetConfigModal';
import { RobotModal } from '../fleets/RobotModal';
import { errorBoxStyle, hintStyle, inputStyle, labelStyle } from '../fleets/formStyles';

const STEPS = ['Current state', 'Map', 'Fleet', 'Robot', 'Run a test'];

interface Snapshot {
  mapName: string;
  mapLevels: string[];
  graphs: NavGraphDetail[];
  fleets: FleetConfigRecord[];
  robots: RobotRecord[];
  reported: string[];
}

interface TestRun {
  fleet: string;
  robot: string;
  startedAt: number;
}

const EMPTY: Snapshot = { mapName: '', mapLevels: [], graphs: [], fleets: [], robots: [], reported: [] };

export const SetupWizard: React.FC = () => {
  const { setActiveTab } = useFms();
  const [step, setStep] = useState<number>(0);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [fleetModal, setFleetModal] = useState<{ fleet?: FleetConfigRecord } | null>(null);
  const [robotModal, setRobotModal] = useState<{ robot?: RobotRecord } | null>(null);
  const [testTarget, setTestTarget] = useState<string>('');
  const [testWaypoint, setTestWaypoint] = useState<string>('');
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [testStatus, setTestStatus] = useState<string>('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [fleets, robots, graphFiles, building, live] = await Promise.all([
        rmfClient.listFleetConfigs(),
        rmfClient.listRobots(),
        rmfClient.listNavGraphs(),
        rmfClient.getBuildingMap().catch(() => null),
        rmfClient.getFleets().catch(() => []),
      ]);
      const graphs = await Promise.all(graphFiles.map((file) => rmfClient.getNavGraph(file.name)));
      setSnapshot({
        mapName: building?.name ?? '',
        mapLevels: (building?.levels ?? []).map((level) => level.name),
        graphs,
        fleets,
        robots,
        reported: live.flatMap((fleet) => fleet.robots.map((robot) => `${fleet.name}/${robot.name}`)),
      });
      setLoaded(true);
    } catch (e) {
      setNotice({ kind: 'error', text: describeApiError(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const usableGraphs = snapshot.graphs.filter((graph) => graph.valid && graph.chargers.length > 0);
  const reportedRobots = snapshot.robots.filter((robot) => snapshot.reported.includes(`${robot.fleet_name}/${robot.name}`));
  const gates = [
    loaded,
    usableGraphs.length > 0,
    snapshot.fleets.length > 0,
    snapshot.robots.length > 0,
    true,
  ];

  const testRobot = snapshot.robots.find((robot) => `${robot.fleet_name}/${robot.name}` === testTarget);
  const testFleet = snapshot.fleets.find((fleet) => fleet.name === testRobot?.fleet_name);
  const testGraph = snapshot.graphs.find((graph) => graph.name === testFleet?.config.nav_graph);

  useEffect(() => {
    if (!testTarget && reportedRobots.length > 0) {
      setTestTarget(`${reportedRobots[0].fleet_name}/${reportedRobots[0].name}`);
    }
  }, [reportedRobots, testTarget]);

  useEffect(() => {
    if (testGraph && !testGraph.waypoints.includes(testWaypoint)) {
      setTestWaypoint(testGraph.waypoints[0] ?? '');
    }
  }, [testGraph, testWaypoint]);

  useEffect(() => {
    if (!testRun) return;
    const timer = setInterval(async () => {
      try {
        const tasks = await rmfClient.getTasks();
        const task = tasks.find(
          (item) =>
            (item.booking.unix_millis_request_time ?? 0) >= testRun.startedAt - 5000 &&
            item.assigned_to?.name === testRun.robot &&
            item.assigned_to?.group === testRun.fleet,
        );
        if (task) setTestStatus(task.status);
      } catch {
        setTestStatus('unknown');
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [testRun]);

  const fail = (e: unknown) => setNotice({ kind: 'error', text: describeApiError(e) });

  const saved = (text: string) => {
    setNotice({ kind: 'ok', text });
    void load();
  };

  const reset = async () => {
    if (
      !window.confirm(
        'Delete every robot and every fleet? Their adapters stop and the task history stays. The building map is kept until you upload a new one.',
      )
    )
      return;
    setBusy(true);
    try {
      for (const robot of snapshot.robots) await rmfClient.deleteRobot(robot.fleet_name, robot.name);
      for (const fleet of snapshot.fleets) await rmfClient.deleteFleetConfig(fleet.name);
      setTestTarget('');
      setTestRun(null);
      setTestStatus('');
      saved('All robots and fleets deleted.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const response = await rmfClient.uploadBuildingMap(file, file.name);
      const graphs: string[] = response?.data?.nav_graphs ?? [];
      saved(`Map uploaded. Nav graphs: ${graphs.join(', ') || 'none'}.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const sendTest = async () => {
    if (!testRobot || !testWaypoint) return;
    setBusy(true);
    setTestStatus('');
    try {
      const startedAt = Date.now();
      const response = await rmfClient.dispatchRobotTask({
        robot: testRobot.name,
        fleet: testRobot.fleet_name,
        category: 'patrol',
        description: { places: [testWaypoint], rounds: 1 },
      });
      if (!response || response.success === false) throw new Error('Task rejected by server');
      setTestRun({ fleet: testRobot.fleet_name, robot: testRobot.name, startedAt });
      setTestStatus('queued');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const card: React.CSSProperties = {
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface-elevated)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };
  const line: React.CSSProperties = { fontSize: '12px', color: 'var(--text-secondary)' };
  const ok = (value: boolean) => (value ? 'var(--accent-emerald)' : 'var(--accent-amber)');

  return (
    <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>Setup wizard</h3>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          From an empty site to a robot that runs a task: map, fleet, robot, test. Each step unlocks the next one when the API confirms it.
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {STEPS.map((label, index) => {
          const reachable = index <= step || gates.slice(0, index).every(Boolean);
          return (
            <button
              key={label}
              className={`btn btn-sm ${index === step ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!reachable}
              onClick={() => setStep(index)}
            >
              {index + 1}. {label}
              {index < step && gates[index] ? <Check size={12} /> : null}
            </button>
          );
        })}
        <button className="btn btn-secondary btn-sm" onClick={() => void load()} style={{ marginLeft: 'auto' }}>
          <RefreshCw size={13} /> Refresh
        </button>
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

      {step === 0 && (
        <div style={card}>
          <span style={line}>
            Building map:{' '}
            <b style={{ color: ok(Boolean(snapshot.mapName)) }}>
              {snapshot.mapName ? `${snapshot.mapName} (levels: ${snapshot.mapLevels.join(', ')})` : 'none'}
            </b>
          </span>
          <span style={line}>
            Fleets: <b>{snapshot.fleets.map((fleet) => fleet.name).join(', ') || 'none'}</b>
          </span>
          <span style={line}>
            Robots: <b>{snapshot.robots.map((robot) => `${robot.fleet_name}/${robot.name}`).join(', ') || 'none'}</b>
          </span>
          <span style={hintStyle}>
            The API keeps one building map at a time. Uploading a new map replaces it, so fleets and robots built for the old map must go first.
          </span>
          <div>
            <button
              className="btn btn-danger btn-sm"
              disabled={busy || (snapshot.fleets.length === 0 && snapshot.robots.length === 0)}
              onClick={() => void reset()}
            >
              <Trash2 size={12} /> Delete all robots and fleets
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={card}>
          <span style={line}>
            Current map: <b>{snapshot.mapName || 'none'}</b>
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('traffic-editor')}>
              Draw or edit in Traffic Editor
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload size={13} /> Upload a map zip
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
          <span style={hintStyle}>
            In the Traffic Editor, save/publish the map and come back here. The zip must hold one *.building.yaml and its floorplan images.
          </span>
          <span style={line}>Nav graphs generated by the API (a usable one is valid and has a charger waypoint):</span>
          {snapshot.graphs.length === 0 && <span style={{ ...line, color: 'var(--accent-amber)' }}>None yet.</span>}
          {snapshot.graphs.map((graph) => (
            <span key={graph.name} style={{ ...line, color: ok(graph.valid && graph.chargers.length > 0) }}>
              {graph.name} - {graph.valid ? 'valid' : `invalid: ${graph.error ?? ''}`} - levels: {graph.levels.join(', ')} - waypoints:{' '}
              {graph.waypoints.length} - chargers: {graph.chargers.join(', ') || 'none'}
            </span>
          ))}
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          <div>
            <button className="btn btn-primary btn-sm" onClick={() => setFleetModal({})} disabled={usableGraphs.length === 0}>
              Add fleet
            </button>
          </div>
          {snapshot.fleets.length === 0 && <span style={{ ...line, color: 'var(--accent-amber)' }}>No fleet yet.</span>}
          {snapshot.fleets.map((fleet) => (
            <div key={fleet.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ ...line, color: 'var(--text-primary)', fontWeight: 600 }}>{fleet.name}</span>
              <span style={line}>
                {fleet.config.nav_graph} - adapter:{' '}
                <b style={{ color: ok(fleet.status?.state === 'running') }}>{fleet.status?.state ?? 'unknown'}</b>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setFleetModal({ fleet })}>
                Edit
              </button>
            </div>
          ))}
          <span style={hintStyle}>
            reference_coordinates maps RMF points to robot points. Identity values are only right when both maps share the same origin.
          </span>
        </div>
      )}

      {step === 3 && (
        <div style={card}>
          <div>
            <button className="btn btn-primary btn-sm" onClick={() => setRobotModal({})} disabled={snapshot.fleets.length === 0}>
              Add robot
            </button>
          </div>
          {snapshot.robots.length === 0 && <span style={{ ...line, color: 'var(--accent-amber)' }}>No robot yet.</span>}
          {snapshot.robots.map((robot) => {
            const reported = snapshot.reported.includes(`${robot.fleet_name}/${robot.name}`);
            return (
              <div key={`${robot.fleet_name}/${robot.name}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ ...line, color: 'var(--text-primary)', fontWeight: 600 }}>
                  {robot.fleet_name}/{robot.name}
                </span>
                <span style={line}>
                  charger {robot.charger} - {String(robot.robot_api.base_url ?? '')} -{' '}
                  <b style={{ color: ok(reported) }}>{reported ? 'reporting pose to RMF' : 'waiting for first report'}</b>
                </span>
                <button className="btn btn-secondary btn-sm" onClick={() => setRobotModal({ robot })}>
                  Edit
                </button>
              </div>
            );
          })}
          <span style={hintStyle}>
            After adding a robot, wait until it shows as reporting. Editing a robot restarts the adapter of its fleet.
          </span>
        </div>
      )}

      {step === 4 && (
        <div style={card}>
          {reportedRobots.length === 0 ? (
            <span style={{ ...line, color: 'var(--accent-amber)' }}>
              No robot is reporting to RMF yet. Go back to the Robot step and wait for it.
            </span>
          ) : (
            <>
              <label style={labelStyle}>
                Robot
                <select style={inputStyle} value={testTarget} onChange={(e) => setTestTarget(e.target.value)}>
                  {reportedRobots.map((robot) => (
                    <option key={`${robot.fleet_name}/${robot.name}`} value={`${robot.fleet_name}/${robot.name}`}>
                      {robot.fleet_name}/{robot.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Go to waypoint
                <select style={inputStyle} value={testWaypoint} onChange={(e) => setTestWaypoint(e.target.value)}>
                  {(testGraph?.waypoints ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button className="btn btn-primary btn-sm" disabled={busy || !testWaypoint} onClick={() => void sendTest()}>
                  Send robot
                </button>
                {testStatus && (
                  <span
                    style={{
                      ...line,
                      color:
                        testStatus === 'completed'
                          ? 'var(--accent-emerald)'
                          : testStatus === 'failed' || testStatus === 'canceled'
                            ? 'var(--accent-crimson)'
                            : 'var(--accent-amber)',
                    }}
                  >
                    Task: {testStatus}
                  </span>
                )}
              </div>
              <span style={hintStyle}>Sent as a patrol task with one place and one round.</span>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        <button className="btn btn-primary" disabled={step === STEPS.length - 1 || !gates[step]} onClick={() => setStep(step + 1)}>
          Next
        </button>
      </div>

      {fleetModal && (
        <FleetConfigModal fleet={fleetModal.fleet} onClose={() => setFleetModal(null)} onSaved={saved} />
      )}
      {robotModal && (
        <RobotModal
          robot={robotModal.robot}
          fleets={snapshot.fleets}
          onClose={() => setRobotModal(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
};
