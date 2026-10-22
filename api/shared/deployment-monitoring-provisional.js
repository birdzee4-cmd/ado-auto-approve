// Development evidence from ProjectPlanningList.aspx, inspected 2026-10-22.
// Opt-in only. Labels are not owner-approved business outcome definitions.
const mappingVersion = 'source-ui-20261022-provisional';
const statusLabels = Object.freeze({
  0: 'Create', 100: 'Submit to Test', 110: 'Build Staging for Test',
  111: 'Rebuild Staging for Test', 120: 'Production Staging for Test',
  130: 'Edit Description', 140: 'Edit Description Backup',
  200: 'Open Code for Merge', 201: 'Reopen Code for Merge',
  210: 'Test After Swap', 220: 'Swap Back',
  300: 'Request Build Staging', 301: 'Request Open Code for Merge',
  310: 'Request Rebuild Staging', 311: 'Request Reopen Code for Merge',
  320: 'Request Production Staging', 400: 'Confirm Build Production',
  401: 'Confirm Backup Code', 409: 'Waiting Document (Backup Code)',
  410: 'Waiting Document (Deployment)', 411: 'Deployment Complete',
  412: 'Backup Complete', 420: 'Request Swap Back', 421: 'Request Swap',
  430: 'Waiting Document (Reject)', 431: 'Rejected Complete'
});
const types = Object.freeze({
  DeployType: Object.freeze({ 0: 'Backend', 1: 'Frontend', 2: 'No Action' }),
  GetType: Object.freeze({ 0: 'Get', 1: 'Merge', 2: 'Resize' }),
  Priority: Object.freeze({})
});
function codeLabel(field, rawCode) {
  if (rawCode !== null && (!Number.isInteger(rawCode) || rawCode < -2147483648 || rawCode > 2147483647)) {
    throw new TypeError('Expected SQL int or null');
  }
  if (field !== 'Status' && !Object.hasOwn(types, field)) throw new TypeError('Unknown mapping field');
  const label = field === 'Status'
    ? rawCode !== null && rawCode < 0 ? 'Terminate' : statusLabels[rawCode]
    : types[field][rawCode];
  return { rawCode, label: label || (rawCode === null ? 'ไม่ระบุ' : `ไม่ทราบรหัส (${rawCode})`),
    provisional: true, category: 'unknown', isTerminal: null };
}
module.exports = { mappingVersion, codeLabel, statusLabels };
