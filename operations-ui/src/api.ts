import type { AdoConnectionStatus, AuditEvent, CurrentUser, DashboardData, Incident, OperationsCapabilities, ServiceMapping, SupportTeam } from './types';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  detail?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {})
    },
    redirect: 'manual'
  });

  if (response.type === 'opaqueredirect' || response.status === 0 || response.status === 302) {
    window.location.assign('/.auth/login/aad?post_login_redirect_uri=/operations.html');
    throw new Error('Authentication required');
  }

  const body = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.detail || body?.error || `Request failed (HTTP ${response.status})`) as Error & { status?: number; code?: string; data?: unknown; connectUrl?: string };
    error.status = response.status;
    error.code = body?.error;
    error.data = body?.data;
    error.connectUrl = (body as ApiEnvelope<T> & { connectUrl?: string })?.connectUrl;
    throw error;
  }
  return body.data as T;
}

export async function loadCurrentUser(): Promise<CurrentUser> {
  const response = await fetch('/api/userinfo', { redirect: 'manual' });
  if (!response.ok) throw new Error('Unable to load your user profile');
  const data = await response.json();
  const roles = Array.isArray(data.userRoles) ? data.userRoles : [];
  return {
    name: data.name || data.email || 'Authorized User',
    email: data.email || '',
    userRoles: roles,
    isAdmin: roles.some((role: string) => role.toLowerCase() === 'admin')
  };
}

export async function loadAdoConnection(recover = false): Promise<AdoConnectionStatus> {
  const response = await fetch(`/api/ado-auth-status${recover ? '?recover=1' : ''}`, {
    headers: { Accept: 'application/json' },
    redirect: 'manual'
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.detail || body?.error || 'Unable to check Azure DevOps connection');
  }
  return {
    connected: body.connected === true,
    user: body.user || '',
    reason: body.reason || '',
    connectedAt: body.connectedAt || '',
    expiresAt: body.expiresAt || '',
    adoIdentity: body.adoIdentity,
    operationsIdentity: body.operationsIdentity
  };
}

export async function disconnectAdo(): Promise<void> {
  const response = await fetch('/api/ado-auth-disconnect', {
    method: 'POST',
    headers: { Accept: 'application/json' }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || 'Unable to disconnect Azure DevOps');
}

export const operationsApi = {
  capabilities: () => request<OperationsCapabilities>('/api/operations/capabilities'),
  dashboard: (date = '') => request<DashboardData>(`/api/operations/dashboard${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  incidents: (status = '', search = '') => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (search) query.set('search', search);
    return request<{ items: Incident[]; count: number }>(`/api/operations/incidents?${query.toString()}`);
  },
  incident: (id: string) => request<{ incident: Incident; timeline: AuditEvent[] }>(`/api/operations/incidents/${encodeURIComponent(id)}`),
  mappings: () => request<{ items: ServiceMapping[]; count: number }>('/api/operations/mappings'),
  resolveMapping: (incidentId: string, supportTeam: SupportTeam) => request<{ mapping: ServiceMapping }>(`/api/operations/mappings/resolve?incidentId=${encodeURIComponent(incidentId)}&supportTeam=${encodeURIComponent(supportTeam)}`),
  createRelated: (incidentId: string, input: { supportTeam: SupportTeam; title?: string; detail?: string; idempotencyKey: string }) => request(`/api/operations/incidents/${encodeURIComponent(incidentId)}/work-items/related`, { method: 'POST', body: JSON.stringify(input) }),
  linkExisting: (incidentId: string, input: { supportTeam: SupportTeam; workItemId: number }) => request(`/api/operations/incidents/${encodeURIComponent(incidentId)}/work-items/link`, { method: 'POST', body: JSON.stringify(input) }),
  synchronize: (incidentId: string) => request(`/api/operations/incidents/${encodeURIComponent(incidentId)}/synchronize`, { method: 'POST', body: '{}' }),
  confirmRecovery: (incidentId: string, comment = '') => request(`/api/operations/incidents/${encodeURIComponent(incidentId)}/confirm-recovery`, { method: 'POST', body: JSON.stringify({ comment }) }),
  close: (incidentId: string) => request(`/api/operations/incidents/${encodeURIComponent(incidentId)}/close`, { method: 'POST', body: '{}' })
};
