import type { AuditEvent, CurrentUser, DashboardData, Incident } from './types';

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
    throw new Error(body?.detail || body?.error || `Request failed (HTTP ${response.status})`);
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

export const operationsApi = {
  dashboard: () => request<DashboardData>('/api/operations/dashboard'),
  incidents: (status = '', search = '') => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (search) query.set('search', search);
    return request<{ items: Incident[]; count: number }>(`/api/operations/incidents?${query.toString()}`);
  },
  incident: (id: string) => request<{ incident: Incident; timeline: AuditEvent[] }>(`/api/operations/incidents/${encodeURIComponent(id)}`)
};
