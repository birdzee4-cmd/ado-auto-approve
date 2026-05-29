function buildAttention(pr, approval, statusSnapshot, isMergeCodeTarget) {
  const createdMs = Date.parse(pr && pr.creationDate || '');
  const ageMs = Number.isFinite(createdMs) ? Math.max(Date.now() - createdMs, 0) : 0;
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageLabel = formatAge(ageMs);
  const buildResult = String(statusSnapshot && statusSnapshot.buildResult || '').toLowerCase();
  const buildStatus = String(statusSnapshot && statusSnapshot.buildStatus || '').toLowerCase();
  const policyStatus = String(statusSnapshot && statusSnapshot.policyStatus || '').toLowerCase();
  const approvalStatus = String(approval && approval.status || '').toLowerCase();
  const hasBuildStatus = buildResult && buildResult !== 'unknown' && buildResult !== 'no_status';

  if (isMergeCodeTarget) {
    return attention('manual', 1, 'Manual in ADO', ageLabel, 'MergeCode target branch requires Azure DevOps action', ageHours);
  }
  if (buildResult === 'failed' || buildResult === 'error') {
    return attention('critical', 4, 'Build Failed', ageLabel, 'Build result is ' + buildResult, ageHours);
  }
  if (approvalStatus === 'rejected') {
    return attention('critical', 4, 'Rejected', ageLabel, 'At least one reviewer rejected this PR', ageHours);
  }
  if (policyStatus === 'failed') {
    return attention('critical', 4, 'Policy Failed', ageLabel, 'Azure DevOps policy evaluation failed', ageHours);
  }

  const buildPending = buildResult === 'pending' || buildStatus === 'in_progress';
  const policyPending = policyStatus === 'pending';
  if (approvalStatus === 'complete') {
    if ((buildPending || policyPending) && ageHours >= 1) {
      return attention('warning', 3, 'Completing slow', ageLabel, 'Approvals complete, waiting for build or policy', ageHours);
    }
    return attention('ready', 1, 'Ready', ageLabel, 'Approvals are complete', ageHours);
  }

  if (!hasBuildStatus && policyStatus === 'unknown' && ageHours >= 4) {
    return attention('warning', 3, 'No status 4h+', ageLabel, 'No build or policy status found yet', ageHours);
  }
  if (ageHours >= 24) {
    return attention('stale', 3, 'Stale 1d+', ageLabel, 'PR has been waiting more than one day', ageHours);
  }
  if (ageHours >= 4) {
    return attention('warning', 2, 'Waiting 4h+', ageLabel, 'Approval is still pending', ageHours);
  }
  if (ageHours >= 2) {
    return attention('watch', 1, 'Waiting ' + ageLabel, ageLabel, 'Approval is pending', ageHours);
  }
  return attention('normal', 0, 'New ' + ageLabel, ageLabel, 'Within normal waiting time', ageHours);
}

function attention(status, rank, label, ageLabel, reason, ageHours) {
  return {
    status: status,
    rank: rank,
    label: label,
    ageLabel: ageLabel,
    reason: reason,
    ageHours: Math.round(ageHours * 10) / 10
  };
}

function sortByAttention(a, b) {
  const ar = a && a.attention ? Number(a.attention.rank) || 0 : 0;
  const br = b && b.attention ? Number(b.attention.rank) || 0 : 0;
  if (br !== ar) return br - ar;
  const ah = a && a.attention ? Number(a.attention.ageHours) || 0 : 0;
  const bh = b && b.attention ? Number(b.attention.ageHours) || 0 : 0;
  return bh - ah;
}

function buildAttentionSummary(prs) {
  const rows = Array.isArray(prs) ? prs : [];
  return {
    critical: rows.filter(pr => pr.attention && pr.attention.rank >= 4).length,
    warning: rows.filter(pr => pr.attention && pr.attention.rank >= 2 && pr.attention.rank < 4).length,
    stale: rows.filter(pr => pr.attention && pr.attention.status === 'stale').length,
    total: rows.length
  };
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '-';
  const minutes = Math.floor(ageMs / (60 * 1000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? hours + 'h ' + remainingMinutes + 'm' : hours + 'h';
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? days + 'd ' + remainingHours + 'h' : days + 'd';
}

module.exports = {
  buildAttention: buildAttention,
  sortByAttention: sortByAttention,
  buildAttentionSummary: buildAttentionSummary,
  formatAge: formatAge
};
