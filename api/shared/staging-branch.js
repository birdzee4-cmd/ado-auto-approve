'use strict';

function configuredPrefixes(value) {
  const raw = String(value || '').trim();
  return raw ? raw.split(',').map(item => item.trim()).filter(Boolean) : [];
}

function isTargetBranch(refName, configured) {
  const actual = String(refName || '').trim().toLowerCase().replace(/^refs\/heads\//, '');
  if (/(^|[\/_-])(prd|prod|production)(?=$|[\/_-])/.test(actual)) return false;
  // A configured legacy default must not exclude namespaced staging branches
  // such as v1/Staging/Api or x1/Staging/Api.
  if (/(^|\/)staging(?=$|[\/_-])/.test(actual)) return true;
  const prefixes = configuredPrefixes(configured);
  return prefixes.some(value => {
    const prefix = value.toLowerCase().replace(/^refs\/heads\//, '').replace(/\/+$/, '');
    return actual === prefix || ['/', '-', '_'].some(separator => actual.startsWith(prefix + separator));
  });
}

module.exports = { isTargetBranch };
