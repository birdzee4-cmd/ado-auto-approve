const STG_CI_CD_MAP = require('./stg-ci-cd-map.json');

const MERGE_PIPELINE_RULES = [
  {
    key: 'wallet-backoffice-v28',
    label: 'Wallet BackOffice V28 VM',
    repository: 'Net',
    sourceIncludes: ['Merge/POP/WalletBackofficeBzbs/'],
    targetIncludes: ['MergeCodeProduction/TH/2026/BackOfficeEWalletTHVM/'],
    environment: 'STG',
    confidence: 'high',
    ci: {
      name: 'STG_Net_Service_Wallet_BackOffice_VM-CI'
    },
    cd: {
      name: 'Stg service Wallet BackOffice V28 VM CD'
    }
  }
];

function normalize(value) {
  return String(value || '')
    .replace(/^refs\/heads\//i, '')
    .trim()
    .toLowerCase();
}

function containsAny(value, patterns) {
  const target = normalize(value);
  return (patterns || []).some(pattern => target.includes(normalize(pattern)));
}

function repositoryMatches(rule, repositoryName) {
  if (!rule.repository) return true;
  return normalize(rule.repository) === normalize(repositoryName);
}

function findMergePipelineRule(pr) {
  const repoName = pr && pr.repository ? pr.repository.name : '';
  const sourceBranch = pr && pr.sourceRefName;
  const targetBranch = pr && pr.targetRefName;

  return MERGE_PIPELINE_RULES.find(rule =>
    repositoryMatches(rule, repoName) &&
    containsAny(sourceBranch, rule.sourceIncludes) &&
    containsAny(targetBranch, rule.targetIncludes)
  ) || null;
}

function findStagingPipelineMappingByCi(ciName) {
  const target = normalize(ciName);
  if (!target) return null;
  return (Array.isArray(STG_CI_CD_MAP) ? STG_CI_CD_MAP : []).find(item =>
    normalize(item && item.ciName) === target
  ) || null;
}

function isMergePr(pr) {
  const source = normalize(pr && pr.sourceRefName);
  const target = normalize(pr && pr.targetRefName);
  return source.startsWith('merge/') ||
    source.includes('mergecode') ||
    target.includes('mergecode');
}

module.exports = {
  MERGE_PIPELINE_RULES,
  findMergePipelineRule,
  findStagingPipelineMappingByCi,
  isMergePr
};
