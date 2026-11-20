import type { Incident } from './types';

export function isOperationsClosed(item: Incident) {
  // A stale OperationsStatus=CLOSED must not hide an open child ticket.
  // Supporting work is authoritative for whether the incident can be treated
  // as completed in the explorer.
  return String(item.operationsStatus || '').toUpperCase() === 'CLOSED' && !hasOpenRelatedWork(item);
}

function hasOpenRelatedWork(item: Incident) {
  return item.workItems.some(workItem => workItem.role === 'RELATED' && !['CLOSED', 'DONE', 'REMOVED', 'RESOLVED', 'REJECT', 'REJECTED'].includes(String(workItem.state || '').trim().toUpperCase()));
}

export function isWaitingForAlertRecovery(item: Incident) {
  return !isOperationsClosed(item) && item.status === 'FIRING' && item.workItemSummary.total > 0 && item.workItemSummary.open === 0;
}

export function isWaitingForSupport(item: Incident) {
  // An open child ticket is the authoritative signal that a support team is
  // still working. Legacy primary metadata must not hide this queue.
  return !isOperationsClosed(item)
    && hasOpenRelatedWork(item);
}

export function isReadyToClose(item: Incident) {
  return !isOperationsClosed(item) && item.status === 'RESOLVED' && item.workItemSummary.total > 0 && item.workItemSummary.open === 0;
}

export function operationsStatus(item: Incident) {
  if (isOperationsClosed(item)) return 'CLOSED';
  if (item.hasLifecycleConflict && !isWaitingForAlertRecovery(item)) return 'NEEDS_REVIEW';
  if (isReadyToClose(item)) return 'READY_TO_CLOSE';
  if (isWaitingForAlertRecovery(item)) return 'WAITING_RESOLVED';
  if (isWaitingForSupport(item)) return 'FOLLOW_UP';
  return item.trackingStatus;
}
