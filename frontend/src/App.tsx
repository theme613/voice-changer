/**
 * App.tsx — Main Application Component
 *
 * Manages the 3-screen flow:
 * 1. Upload & Process (UploadZone)
 * 2. Train Voice Profile (TrainForm)
 * 3. Real-Time Voice Changer (VoiceChanger)
 *
 * Uses a simple state machine with animated transitions.
 */

import { useState } from 'react';
import Sidebar, { type DashboardView } from './components/Sidebar';
import UploadZone from './components/UploadZone';
import TrainForm from './components/TrainForm';
import VoiceChanger from './components/VoiceChanger';
import VoiceProfilesPage from './components/VoiceProfilesPage';
import SettingsPage from './components/SettingsPage';
import DiagnosticsPage from './components/DiagnosticsPage';

export default function App() {
  const [currentView, setCurrentView] = useState<DashboardView>('voicechanger');
  const [datasetFiles, setDatasetFiles] = useState<string[]>([]);
  const [profileName, setProfileName] = useState<string>('');

  const handleUploadComplete = (files: string[]) => {
    setDatasetFiles(files);
  };

  const handleTrainComplete = (name: string) => {
    setProfileName(name);
    setCurrentView('voicechanger');
  };

  return (
    <div className="dashboard-layout">
      <Sidebar currentView={currentView} onChangeView={setCurrentView} />

      <main className="dashboard-main">
        <div className="dashboard-content-wrapper">
          {currentView === 'voicechanger' && (
            <VoiceChanger initialProfile={profileName} />
          )}

          {currentView === 'create_profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h2>Create Voice Profile</h2>
              {datasetFiles.length === 0 ? (
                <UploadZone onComplete={handleUploadComplete} />
              ) : (
                <TrainForm datasetFiles={datasetFiles} onComplete={handleTrainComplete} onCancel={() => setDatasetFiles([])} />
              )}
            </div>
          )}

          {currentView === 'voice_profiles' && <VoiceProfilesPage />}
          {currentView === 'settings' && <SettingsPage />}
          {currentView === 'diagnostics' && <DiagnosticsPage />}
        </div>
      </main>
    </div>
  );
}
