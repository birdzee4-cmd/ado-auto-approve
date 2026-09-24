import { useEffect, useState } from 'react';
import { disconnectAdo, loadAdoConnection } from './api';
import type { AdoConnectionStatus } from './types';

export function AdoConnection() {
  const [status, setStatus] = useState<AdoConnectionStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async (recover = false) => {
    setError('');
    try { setStatus(await loadAdoConnection(recover)); }
    catch (err) { setError((err as Error).message); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedFromConnect = params.get('adoConnected') === '1';
    refresh(returnedFromConnect);
    if (params.has('adoConnected') || params.has('adoError')) {
      params.delete('adoConnected');
      params.delete('adoError');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }, []);

  const connect = () => {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/operations.html';
    window.location.assign(`/api/ado-auth-start?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await disconnectAdo();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const identity = status?.adoIdentity;
  const label = identity?.email || identity?.displayName || status?.user || '';
  return <div className={`ops-ado-connection ${status?.connected ? 'is-connected' : 'is-disconnected'}`} aria-live="polite">
    <div><span>Azure DevOps</span><strong>{status === null && !error ? 'Checking…' : status?.connected ? `Connected as ${label}` : 'Not connected'}</strong>{error && <small>{error}</small>}{!error && !status?.connected && status?.reason && <small>{status.reason}</small>}</div>
    <div className="ops-ado-actions"><button type="button" onClick={connect}>{status?.connected ? 'Reconnect' : 'Connect'}</button>{status?.connected && <button type="button" onClick={disconnect} disabled={busy}>{busy ? 'Disconnecting…' : 'Disconnect'}</button>}</div>
  </div>;
}
