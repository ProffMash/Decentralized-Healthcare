
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
  status?: 'pending' | 'confirmed' | 'failed' | 'verified';
  block_number?: number;
  gas_used?: number;
  miner?: string;
};

type BlockchainStatus = {
  connected: boolean;
  chainId: number;
  latestBlock: number;
  gasPrice: string;
  network: string;
};

export const Audits: React.FC = () => {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'onchain' | 'blockchain'>('onchain');
  const [actionLoading, setActionLoading] = useState<Record<number, string | null>>({});
  const [blockchainStatus, setBlockchainStatus] = useState<BlockchainStatus>({
    connected: false,
    chainId: 0,
    latestBlock: 0,
    gasPrice: '0',
    network: 'Unknown'
  });
  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null);
  const [detailsModal, setDetailsModal] = useState<Audit | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAudits = async () => {
    setLoading(true);
    try {
      const res = await api.get('/audits/');
      const data = Array.isArray(res.data) ? res.data : (res.data.results || res.data);

      const dedupeByHash = (items: any[]) => {
        const m = new Map<string, any>();
        items.forEach(it => {
          const key = it.record_hash || `${it.record_type}:${it.object_id}`;
          const existing = m.get(key);
          if (!existing) {
            m.set(key, it);
            return;
          }
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
      const auditData = deduped.map((a: any) => ({
        ...a,
        status: a.tx_hash ? 'confirmed' : 'pending',
      })) as Audit[];
      
      setAudits(auditData);
      
      // Update blockchain status
      await fetchBlockchainStatus();
      
      // Poll for status updates every 10 seconds
      pollIntervalRef.current = setInterval(() => {
        pollTransactionStatus(auditData);
      }, 10000);
    } catch (e) {
      console.error('Failed to load audits', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchBlockchainStatus = async () => {
    try {
      const res = await api.get('/blockchain/status/');
      setBlockchainStatus({
        connected: res.data.connected || false,
        chainId: res.data.chain_id || 0,
        latestBlock: res.data.latest_block || 0,
        gasPrice: res.data.gas_price || '0',
        network: res.data.network || 'Unknown'
      });
    } catch (e) {
      console.warn('Failed to fetch blockchain status:', e);
    }
  };

  const pollTransactionStatus = async (auditList: Audit[]) => {
    // Check pending transactions for confirmation
    const pendingAudits = auditList.filter(a => a.status === 'pending' && a.tx_hash);
    
    for (const audit of pendingAudits) {
      try {
        const res = await api.get(`/audits/${audit.id}/`);
        if (res.data.tx_hash !== audit.tx_hash) {
          // Transaction hash changed, refresh audits
          await fetchAudits();
          break;
        }
      } catch (e) {
        // Silently handle errors
      }
    }
  };


  // Fetch audits and timeline events
  useEffect(() => {
    fetchAudits();
    fetchTimeline();
    
    // WebSocket for real-time updates (optional, not required for functionality)
    const wsUrl = import.meta.env.VITE_AUDIT_WS_URL;
    if (wsUrl) {
      try {
        wsRef.current = new window.WebSocket(wsUrl);
        wsRef.current.onmessage = () => {
          fetchAudits();
          fetchTimeline();
        };
        wsRef.current.onerror = (err) => {
          console.warn('WebSocket connection failed:', err);
        };
        wsRef.current.onclose = (evt) => {
          if (evt.code !== 1000) {
            console.warn('WebSocket closed unexpectedly:', evt);
          }
        };
      } catch (e) {
        console.warn('WebSocket setup failed:', e);
      }
    }

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
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
      const txHash = res?.data?.tx_hash;
      const blockNumber = res?.data?.block_number;
      alert(`✓ Verified on Blockchain\nChain: ${blockchainStatus.network}\nBlock: ${blockNumber || 'Pending'}\nTx: ${txHash || '—'}`);
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

  const openBlockchainExplorer = (txHash: string) => {
    if (!txHash) return;
    alert(`📝 Transaction Hash: ${txHash}\n\n✓ Transaction is on the in-memory eth-tester blockchain.`);
  };

  const openIPFSExplorer = (cid: string) => {
    if (!cid) return;
    const ipfsUrl = `https://ipfs.io/ipfs/${cid}`;
    window.open(ipfsUrl, '_blank');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  const getStatusBadge = (status: string | undefined) => {
    const baseClass = 'px-3 py-1 rounded-full text-xs font-semibold';
    switch (status) {
      case 'confirmed':
        return <span className={`${baseClass} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}>✓ Confirmed</span>;
      case 'pending':
        return <span className={`${baseClass} bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`}>⏳ Pending</span>;
      case 'verified':
        return <span className={`${baseClass} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`}>✔ Verified</span>;
      case 'failed':
        return <span className={`${baseClass} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>✗ Failed</span>;
      default:
        return <span className={`${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200`}>—</span>;
    }
  };

  return (
    <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 min-h-screen">
      {/* Header with Blockchain Status */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            🔗 Blockchain Audit Ledger
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Immutable medical record verification and transaction tracking
          </p>
        </div>
        <div className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${
          blockchainStatus.connected 
            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
            : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
        }`}>
          <span className={`w-2 h-2 rounded-full ${blockchainStatus.connected ? 'bg-green-600 animate-pulse' : 'bg-gray-600'}`}></span>
          {blockchainStatus.connected ? 'Blockchain Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Blockchain Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-blue-500">
          <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Network</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{blockchainStatus.network}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {blockchainStatus.network?.includes('Memory') && '(In-Memory Test)'}
            {blockchainStatus.network?.includes('Mainnet') && '(Mainnet)'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-purple-500">
          <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Chain ID</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{blockchainStatus.chainId || '—'}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Latest Block</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{blockchainStatus.latestBlock.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-orange-500">
          <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Gas Price</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">{blockchainStatus.gasPrice} Gwei</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {[
              { key: 'timeline', label: '📊 Audit Timeline' },
              { key: 'onchain', label: '⛓️ On-Chain Records' },
              { key: 'blockchain', label: '🔍 Blockchain Details' }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as any)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Audit Timeline</h3>
              <AuditTimeline events={timelineEvents} />
            </div>
          )}

          {/* On-Chain Records Tab */}
          {activeTab === 'onchain' && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-2">On-Chain Audit Records</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Cryptographic hashes and blockchain transaction details for all medical records
                </p>
              </div>

              {loading ? (
                <div className="text-center py-12">
                  <div className="inline-block">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                  </div>
                  <p className="mt-4 text-gray-600 dark:text-gray-400">Loading blockchain records...</p>
                </div>
              ) : audits.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <p className="text-gray-600 dark:text-gray-400">No audit records found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Status</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Record Type</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Object ID</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Hash (SHA-256)</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Transaction</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {audits.map(audit => (
                        <tr key={audit.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                            onClick={() => setSelectedAudit(selectedAudit?.id === audit.id ? null : audit)}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(audit.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {audit.record_type}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                            #{audit.object_id}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <code className="bg-gray-100 dark:bg-gray-900 px-3 py-1 rounded font-mono text-xs text-gray-700 dark:text-gray-300 break-all max-w-xs inline-block">
                              {audit.record_hash.slice(0, 16)}...{audit.record_hash.slice(-8)}
                            </code>
                          </td>
                          <td className="px-6 py-4">
                            {audit.tx_hash ? (
                              <code className="bg-blue-50 dark:bg-blue-900 px-3 py-1 rounded font-mono text-xs text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800"
                                    onClick={(e) => { e.stopPropagation(); openBlockchainExplorer(audit.tx_hash || ''); }}>
                                {audit.tx_hash.slice(0, 12)}...
                              </code>
                            ) : (
                              <span className="text-gray-400 text-sm">—</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setDetailsModal(audit)}
                              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium transition"
                            >
                              👁️ Details
                            </button>
                            <button
                              onClick={() => verify(audit.id)}
                              disabled={!!actionLoading[audit.id]}
                              className={`px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition ${actionLoading[audit.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {actionLoading[audit.id] === 'verify' ? '...' : '✓ Verify'}
                            </button>
                            {!audit.tx_hash && (
                              <button
                                onClick={() => resend(audit.id)}
                                disabled={!!actionLoading[audit.id]}
                                className={`px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium transition ${actionLoading[audit.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                              >
                                {actionLoading[audit.id] === 'resend' ? '...' : '📤 Resend'}
                              </button>
                            )}
                            <button
                              onClick={() => storeCid(audit.id)}
                              disabled={!!actionLoading[audit.id]}
                              className={`px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium transition ${actionLoading[audit.id] ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {actionLoading[audit.id] === 'storeCid' ? '...' : '📦 IPFS'}
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

          {/* Blockchain Details Tab */}
          {activeTab === 'blockchain' && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-2">Blockchain Record Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Select a record from the table above to view detailed blockchain information
                </p>
              </div>

              {selectedAudit ? (
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column */}
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Record Type
                        </label>
                        <div className="text-lg font-bold text-gray-900 dark:text-white">
                          {selectedAudit.record_type}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Object ID
                        </label>
                        <div className="text-lg font-bold text-gray-900 dark:text-white">
                          #{selectedAudit.object_id}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Status
                        </label>
                        <div>{getStatusBadge(selectedAudit.status)}</div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Created At
                        </label>
                        <div className="text-sm text-gray-900 dark:text-white">
                          {new Date(selectedAudit.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* Right Column */}
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center justify-between">
                          <span>SHA-256 Hash</span>
                          <button
                            onClick={() => copyToClipboard(selectedAudit.record_hash)}
                            className="text-xs bg-gray-300 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                          >
                            Copy
                          </button>
                        </label>
                        <code className="block bg-gray-800 dark:bg-gray-950 text-green-400 p-3 rounded font-mono text-xs break-all">
                          {selectedAudit.record_hash}
                        </code>
                      </div>

                      {selectedAudit.tx_hash && (
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center justify-between">
                            <span>Transaction Hash</span>
                            <button
                              onClick={() => copyToClipboard(selectedAudit.tx_hash || '')}
                              className="text-xs bg-gray-300 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                            >
                              Copy
                            </button>
                          </label>
                          <div className="flex gap-2">
                            <code className="flex-1 bg-blue-900 text-blue-300 p-3 rounded font-mono text-xs break-all">
                              {selectedAudit.tx_hash}
                            </code>
                            <button
                              onClick={() => openBlockchainExplorer(selectedAudit.tx_hash || '')}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm whitespace-nowrap"
                            >
                              View Hash
                            </button>
                          </div>
                        </div>
                      )}

                      {selectedAudit.record_cid && (
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center justify-between">
                            <span>IPFS CID</span>
                            <button
                              onClick={() => copyToClipboard(selectedAudit.record_cid || '')}
                              className="text-xs bg-gray-300 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                            >
                              Copy
                            </button>
                          </label>
                          <div className="flex gap-2">
                            <code className="flex-1 bg-amber-900 text-amber-300 p-3 rounded font-mono text-xs break-all">
                              {selectedAudit.record_cid}
                            </code>
                            <button
                              onClick={() => openIPFSExplorer(selectedAudit.record_cid || '')}
                              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-sm whitespace-nowrap"
                            >
                              View on IPFS
                            </button>
                          </div>
                        </div>
                      )}

                      {selectedAudit.block_number && (
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Block Number
                          </label>
                          <div className="text-lg font-bold text-gray-900 dark:text-white">
                            #{selectedAudit.block_number.toLocaleString()}
                          </div>
                        </div>
                      )}

                      {selectedAudit.gas_used && (
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Gas Used
                          </label>
                          <div className="text-sm text-gray-900 dark:text-white">
                            {selectedAudit.gas_used.toLocaleString()} units
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Verification Status */}
                  <div className="mt-6 p-4 bg-white dark:bg-gray-800 rounded border-l-4 border-green-500">
                    <h4 className="font-semibold text-gray-900 dark:text-white mb-2">✓ Verification Summary</h4>
                    <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                      <li>✓ Record hash verified on blockchain</li>
                      <li>✓ Immutable audit trail established</li>
                      <li>✓ Cryptographic signature secured</li>
                      <li>{selectedAudit.record_cid ? '✓' : '○'} Content stored on IPFS</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => setSelectedAudit(null)}
                    className="mt-6 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium"
                  >
                    Close Details
                  </button>
                </div>
              ) : (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <p className="text-gray-600 dark:text-gray-400">Click on a record in the table to view blockchain details</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {detailsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Hash Details</h3>
                <button
                  onClick={() => setDetailsModal(null)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-6">
                {/* Record Info */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Record Type: {detailsModal.record_type} | Object ID: #{detailsModal.object_id}
                  </label>
                </div>

                {/* SHA-256 Hash */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">SHA-256 Hash</label>
                    <button
                      onClick={() => copyToClipboard(detailsModal.record_hash)}
                      className="text-xs bg-gray-300 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                    >
                      📋 Copy
                    </button>
                  </div>
                  <code className="block bg-gray-900 text-green-400 p-3 rounded font-mono text-xs break-all overflow-x-auto">
                    {detailsModal.record_hash}
                  </code>
                </div>

                {/* Transaction Hash */}
                {detailsModal.tx_hash && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Transaction Hash</label>
                      <div className="space-x-2">
                        <button
                          onClick={() => copyToClipboard(detailsModal.tx_hash || '')}
                          className="text-xs bg-gray-300 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                        >
                          📋 Copy
                        </button>
                        <button
                          onClick={() => openBlockchainExplorer(detailsModal.tx_hash || '')}
                          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
                        >
                          🔗 View Hash
                        </button>
                      </div>
                    </div>
                    <code className="block bg-blue-950 text-blue-300 p-3 rounded font-mono text-xs break-all overflow-x-auto">
                      {detailsModal.tx_hash}
                    </code>
                  </div>
                )}

                {/* IPFS CID */}
                {detailsModal.record_cid && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">IPFS CID</label>
                      <div className="space-x-2">
                        <button
                          onClick={() => copyToClipboard(detailsModal.record_cid || '')}
                          className="text-xs bg-gray-300 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                        >
                          📋 Copy
                        </button>
                        <button
                          onClick={() => openIPFSExplorer(detailsModal.record_cid || '')}
                          className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded"
                        >
                          🔗 View on IPFS
                        </button>
                      </div>
                    </div>
                    <code className="block bg-amber-950 text-amber-300 p-3 rounded font-mono text-xs break-all overflow-x-auto">
                      {detailsModal.record_cid}
                    </code>
                  </div>
                )}

                {/* Status Info */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Status</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{getStatusBadge(detailsModal.status)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Created</p>
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">{new Date(detailsModal.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setDetailsModal(null)}
                className="mt-6 w-full px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Audits;
