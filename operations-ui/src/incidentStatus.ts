import type { Incident } from './types';

export function isOperationsClosed(item: Incident) {
  return String(item.operationsStatus || '').toUpperCase() === 'CLOSED';
}

export function isWaitingForAlertRecovery(item: Incident) {
  return !isOperationsClosed(item) && item.status === 'FIRING' && item.workItemSummary.total > 0 && item.workItemSummary.open === 0;
}

export function isWaitingForSupport(item: Incident) {
  return !isOperationsClosed(item)
    && !['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)
    && item.workItems.some(workItem => workItem.role === 'RELATED' && !['CLOSED', 'DONE', 'REMOVED', 'RESOLVED', 'REJECT', 'REJECTED'].includes(String(workItem.state || '').trim().toUpperCase()));
}

export function isReadyToClose(item: Incident) {
  return !isOperationsClosed(item) && item.status === 'RESOLVED' && item.workItemSummary.total > 0 && item.workItemSummary.open === 0;
}

export function operationsStatus(item: Incident) {
  if (isOperationsClosed(item)) return 'CLOSED';
  if (item.hasLifecycleConflict && !isWaitingForAlertRecovery(item)) return 'NEEDS_REVIEW';
  if (isReadyToClose(item)) return 'READY_TO_CLOSE';
  if (isWaitingForAlertRecovery(item)) return 'WAITING_RESOLVED';
  if (isWaitingForSupport(item)) return 'WAITING_SUPPORT';
  return item.trackingStatus;
}
