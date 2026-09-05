import { Mic2, Radio, FolderPlus, Library, Settings, Activity } from 'lucide-react';

export type DashboardView = 'voicechanger' | 'create_profile' | 'voice_profiles' | 'settings' | 'diagnostics';

interface SidebarProps {
  currentView: DashboardView;
  onChangeView: (view: DashboardView) => void;
}

export default function Sidebar({ currentView, onChangeView }: SidebarProps) {
  return (
    <div className="dashboard-sidebar">
      <div className="sidebar-title">
        <Mic2 size={24} />
        Voice Changer
      </div>

      <div 
        className={`sidebar-item ${currentView === 'voicechanger' ? 'active' : ''}`}
        onClick={() => onChangeView('voicechanger')}
      >
        <Radio size={18} />
        Voice Changer
      </div>

      <div 
        className={`sidebar-item ${currentView === 'create_profile' ? 'active' : ''}`}
        onClick={() => onChangeView('create_profile')}
      >
        <FolderPlus size={18} />
        Create Profile
      </div>
      
      <div 
        className={`sidebar-item ${currentView === 'voice_profiles' ? 'active' : ''}`}
        onClick={() => onChangeView('voice_profiles')}
      >
        <Library size={18} />
        Voice Profiles
      </div>

      <hr style={{ borderColor: 'var(--border-default)', margin: 'var(--space-2) 0', width: '100%', opacity: 0.3 }} />

      <div 
        className={`sidebar-item ${currentView === 'settings' ? 'active' : ''}`}
        onClick={() => onChangeView('settings')}
      >
        <Settings size={18} />
        Settings
      </div>

      <div 
        className={`sidebar-item ${currentView === 'diagnostics' ? 'active' : ''}`}
        onClick={() => onChangeView('diagnostics')}
      >
        <Activity size={18} />
        Diagnostics
      </div>

      <div style={{ marginTop: 'auto', padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
        Voice Changer App<br/>
        Running locally
      </div>
    </div>
  );
}
