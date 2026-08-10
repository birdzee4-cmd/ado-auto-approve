const test = require('node:test');
const assert = require('node:assert/strict');
const mapping = require('./merge-pipeline-map');

function buzzPosPilotPr() {
  return {
    title: '#355289 Merge Bug fix into BuzzPosPilot production merge branch',
    repository: { name: 'Net' },
    sourceRefName: 'refs/heads/MergeCode/Dol/Production/buzzpospilot_20260810',
    targetRefName: 'refs/heads/MergeCodeProduction/TH/2026/ModuleandPlugin/BuzzPosPilot/20260807_1035_OP_Service_ModuleAndPlugin_BuzzPosPilot_FromVC12.00_VA28.00_Git_be707f14060bfd151a7efbcc3540_M'
  };
}

test('branch component matching selects BuzzPosPilot instead of a generic Net pipeline', () => {
  const result = mapping.findPossibleStagingPipelineMapping(buzzPosPilotPr());
  assert.equal(result.ciName, 'STG_Service_Module_BuzzPosPilot-CI');
  assert.equal(result.ciId, '7093');
  assert.equal(result.cdId, '6068');
});

test('generic Net repository name alone does not produce a pipeline candidate', () => {
  const result = mapping.findPossibleStagingPipelineMapping({
    repository: { name: 'Net' },
    sourceRefName: 'refs/heads/main',
    targetRefName: 'refs/heads/production'
  });
  assert.equal(result, null);
});

test('candidate tokens prioritize the component and exclude generic repository terms', () => {
  const tokens = mapping.buildCandidateTokens(buzzPosPilotPr());
  assert.equal(tokens.includes('buzzpospilot'), true);
  assert.equal(tokens.includes('net'), false);
  assert.equal(tokens.includes('production'), false);
});
