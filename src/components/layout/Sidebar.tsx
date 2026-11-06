import React from 'react';
import {
  LayoutDashboard,
  Map,
  Route,
  Bot,
  ListTodo,
  Building2,
  AlertTriangle,
  Sliders,
  Wand2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useFms } from '../../context/FmsContext';
import { NavigationTab } from '../../types/fms';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapse }) => {
  const { activeTab, setActiveTab, alerts, tasks } = useFms();

  const navItems: { id: NavigationTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'overview',
      label: 'Cockpit Overview',
      icon: <LayoutDashboard size={20} />,
    },
    {
      id: 'map',
      label: 'Digital Twin Map',
      icon: <Map size={20} />,
    },
    {
      id: 'setup',
      label: 'Setup Wizard',
      icon: <Wand2 size={20} />,
    },
    {
      id: 'traffic-editor',
      label: 'Traffic Editor',
      icon: <Route size={20} />,
    },
    {
      id: 'fleets',
      label: 'Fleets & Telemetry',
      icon: <Bot size={20} />,
    },
    {
      id: 'tasks',
      label: 'Task Center',
      icon: <ListTodo size={20} />,
      badge: tasks.filter((t) => t.status === 'underway').length,
    },
    {
      id: 'infrastructure',
      label: 'Doors & Elevators',
      icon: <Building2 size={20} />,
    },
    {
      id: 'alerts',
      label: 'Alerts & Incidents',
      icon: <AlertTriangle size={20} />,
      badge: alerts.filter((a) => !a.acknowledged).length,
    },
    {
      id: 'settings',
      label: 'System Config',
      icon: <Sliders size={20} />,
    },
  ];

  return (
    <aside
      style={{
        width: collapsed ? '68px' : '230px',
        flexShrink: 0,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: 40,
      }}
    >
      <div style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: collapsed ? '12px 0' : '10px 14px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: '10px',
                background: isActive
                  ? 'linear-gradient(90deg, rgba(0, 240, 255, 0.12) 0%, rgba(0, 240, 255, 0.03) 100%)'
                  : 'transparent',
                border: isActive
                  ? '1px solid rgba(0, 240, 255, 0.25)'
                  : '1px solid transparent',
                color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                position: 'relative',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = '#FFFFFF';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '20%',
                    bottom: '20%',
                    width: '3px',
                    borderRadius: '0 4px 4px 0',
                    background: 'var(--accent-cyan)',
                    boxShadow: '0 0 8px var(--accent-cyan)',
                  }}
                />
              )}

              <div style={{ flexShrink: 0 }}>{item.icon}</div>

              {!collapsed && (
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.label}
                </span>
              )}

              {!collapsed && item.badge !== undefined && item.badge > 0 && (
                <span
                  style={{
                    marginLeft: 'auto',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '10px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    background: item.id === 'alerts' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 240, 255, 0.15)',
                    color: item.id === 'alerts' ? '#F87171' : 'var(--accent-cyan)',
                    border: `1px solid ${item.id === 'alerts' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 240, 255, 0.3)'}`,
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse toggle button */}
      <div
        style={{
          padding: '12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}
      >
        <button
          onClick={onToggleCollapse}
          className="btn btn-secondary btn-sm"
          style={{ width: collapsed ? '38px' : 'auto', padding: '6px' }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};
