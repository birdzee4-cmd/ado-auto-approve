export type RouteId = 'dashboard' | 'incidents';

export type IncidentStatus = 'FIRING' | 'RESOLVED';
export type TrackingStatus = 'OPEN' | 'CLOSED' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'NOT_CREATED';

export interface CurrentUser {
  name: string;
  email: string;
  userRoles: string[];
  isAdmin: boolean;
}

export interface Incident {
  sharePointId?: number;
  displayId: string;
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
  createdAt?: string;
  resolvedAt?: string;
  durationMinutes?: number;
  lastAlertAt?: string;
  lastSeen: string;
  receivedAt?: string;
  lastSyncedAt?: string;
  workItemId?: number;
  workItemUrl?: string;
  adoState?: string;
  assignedTo?: string;
  adoCreatedAt?: string;
  adoClosedAt?: string;
  approvalAttempt?: number;
  approvalId?: string;
  approvalBy?: string;
  approvalComment?: string;
  approvalRequestedAt?: string;
  approvalCompletedAt?: string;
  occurrenceCount?: number;
  lastSourceMessageId?: string;
  flowRunId?: string;
  subscription?: string;
  resourceGroup?: string;
  appServicePlan?: string;
  defaultHost?: string;
  currentValue?: string;
  thresholdDetail?: string;
  alertSummary?: string;
  errorDetail?: string;
  source?: string;
}

export interface DashboardData {
  totalIncidents: number;
  adoWorkItems: number;
  openWorkItems: number;
  closedWorkItems: number;
  awaitingApproval: number;
  cancelledItems: number;
  failedItems: number;
  recentIncidents: Incident[];
  selectedDate: string;
  daily: {
    newIncidents: number;
    resolvedIncidents: number;
    adoCreated: number;
    failedIncidents: number;
    pendingApproval: number;
    openBacklog: number;
    incidents: Incident[];
  };
  dailySeries: Array<{ date: string; opened: number; resolved: number; failed: number }>;
  needsAttention: Incident[];
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
