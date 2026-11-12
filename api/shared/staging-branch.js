'use strict';

function configuredPrefixes(value) {
  const raw = String(value || '').trim();
  return raw ? raw.split(',').map(item => item.trim()).filter(Boolean) : ['refs/heads/staging', 'refs/heads/v1/staging'];
}

function isTargetBranch(refName, configured) {
  const actual = String(refName || '').trim().toLowerCase().replace(/^refs\/heads\//, '');
  if (/(^|[\/_-])(prd|prod|production)(?=$|[\/_-])/.test(actual)) return false;
  return configuredPrefixes(configured).some(value => {
    const prefix = value.toLowerCase().replace(/^refs\/heads\//, '').replace(/\/+$/, '');
    return actual === prefix || ['/', '-', '_'].some(separator => actual.startsWith(prefix + separator));
  });
}

module.exports = { isTargetBranch };
