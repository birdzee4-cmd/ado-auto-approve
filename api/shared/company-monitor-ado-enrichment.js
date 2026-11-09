const ado = require('./ado-client');

async function enrich(items, options = {}) {
  const ids = [...new Set(items.map(item => item.azureBuildId || String(item.id || '').replace(/_[MP]$/, '')).filter(id => /^\d+$/.test(id)))].slice(0, options.maxBuilds || 120);
  const details = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const response = await ado.getBuildById(id);
        if (response.ok && response.body) details.set(id, response.body);
      } catch (_) { /* Monitor data remains usable without enrichment. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, worker));
  return items.map(item => {
    const detail = details.get(item.azureBuildId || String(item.id || '').replace(/_[MP]$/, ''));
    const buildId = item.azureBuildId || String(item.id || '').replace(/_[MP]$/, '');
    const hook = options.lineageByBuildId && options.lineageByBuildId[buildId];
    if (!detail && !hook) return item;
    return { ...item,
      repository: item.repository || hook?.repositoryName || detail?.repository?.name || '',
      repositoryId: item.repositoryId || hook?.repositoryId || detail?.repository?.id || '',
      commitId: item.commitId || String(hook?.sourceVersion || detail?.sourceVersion || '').trim().toLowerCase(),
      sourceBranch: item.sourceBranch || hook?.sourceBranch || detail?.sourceBranch || '',
      lineageSource: item.commitId ? (item.lineageSource || 'monitor') : hook?.sourceVersion ? 'service-hook' : detail?.sourceVersion ? 'azure-devops-api' : '',
      adoResult: String(detail?.result || hook?.result || '').toLowerCase(),
      adoBuildUrl: detail?._links?.web?.href || detail?.url || hook?.url || ''
    };
  });
}
module.exports = { enrich };
