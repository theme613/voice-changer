import { useState, useEffect } from 'react';
import { getProfiles, deleteProfile, importProfileLocal, browseFile, type VoiceProfile } from '../api';
import { Trash2, Plus, RefreshCw, UploadCloud, FolderOpen } from 'lucide-react';

export default function VoiceProfilesPage() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importForm, setImportForm] = useState({ name: '', pth: '', index: '' });

  const loadProfiles = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getProfiles();
      setProfiles(res.profiles);
    } catch (err: any) {
      setError(`Failed to load profiles: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete profile "${name}"?`)) return;
    try {
      await deleteProfile(name);
      loadProfiles();
    } catch (err: any) {
      alert(`Failed to delete profile: ${err.message}`);
    }
  };

  const handleBrowsePth = async () => {
    try {
      const path = await browseFile('pth');
      setImportForm({ ...importForm, pth: path });
    } catch (e) {
      console.error(e);
    }
  };

  const handleBrowseIndex = async () => {
    try {
      const path = await browseFile('index');
      setImportForm({ ...importForm, index: path });
    } catch (e) {
      console.error(e);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importForm.name || !importForm.pth) {
      setImportMsg('Name and .pth file are required.');
      return;
    }
    setImporting(true);
    setImportMsg('Importing profile...');
    try {
      await importProfileLocal(importForm.name, importForm.pth, importForm.index || null, true);
      setImportMsg('Profile imported successfully!');
      setTimeout(() => {
        setShowImportDialog(false);
        setImportForm({ name: '', pth: '', index: '' });
        setImportMsg('');
        loadProfiles();
      }, 1500);
    } catch (err: any) {
      setImportMsg(`Error: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0 }}>Voice Profiles</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={loadProfiles} 
            className="btn-secondary" 
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button 
            onClick={() => setShowImportDialog(true)} 
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Plus size={16} /> Add Profile
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', backgroundColor: 'rgba(255, 50, 50, 0.1)', color: '#ff4444', borderRadius: '8px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {showImportDialog && (
        <div style={{ padding: '20px', backgroundColor: 'var(--surface-color, #1e1e24)', borderRadius: '12px', marginBottom: '24px', border: '1px solid var(--border-color, #333)' }}>
          <h3>Import Voice Profile</h3>
          <form onSubmit={handleImportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px' }}>Profile Name</label>
              <input 
                type="text" 
                value={importForm.name} 
                onChange={(e) => setImportForm({...importForm, name: e.target.value})}
                placeholder="My Character"
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#111', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px' }}>.pth Model File</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  value={importForm.pth} 
                  readOnly
                  placeholder="Select a .pth file"
                  style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#aaa' }}
                />
                <button type="button" onClick={handleBrowsePth} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><FolderOpen size={16} /> Browse</button>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px' }}>.index File (Optional)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  value={importForm.index} 
                  readOnly
                  placeholder="Select an .index file (optional)"
                  style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#aaa' }}
                />
                <button type="button" onClick={handleBrowseIndex} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><FolderOpen size={16} /> Browse</button>
              </div>
            </div>
            
            {importMsg && (
              <div style={{ color: importMsg.startsWith('Error') ? '#ff4444' : '#44ff44' }}>
                {importMsg}
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button type="button" onClick={() => setShowImportDialog(false)} className="btn-secondary" disabled={importing}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={importing || !importForm.name || !importForm.pth}>
                <UploadCloud size={16} style={{ marginRight: '6px' }} /> {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p>Loading profiles...</p>
      ) : profiles.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', backgroundColor: 'var(--surface-color, #1e1e24)', borderRadius: '12px' }}>
          <p style={{ color: '#aaa', marginBottom: '16px' }}>No voice profiles found.</p>
          <button onClick={() => setShowImportDialog(true)} className="btn-primary">Import Your First Profile</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {profiles.map((p) => (
            <div key={p.name} style={{ padding: '16px', backgroundColor: 'var(--surface-color, #1e1e24)', borderRadius: '12px', border: '1px solid var(--border-color, #333)', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1.2rem' }}>{p.name}</h3>
              <div style={{ color: '#aaa', fontSize: '0.9rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div><strong>Size:</strong> {p.size_mb.toFixed(1)} MB</div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.model_path}>
                  <strong>Path:</strong> {p.model_path.split(/[\\/]/).pop()}
                </div>
              </div>
              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  onClick={() => handleDelete(p.name)} 
                  style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '4px' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 68, 68, 0.1)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
