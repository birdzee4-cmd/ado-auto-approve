export type RouteId = 'dashboard' | 'incidents' | 'mappings';

export type IncidentStatus = 'FIRING' | 'RESOLVED';
export type TrackingStatus = 'OPEN' | 'CLOSED' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'NOT_CREATED';

export interface CurrentUser {
  name: string;
  email: string;
  userRoles: string[];
  isAdmin: boolean;
}

export interface VerifiedAdoIdentity {
  id: string;
  descriptor: string;
  displayName: string;
  email: string;
  verified: true;
}

export interface AdoConnectionStatus {
  connected: boolean;
  user?: string;
  reason?: string;
  connectedAt?: string;
  expiresAt?: string;
  adoIdentity?: VerifiedAdoIdentity;
  operationsIdentity?: { id: string; email: string };
}

export interface OperationsCapabilities {
  createRelated: boolean;
  linkExisting: boolean;
  synchronize: boolean;
  closeIncident: boolean;
}

export type WorkItemRole = 'PRIMARY' | 'RELATED';
export type SupportTeam = 'TIER1' | 'APP_SUPPORT' | 'TIER2';

export interface IncidentWorkItem {
  sharePointId?: number;
  workItemId: number;
  incidentId: string;
  role: WorkItemRole;
  supportTeam?: SupportTeam;
  state: string;
  assignedTo?: string;
  url?: string;
  createdAt?: string;
  closedAt?: string;
  lastSyncedAt?: string;
  source: 'EXISTING_INCIDENT' | 'OPERATIONS_HUB_WORK_ITEMS';
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
  workItems: IncidentWorkItem[];
  workItemSummary: {
    total: number;
    closed: number;
    open: number;
  };
  recoveryConfirmed?: boolean;
  recoveryConfirmedBy?: string;
  recoveryConfirmedAt?: string;
  operationsStatus?: string;
  operationsClosedBy?: string;
  operationsClosedAt?: string;
  closeEligibility?: {
    allowed: boolean;
    blockingWorkItems: number[];
    reasons: string[];
  };
}

export interface ServiceMapping {
  sharePointId?: number;
  mappingId: string;
  service: string;
  alertNamePattern?: string;
  resourcePattern?: string;
  environment?: string;
  supportTeam: SupportTeam;
  adoProject: string;
  workItemType: string;
  areaPath: string;
  iterationPath?: string;
  assignedTeam: string;
  defaultTags?: string;
  enabled: boolean;
  priority: number;
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
