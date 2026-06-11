const auth = require('../shared/auth');
const ado = require('../shared/ado-client');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    // 1) Auth Check
    const authResult = auth.requireRole(context, req);
    if (!authResult.ok) {
      jsonResponse(authResult.status, authResult.body);
      return;
    }

    // 2) Resolve Repository
    const repoName = process.env.ADO_REPOSITORY || 'Net';
    let repositoryId;
    try {
      repositoryId = await ado.getRepositoryIdByName(repoName);
    } catch (e) {
      context.log.error(`Failed to resolve repository ID for "${repoName}":`, e);
      jsonResponse(500, {
        ok: false,
        error: `Failed to resolve repository: ${e.message}`,
        hint: 'ตรวจสอบการตั้งค่า ADO_REPOSITORY หรือสิทธิ์ของ PAT'
      });
      return;
    }

    // 3) Fetch Refs (Branches and Tags)
    const [branchesResult, tagsResult] = await Promise.all([
      ado.listGitRefs(repositoryId, 'heads/'),
      ado.listGitRefs(repositoryId, 'tags/')
    ]);

    if (!branchesResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: `Failed to list branches: ADO returned HTTP ${branchesResult.status}`,
        detail: typeof branchesResult.body === 'string' ? branchesResult.body.substring(0, 300) : branchesResult.body
      });
      return;
    }

    const branches = branchesResult.body && Array.isArray(branchesResult.body.value)
      ? branchesResult.body.value
      : [];
    const tags = tagsResult.ok && tagsResult.body && Array.isArray(tagsResult.body.value)
      ? tagsResult.body.value
      : [];

    // Naming pattern: e.g. 20260529_1651_Website_WhiteLabel_GDH_VC12.00_Git_8cf6116871132fdc8c6b0c9a7471a10e4f9314b4
    const deploymentRegex = /^refs\/heads\/(\d{8})_(\d{4})_(.+)_VC([\d.]+)_Git_([0-9a-fA-F]{40})$/;

    const deployments = [];

    for (const branch of branches) {
      const match = branch.name.match(deploymentRegex);
      if (!match) continue;

      const [, dateStr, timeStr, projectName, version, commitSha] = match;
      const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const formattedTime = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
      const rawBranchName = branch.name.replace(/^refs\/heads\//, '');

      // Find matching tag.
      // Check:
      // 1. Tag points to the exact same commit SHA
      // 2. Tag name matches refs/tags/{version} or refs/tags/{projectName}_VC{version} or contains version/commitSha
      const matchedTag = tags.find(tag => {
        const isSameSha = tag.objectId === commitSha;
        const tagName = tag.name.replace(/^refs\/tags\//, '').toLowerCase();
        const searchVersion = `vc${version}`.toLowerCase();
        const isVersionMatch = tagName === searchVersion ||
                               tagName === `${projectName.toLowerCase()}_${searchVersion}` ||
                               tagName.includes(searchVersion);
        return isSameSha || isVersionMatch;
      });

      deployments.push({
        branchName: rawBranchName,
        fullRefName: branch.name,
        date: formattedDate,
        time: formattedTime,
        timestamp: `${formattedDate}T${formattedTime}:00`,
        projectName: projectName,
        version: `VC${version}`,
        commitSha: commitSha,
        isTagged: !!matchedTag,
        tagName: matchedTag ? matchedTag.name.replace(/^refs\/tags\//, '') : null,
        tagCommitSha: matchedTag ? matchedTag.objectId : null
      });
    }

    // Sort by Date & Time descending (newest first)
    deployments.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    jsonResponse(200, {
      ok: true,
      repository: repoName,
      organization: org,
      project: project,
      count: deployments.length,
      deployments: deployments
    });

  } catch (err) {
    context.log.error('Unexpected error in list-deployments:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err.message
    });
  }
};
