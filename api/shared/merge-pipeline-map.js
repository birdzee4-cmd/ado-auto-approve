const STG_CI_CD_MAP = require('./stg-ci-cd-map.json');

const PARTNER_COUNTRIES = Object.freeze({
  TH: 'Thailand',
  VN: 'Vietnam',
  MY: 'Malaysia',
  PH: 'Philippines',
  ID: 'Indonesia'
});

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
  },
  {
    key: 'service-api1-center-v27',
    label: 'Service Api1 Center V27',
    repository: 'Net',
    sourceIncludes: ['UserStory/Poppper/SIN-Merge-apiservicecenter'],
    targetIncludes: ['MergeCodeProduction/TH/2025/ServiceApi1CenterV27/'],
    environment: 'STG',
    confidence: 'high',
    ci: {
      name: 'STG_Net_APICenter1_service-CI'
    },
    cd: {
      name: 'stg service apicenter1 CD'
    }
  },
  {
    key: 'static-website-sales-portal',
    label: 'Static Website Sales Portal',
    repository: 'Net_Product_Sales_Portal_Web',
    sourceIncludes: ['MergeCode/'],
    targetIncludes: ['MergeCodeProduction/'],
    environment: 'STG',
    confidence: 'high',
    ci: {
      name: 'Stg_Net_Product_Sales_Portal_Web_static-CI'
    },
    cd: {
      name: 'None (CI Only / Static Web Apps)'
    }
  },
  {
    key: 'net-web-rulebasedengine',
    label: 'Net Web RuleBasedEngine',
    repository: 'Net_Web_RuleBasedEngine',
    sourceIncludes: ['merge_', 'MergeCode/'],
    targetIncludes: ['MergeCodeProduction/'],
    environment: 'STG',
    confidence: 'high',
    ci: {
      name: 'STG_Net_Web_RuleBasedEngine-CI'
    },
    cd: {
      name: 'stg web rulebasedengine CD'
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

function normalizeForCandidate(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function countryCodeFromText(value) {
  const match = String(value || '').toUpperCase().match(/(?:^|[^A-Z0-9])(TH|VN|MY|PH|ID)(?=$|[^A-Z0-9])/);
  return match ? match[1] : '';
}

function getPartnerCountry(pr) {
  const sources = [
    ['target-branch', pr && pr.targetRefName],
    ['title', pr && pr.title],
    ['source-branch', pr && pr.sourceRefName]
  ];
  for (const [source, value] of sources) {
    const code = countryCodeFromText(value);
    if (code) return { code, name: PARTNER_COUNTRIES[code], source };
  }
  return { code: '', name: '', source: '' };
}

function getPipelineCountry(item) {
  const explicitCode = countryCodeFromText([
    item && item.ciName,
    item && item.cdName,
    item && item.ciFolder,
    item && item.cdPath
  ].filter(Boolean).join(' '));
  const code = explicitCode || 'TH';
  return { code, name: PARTNER_COUNTRIES[code], inferred: !explicitCode };
}

const GENERIC_CANDIDATE_TOKENS = new Set([
  'net', 'node', 'react', 'web', 'api', 'service', 'services', 'module', 'plugin',
  'moduleandplugin', 'merge', 'mergecode', 'mergecodeproduction', 'production',
  'staging', 'stage', 'stg', 'master', 'main', 'develop', 'development', 'th',
  'docker', 'vm', 'earth', 'dol', 'poppper', 'userstory', 'bug', 'fix', 'into', 'branch'
]);

function candidateParts(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .map(normalizeForCandidate)
    .filter(token => token && token.length >= 4)
    .filter(token => !GENERIC_CANDIDATE_TOKENS.has(token))
    .filter(token => !/^\d+$/.test(token))
    .filter(token => !/^[a-f0-9]{12,}$/.test(token))
    .filter(token => !/^from(vc|git)/.test(token));
}

function buildCandidateTokens(pr) {
  const repo = pr && pr.repository ? pr.repository.name : '';
  const rawTokens = [
    ...candidateParts(pr && pr.sourceRefName),
    ...candidateParts(pr && pr.targetRefName),
    ...candidateParts(pr && pr.title),
    repo.replace(/^net[_\-.]?project[_\-.]?/i, ''),
    repo.replace(/^node[_\-.]?project[_\-.]?/i, ''),
    repo.replace(/^react[_\-.]?web[_\-.]?/i, '')
  ];
  return [...new Set(rawTokens
    .map(normalizeForCandidate)
    .filter(token => token && token.length >= 4)
    .filter(token => !GENERIC_CANDIDATE_TOKENS.has(token))
    .filter(token => !/^\d+$/.test(token))
    .filter(token => !/^[a-f0-9]{12,}$/.test(token)))]
    .sort((a, b) => b.length - a.length);
}

function scoreStagingCandidate(item, tokens, countryCode) {
  const pipelineCountry = getPipelineCountry(item);
  if (countryCode && pipelineCountry.code !== countryCode) return 0;
  const ci = normalizeForCandidate(item && item.ciName);
  const cd = normalizeForCandidate(item && item.cdName);
  if (!ci) return 0;
  let score = 0;
  for (const token of tokens) {
    if (ci.includes(token)) score = Math.max(score, token.length + 20);
    if (cd.includes(token)) score = Math.max(score, token.length + 10);
  }
  if (ci.includes('stg')) score += 3;
  if (ci.includes('docker')) score += 2;
  if (countryCode && pipelineCountry.code === countryCode) score += 100;
  return score;
}

function findPossibleStagingPipelineMapping(pr) {
  const tokens = buildCandidateTokens(pr);
  const country = getPartnerCountry(pr);
  if (!tokens.length) return null;
  const candidates = (Array.isArray(STG_CI_CD_MAP) ? STG_CI_CD_MAP : [])
    .map(item => ({ item, score: scoreStagingCandidate(item, tokens, country.code) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  return candidates[0].item;
}

function isMergePr(pr) {
  const source = normalize(pr && pr.sourceRefName);
  const target = normalize(pr && pr.targetRefName);
  return source.startsWith('merge/') ||
    source.includes('mergecode') ||
    target.includes('mergecode');
}

module.exports = {
  PARTNER_COUNTRIES,
  MERGE_PIPELINE_RULES,
  findMergePipelineRule,
  findStagingPipelineMappingByCi,
  findPossibleStagingPipelineMapping,
  buildCandidateTokens,
  countryCodeFromText,
  getPartnerCountry,
  getPipelineCountry,
  isMergePr
};
