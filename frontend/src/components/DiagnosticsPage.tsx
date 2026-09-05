import { useState, useEffect } from 'react';
import { getDiagnostics, getLogs, fixDiagnostics, getTrainerLogs, type TrainerLogsResult } from '../api';
import { Activity, CheckCircle, AlertTriangle, XCircle, Terminal, RefreshCw, Copy, FileText } from 'lucide-react';

export default function DiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trainerLogs, setTrainerLogs] = useState<TrainerLogsResult | null>(null);
  const [showTrainerLogs, setShowTrainerLogs] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [diagData, logData] = await Promise.all([
        getDiagnostics(),
        getLogs(100)
      ]);
      setDiagnostics(diagData);
      setLogs(logData.logs);
    } catch (err: any) {
      setError(`Failed to load diagnostics: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadTrainerLogs = async () => {
    try {
      const logs = await getTrainerLogs(200);
      setTrainerLogs(logs);
    } catch { /* ignore */ }
  };

  const [fixing, setFixing] = useState<string | null>(null);

  const handleFix = async (key: string) => {
    setFixing(key);
    try {
      const response = await fixDiagnostics(key);
      alert(response.message || 'Started fixing process...');
    } catch (err: any) {
      alert(`Fix failed: ${err.message}`);
    } finally {
      setFixing(null);
      // reload data after a delay to give download a chance to start
      setTimeout(() => loadData(), 2000);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
      case 'connected':
        return <CheckCircle size={20} color="var(--success-green)" />;
      case 'warning':
        return <AlertTriangle size={20} color="var(--warning-yellow)" />;
      case 'missing':
      case 'error':
        return <XCircle size={20} color="var(--error-red)" />;
      default:
        return <Activity size={20} color="gray" />;
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join(''));
    alert('Logs copied to clipboard!');
  };

  if (loading) {
    return <div style={{ padding: '24px' }}>Running diagnostics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--error-red)' }}>
        <h2>Diagnostics Failed</h2>
        <p>{error}</p>
        <button className="btn-primary" onClick={loadData}>Retry</button>
      </div>
    );
  }

  // Extract training_output diagnostic for special rendering
  const trainingOutput = diagnostics?.training_output;

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity className="icon" size={24} /> System Diagnostics
        </h2>
        <button className="btn-secondary" onClick={loadData} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={16} /> Run Checks
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {/* System Health Cards */}
        {diagnostics && Object.entries(diagnostics).filter(([key]) => key !== 'training_output').map(([key, info]: [string, any]) => (
          <div key={key} className="card" style={{ padding: '16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <strong style={{ textTransform: 'capitalize' }}>{key.replace('_', ' ')}</strong>
              {getStatusIcon(info.status)}
            </div>
            
            {info.version && <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Version: {info.version}</div>}
            {info.gpu && <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>GPU: {info.gpu}</div>}
            {info.vram_free_gb !== undefined && info.vram_free_gb !== null && <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>VRAM free: {info.vram_free_gb} GB</div>}
            {info.pid !== undefined && <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>PID: {info.pid} (Port: {info.port})</div>}
            {info.executable && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px', wordBreak: 'break-all' }}>Executable: {info.executable}</div>}
            {info.path && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px', wordBreak: 'break-all' }}>Path: {info.path}</div>}
            {info.health_check_result && <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Health Check: {info.health_check_result}</div>}
            {info.endpoint_mismatch && <div style={{ fontSize: '14px', color: 'var(--error-red)', marginBottom: '4px', fontWeight: 'bold' }}>Endpoint Mismatch: Service on port {info.port} is not the correct voice-changer engine.</div>}
            {info.message && <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{info.message}</div>}
            
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              {info.status === 'missing' && key !== 'external_trainer' && (
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1, opacity: fixing === key ? 0.5 : 1 }} 
                  onClick={() => handleFix(key)}
                  disabled={fixing === key}
                >
                  {fixing === key ? 'Fixing...' : 'Fix / Download'}
                </button>
              )}
              {info.status === 'missing' && key === 'external_trainer' && (
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => window.location.hash = 'settings'}
                >
                  Configure in Settings → Browse
                </button>
              )}
              {info.path && (
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => window.open(`file:///${info.path.replace(/\\/g, '/')}`)}
                >
                  Open Folder
                </button>
              )}
              {info.status === 'error' && (
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => {
                    navigator.clipboard.writeText(`${key} Error: ${info.message}`);
                    alert('Error copied to clipboard');
                  }}
                >
                  Copy Error
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Training Output Card — Special expanded view */}
      {trainingOutput && (
        <div className="card" style={{
          padding: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px',
          border: `1px solid ${trainingOutput.status === 'error' ? 'var(--error-red)' : trainingOutput.status === 'warning' ? 'var(--warning-yellow)' : 'var(--border-default)'}`,
          marginBottom: '32px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={18} /> Training Output
              {getStatusIcon(trainingOutput.status)}
            </h3>
            <button
              className="btn-secondary"
              style={{ fontSize: '12px', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={async () => {
                if (!showTrainerLogs) await loadTrainerLogs();
                setShowTrainerLogs(!showTrainerLogs);
              }}
            >
              <Terminal size={14} />
              {showTrainerLogs ? 'Hide Applio Logs' : 'Show Applio Logs'}
            </button>
          </div>

          {trainingOutput.path && (
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px', wordBreak: 'break-all' }}>
              Path: {trainingOutput.path}
            </div>
          )}

          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            {trainingOutput.message}
          </div>

          {/* Per-model details */}
          {trainingOutput.models && trainingOutput.models.length > 0 && (
            <div style={{ display: 'grid', gap: '12px' }}>
              {trainingOutput.models.map((model: any, i: number) => (
                <div key={i} style={{
                  padding: '12px', borderRadius: '6px',
                  backgroundColor: model.verdict === 'model_ready'
                    ? 'rgba(52,211,153,0.06)'
                    : model.verdict === 'preprocessing_only'
                      ? 'rgba(239,68,68,0.06)'
                      : 'rgba(245,158,11,0.06)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px' }}>{model.name}</strong>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                      backgroundColor: model.verdict === 'model_ready' ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)',
                      color: model.verdict === 'model_ready' ? 'var(--accent-green)' : 'var(--accent-red)',
                      fontWeight: 600,
                    }}>
                      {model.verdict === 'model_ready' ? 'Ready' :
                       model.verdict === 'preprocessing_only' ? 'No Model' :
                       model.verdict === 'training_incomplete' ? 'Incomplete' :
                       model.verdict === 'checkpoints_only' ? 'Not Exported' :
                       model.verdict}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                    {model.verdict_message}
                  </div>
                  {/* Phase pills */}
                  {model.phases && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {Object.entries(model.phases).filter(([k]) => k !== 'dir_exists').map(([phase, done]) => (
                        <span key={phase} style={{
                          fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                          backgroundColor: done ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
                          color: done ? 'var(--accent-green)' : 'var(--text-tertiary)',
                          border: `1px solid ${done ? 'rgba(52,211,153,0.25)' : 'var(--border-subtle)'}`,
                        }}>
                          {done ? '✓' : '✗'} {phase.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                    .pth files: {model.pth_count} · .index files: {model.index_count}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Applio Training Logs */}
          {showTrainerLogs && (
            <div style={{
              marginTop: '16px', padding: '12px', backgroundColor: '#000',
              borderRadius: '6px', maxHeight: '300px', overflowY: 'auto',
              fontFamily: 'monospace', fontSize: '11px', color: '#aaa',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#666', fontSize: '10px' }}>
                  Applio Process Logs {trainerLogs?.process_running ? '(running)' : '(not running)'}
                  {trainerLogs?.process_pid ? ` · PID ${trainerLogs.process_pid}` : ''}
                </span>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '10px', padding: '2px 6px' }}
                  onClick={() => {
                    const text = [
                      '=== Process Log ===',
                      ...(trainerLogs?.process_log || []),
                      '',
                      ...(trainerLogs?.disk_logs?.flatMap(dl => [
                        `=== ${dl.name} ===`,
                        ...dl.lines,
                      ]) || []),
                    ].join('\n');
                    navigator.clipboard.writeText(text);
                    alert('Logs copied to clipboard!');
                  }}
                >
                  <Copy size={10} style={{ marginRight: '3px' }} /> Copy All
                </button>
              </div>
              {(trainerLogs?.process_log?.length || 0) > 0 ? (
                trainerLogs!.process_log.map((line, i) => (
                  <div key={i} style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    color: line.toLowerCase().includes('error') ? '#ef4444'
                      : line.toLowerCase().includes('warning') ? '#f59e0b'
                      : line.includes('epoch=') || line.includes('Epoch') ? '#34d399'
                      : '#aaa',
                  }}>{line}</div>
                ))
              ) : (
                <div style={{ color: '#555' }}>
                  No process logs captured. Launch the trainer from the Training tab to capture output.
                </div>
              )}
              {/* Disk-based logs */}
              {trainerLogs?.disk_logs?.map((dl, i) => (
                <div key={`disk-${i}`} style={{ marginTop: '12px' }}>
                  <div style={{ color: '#4f8cff', fontSize: '10px', marginBottom: '4px' }}>
                    — {dl.name} ({dl.total_lines} lines) —
                  </div>
                  {dl.lines.slice(-30).map((line, j) => (
                    <div key={j} style={{
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      color: line.toLowerCase().includes('error') ? '#ef4444'
                        : line.toLowerCase().includes('warning') ? '#f59e0b'
                        : '#888',
                    }}>{line}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Engine Diagnostics View */}
      {diagnostics && diagnostics.engine_diagnostics && (
        <div className="card" style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-default)', marginBottom: '24px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} /> Engine Diagnostics (Startup)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                <div><strong>Sidecar PID:</strong> {diagnostics.engine_diagnostics.sidecar_pid || 'None'}</div>
                <div><strong>Port Owner:</strong> {diagnostics.engine_diagnostics.port_owner || 'None'}</div>
                <div><strong>Native Client PID:</strong> {diagnostics.engine_diagnostics.native_client_pid || 'None'}</div>
                <div><strong>GUI Suppressed:</strong> {diagnostics.engine_diagnostics.gui_suppressed ? 'Yes ✅' : 'No ❌'}</div>
            </div>
            <div style={{ marginTop: '12px', fontSize: '13px' }}>
                <strong>Launch Args:</strong>
                <pre style={{ backgroundColor: '#000', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: '4px 0 0 0', color: '#ccc' }}>
                    {JSON.stringify(diagnostics.engine_diagnostics.launch_args, null, 2)}
                </pre>
            </div>
            {diagnostics.engine_diagnostics.active_settings && (
                <div style={{ marginTop: '12px', fontSize: '13px' }}>
                    <strong>Active Settings:</strong>
                    <pre style={{ backgroundColor: '#000', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: '4px 0 0 0', color: '#ccc' }}>
                        {JSON.stringify(diagnostics.engine_diagnostics.active_settings, null, 2)}
                    </pre>
                </div>
            )}
        </div>
      )}

      {/* Logs View */}
      <div className="card" style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', height: '400px' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}><Terminal size={18} /> Backend Logs</h3>
          <button className="btn-secondary" onClick={copyLogs} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px' }}>
            <Copy size={14} /> Copy All
          </button>
        </div>
        <div style={{ padding: '16px', overflowY: 'auto', flex: 1, backgroundColor: '#000', fontFamily: 'monospace', fontSize: '12px', color: '#ccc' }}>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No logs available.</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <span style={{ color: log.includes('ERROR') ? 'var(--error-red)' : log.includes('WARNING') ? 'var(--warning-yellow)' : 'inherit' }}>
                  {log}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
