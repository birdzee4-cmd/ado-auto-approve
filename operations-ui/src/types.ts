export type RouteId = 'dashboard' | 'incidents';

export type IncidentStatus = 'FIRING' | 'RESOLVED';
export type TrackingStatus = 'OPEN' | 'CLOSED' | 'PENDING' | 'FAILED' | 'NOT_CREATED';

export interface CurrentUser {
  name: string;
  email: string;
  userRoles: string[];
  isAdmin: boolean;
}

export interface Incident {
  incidentId: string;
  alertName: string;
  resource: string;
  environment?: string;
  metric: string;
  severity: string;
  priority: string;
  status: IncidentStatus;
  workflowStatus: string;
  trackingStatus: TrackingStatus;
  approvalOutcome?: string;
  service?: string;
  firstSeen: string;
  lastSeen: string;
  receivedAt?: string;
  lastSyncedAt?: string;
  workItemId?: number;
  workItemUrl?: string;
  adoState?: string;
  assignedTo?: string;
  adoCreatedAt?: string;
  adoClosedAt?: string;
  errorDetail?: string;
  source?: string;
}

export interface DashboardData {
  totalIncidents: number;
  adoWorkItems: number;
  openWorkItems: number;
  closedWorkItems: number;
  awaitingApproval: number;
  failedItems: number;
  recentIncidents: Incident[];
  generatedAt?: string;
}

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  eventType: string;
  incidentId?: string;
  result: string;
  detail?: string;
}
