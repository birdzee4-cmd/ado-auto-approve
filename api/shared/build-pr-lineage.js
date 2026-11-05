// Match the merged commit, not a PR number guessed from a commit message.
async function enrichBuildPullRequest(event, ado) {
  let pr;
  if (event.pullRequestId) {
    const result = await ado.getPullRequest(event.pullRequestId);
    if (result.ok) pr = result.body;
  } else if (event.repositoryId && /^[a-f0-9]{40}$/i.test(event.sourceVersion || '') && /^refs\/heads\//.test(event.buildSourceBranch || event.sourceBranch || '')) {
    const result = await ado.getPullRequestsForTargetBranch(event.repositoryId, event.buildSourceBranch || event.sourceBranch, 100);
    const matches = result.ok && Array.isArray(result.body?.value) ? result.body.value.filter(candidate =>
      String(candidate.lastMergeCommit?.commitId || '').toLowerCase() === event.sourceVersion.toLowerCase()) : [];
    if (matches.length === 1) { pr = matches[0]; event.prLinkEvidence = 'merge-commit'; }
  }
  if (!pr?.pullRequestId && !event.pullRequestId) return event;
  if (!pr) return event;
  event.pullRequestId = String(pr.pullRequestId || event.pullRequestId);
  event.pullRequestTitle = pr.title || '';
  event.pullRequestAuthor = pr.createdBy?.displayName || pr.createdBy?.uniqueName || '';
  // Azure DevOps PR.url is a REST URL; prefer its browser link.
  const config = ado.getConfig();
  event.pullRequestUrl = pr._links?.web?.href || `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_git/${encodeURIComponent(event.repositoryId || event.repositoryName || pr.repository?.id || '')}/pullrequest/${encodeURIComponent(event.pullRequestId)}`;
  event.targetBranch = pr.targetRefName || event.targetBranch;
  // Preserve the branch actually built; PR source can differ after a merge.
  event.prSourceBranch = pr.sourceRefName || '';
  return event;
}
module.exports = { enrichBuildPullRequest };
