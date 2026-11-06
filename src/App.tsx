import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { FmsProvider } from './context/FmsContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { EStopModal } from './components/layout/EStopModal';
import { DashboardView } from './components/dashboard/DashboardView';
import { DigitalTwinMap } from './components/map/DigitalTwinMap';
import { TrafficEditorView } from './components/traffic-editor/TrafficEditorView';
import { SetupWizard } from './components/setup/SetupWizard';
import { FleetsView } from './components/fleets/FleetsView';
import { TasksView } from './components/tasks/TasksView';
import { InfrastructureView } from './components/infrastructure/InfrastructureView';
import { AlertsView } from './components/alerts/AlertsView';
import { SettingsView } from './components/settings/SettingsView';
import './index.css';

const MainLayout: React.FC = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => window.innerWidth <= 1180);
  const [isEStopModalOpen, setIsEStopModalOpen] = useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024 && !isSidebarCollapsed) {
        setIsSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarCollapsed]);

  return (
    <div className="app-container">
      <Sidebar
        collapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <div className="main-content">
        <Header
          onOpenEStopModal={() => setIsEStopModalOpen(true)}
          onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        />
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route
            path="/overview"
            element={
              <div className="page-body">
                <DashboardView />
              </div>
            }
          />
          <Route
            path="/map"
            element={
              <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
                <DigitalTwinMap />
              </div>
            }
          />
          <Route
            path="/setup"
            element={
              <div className="page-body">
                <SetupWizard />
              </div>
            }
          />
          <Route
            path="/traffic-editor"
            element={
              <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
                <TrafficEditorView />
              </div>
            }
          />
          <Route
            path="/fleets"
            element={
              <div className="page-body">
                <FleetsView />
              </div>
            }
          />
          <Route
            path="/tasks"
            element={
              <div className="page-body">
                <TasksView />
              </div>
            }
          />
          <Route
            path="/infrastructure"
            element={
              <div className="page-body">
                <InfrastructureView />
              </div>
            }
          />
          <Route
            path="/alerts"
            element={
              <div className="page-body">
                <AlertsView />
              </div>
            }
          />
          <Route
            path="/settings"
            element={
              <div className="page-body">
                <SettingsView />
              </div>
            }
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </div>

      <EStopModal
        isOpen={isEStopModalOpen}
        onClose={() => setIsEStopModalOpen(false)}
      />
    </div>
  );
};

export default function App() {
  return (
    <FmsProvider>
      <MainLayout />
    </FmsProvider>
  );
}
