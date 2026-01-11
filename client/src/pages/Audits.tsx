
import { useEffect, useState, useRef } from 'react';
import api from '../Api/apiClient';
import AuditTimeline from '../components/shared/AuditTimeline';
import type { AuditEvent } from '../components/shared/AuditTimeline';
import { fetchAuditEventsWithVerification } from '../utils/auditTimelineUtils';


type Audit = {
  id: number;
  record_type: string;
  object_id: number;
  record_hash: string;
  record_cid?: string | null;
  tx_hash?: string | null;
  created_at: string;
  user?: string;
};

export const Audits: React.FC = () => {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'onchain'>('timeline');
  const [actionLoading, setActionLoading] = useState<Record<number, string | null>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const fetchAudits = async () => {
    setLoading(true);
    try {
      const res = await api.get('/audits/');
      // DRF may return a plain list or a paginated object with `results`
      const data = Array.isArray(res.data) ? res.data : (res.data.results || res.data);

      // Deduplicate audits by record_hash (keep newest)
      const dedupeByHash = (items: any[]) => {
        const m = new Map<string, any>();
        items.forEach(it => {
          const key = it.record_hash || `${it.record_type}:${it.object_id}`;
          const existing = m.get(key);
          if (!existing) {
            m.set(key, it);
            return;
          }
          // prefer the newest created_at
          try {
            const a = new Date(it.created_at).getTime();
            const b = new Date(existing.created_at).getTime();
            if (!isNaN(a) && !isNaN(b)) {
              if (a > b) m.set(key, it);
            }
          } catch (e) {
            // fallback: keep existing
          }
        });
        return Array.from(m.values());
      };

      const deduped = dedupeByHash(data as any[]);
      setAudits(deduped as Audit[]);
    } catch (e) {
      console.error('Failed to load audits', e);
    } finally {
      setLoading(false);
    }
  };


  // Fetch audits and timeline events
  useEffect(() => {
    fetchAudits();
    fetchTimeline();
    // Setup WebSocket for real-time updates (if backend supports it)
    // Example: ws://localhost:8000/ws/audits/
    // Replace with your actual WebSocket endpoint
    // Use import.meta.env for Vite projects
    const wsUrl = import.meta.env.VITE_AUDIT_WS_URL || 'ws://localhost:8000/ws/audits/';
    try {
      wsRef.current = new window.WebSocket(wsUrl);
      wsRef.current.onmessage = () => {
        fetchAudits();
        fetchTimeline();
      };
      wsRef.current.onerror = (err) => {
        // Silently handle connection errors (backend may not support WebSocket)
        console.warn('WebSocket connection failed:', err);
      };
      wsRef.current.onclose = (evt) => {
        // Only warn if it closes before open
        if (evt.code !== 1000) {
          console.warn('WebSocket closed unexpectedly:', evt);
        }
      };
    } catch (e) {
      // WebSocket not available
      console.warn('WebSocket setup failed:', e);
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const fetchTimeline = async () => {
    try {
      const events = await fetchAuditEventsWithVerification();
      setTimelineEvents(events);
    } catch (e) {
      // ignore
    }
  };

  const verify = async (id: number) => {
    setActionLoading(prev => ({ ...prev, [id]: 'verify' }));
    try {
      // Prefer GET, but some backends may require POST for actions
      let res;
      try {
        res = await api.get(`/audits/${id}/verify/`);
      } catch (err: any) {
        if (err?.response?.status === 405) {
          res = await api.post(`/audits/${id}/verify/`);
        } else {
          throw err;
        }
      }
      await fetchAudits();
      alert(`On-chain: ${res?.data?.on_chain ? 'Yes' : 'No'}\nTx: ${res?.data?.tx_hash || '—'}`);
    } catch (e: any) {
      console.error('verify failed', e);
      alert((e?.response?.data?.detail) || 'Verification failed');
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  };

  const resend = async (id: number) => {
    setActionLoading(prev => ({ ...prev, [id]: 'resend' }));
    try {
      const res = await api.post(`/audits/${id}/resend/`);
      alert(`Resend tx: ${res?.data?.tx_hash || '—'}`);
      await fetchAudits();
    } catch (e: any) {
      console.error('resend failed', e);
      if (e?.response?.status === 503) {
        alert('Service unavailable: The backend is not running or the endpoint is down.');
      } else {
        alert(e?.response?.data?.detail || 'Resend failed');
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  };

  const storeCid = async (id: number) => {
    const cid = prompt('Enter CID (e.g., IPFS CID) to store on-chain for this audit:');
    if (!cid) return;
    setActionLoading(prev => ({ ...prev, [id]: 'storeCid' }));
    try {
      const res = await api.post(`/audits/${id}/store_cid/`, { cid });
      alert(`Stored. Tx: ${res?.data?.tx_hash || '—'}\nRecord ID: ${res?.data?.record_id || '—'}`);
      await fetchAudits();
    } catch (e: any) {
      console.error('storeCid failed', e);
      alert(e?.response?.data?.detail || 'Store CID failed');
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  };

  const viewCidContent = async (cid?: string | null) => {
    if (!cid) { alert('No CID available'); return; }
    try {
      const url = `https://ipfs.io/ipfs/${cid}`;
      const newWin = window.open(url, '_blank');
      if (!newWin) {
        // popup blocked, fetch and show a truncated preview
        const res = await fetch(url);
        if (!res.ok) {
          alert('Failed to fetch content from IPFS gateway');
          return;
        }
        const text = await res.text();
        alert(text.substring(0, 10000));
      }
    } catch (e) {
      console.error('fetch ipfs failed', e);
      alert('Failed to open or fetch IPFS content');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Audits</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">View audit timeline or on-chain audit records.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          {[
            { key: 'timeline', label: 'Audit Timeline' },
            { key: 'onchain', label: 'On-Chain Audits' }
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === key
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {activeTab === 'timeline' && (
          <div>
            <h3 className="text-lg font-semibold mb-2">Audit Timeline</h3>
            <AuditTimeline events={timelineEvents} />
          </div>
        )}

        {activeTab === 'onchain' && (
          <div>
            <h3 className="text-lg font-semibold mb-2">On-Chain Audits</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">List of recorded hashes and transaction status.</p>

            {loading ? (
              <div>Loading...</div>
            ) : (
              <div className="overflow-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Object</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Hash</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">CID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Tx</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {audits.map(a => (
                      <tr key={a.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{a.id}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{a.record_type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{a.object_id}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">{a.record_hash}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">{(a as any).record_cid || <span className="text-gray-400">-</span>}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{a.tx_hash || <span className="text-gray-400">-</span>}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                          <button
                            onClick={() => verify(a.id)}
                            disabled={!!actionLoading[a.id]}
                            className={`px-3 py-1 bg-sky-600 text-white rounded-md ${actionLoading[a.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {actionLoading[a.id] === 'verify' ? 'Verifying...' : 'Verify'}
                          </button>
                          {!a.tx_hash && (
                            <button
                              onClick={() => resend(a.id)}
                              disabled={!!actionLoading[a.id]}
                              className={`px-3 py-1 bg-amber-600 text-white rounded-md ${actionLoading[a.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {actionLoading[a.id] === 'resend' ? 'Resending...' : 'Resend'}
                            </button>
                          )}
                          <button
                            onClick={() => storeCid(a.id)}
                            disabled={!!actionLoading[a.id]}
                            className={`px-3 py-1 bg-emerald-600 text-white rounded-md ${actionLoading[a.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {actionLoading[a.id] === 'storeCid' ? 'Storing...' : 'Store CID'}
                          </button>
                          <button
                            onClick={() => viewCidContent((a as any).record_cid)}
                            disabled={!!actionLoading[a.id]}
                            className={`px-3 py-1 bg-gray-600 text-white rounded-md ${actionLoading[a.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {actionLoading[a.id] === 'view' ? 'Opening...' : 'View CID'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Audits;
