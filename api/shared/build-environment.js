'use strict';

// Build pipeline names use environment tokens such as "-stg-ci" and "-prd-ci".
// Keep the boundary check strict so names like "product" do not count as prd.
function getBuildEnvironment(pipelineName) {
  const name = String(pipelineName || '').toLowerCase();
  if (/(^|[-_.\s])stg(?=[-_.\s]|$)/i.test(name)) return 'stg';
  if (/(^|[-_.\s])prd(?=[-_.\s]|$)/i.test(name)) return 'prd';
  return '';
}

function isNotifiableBuildEnvironment(pipelineName) {
  return Boolean(getBuildEnvironment(pipelineName));
}

module.exports = { getBuildEnvironment, isNotifiableBuildEnvironment };
