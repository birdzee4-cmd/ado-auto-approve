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

    // 1.5) Load ADO Config
    const { org, project } = ado.getConfig();

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

    // Naming pattern: e.g. YYYYMMDD_HHMM_ProjectName_VC12.00_Git_8cf6116871132fdc8c6b0c9a7471a10e4f9314b4
    const deploymentRegex = /^refs\/heads\/(\d{8})_(\d{4})_(.+)$/;

    const deployments = [];

    for (const branch of branches) {
      const match = branch.name.match(deploymentRegex);
      if (!match) continue;

      const [, dateStr, timeStr, rest] = match;
      const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const formattedTime = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
      const rawBranchName = branch.name.replace(/^refs\/heads\//, '');

      // Parse commitSha: look for _Git_<40-hex> or _<40-hex> at the end
      let commitSha = branch.objectId; // Default fallback to branch head objectId
      let cleanRest = rest;
      const shaMatch = rest.match(/_Git_([0-9a-fA-F]{40})$/i) || rest.match(/_([0-9a-fA-F]{40})$/i);
      if (shaMatch) {
        commitSha = shaMatch[1];
        cleanRest = rest.substring(0, rest.length - shaMatch[0].length);
      }

      // Parse version: look for _VC<digits.digits> or _V<digits.digits> or _Version_<digits.digits>
      let version = 'N/A';
      const versionMatch = cleanRest.match(/_VC([\d.]+)/i) || 
                           cleanRest.match(/_V([\d.]+)/i) || 
                           cleanRest.match(/_Version_([\d.]+)/i);
      if (versionMatch) {
        version = `VC${versionMatch[1]}`;
        cleanRest = cleanRest.replace(versionMatch[0], '');
      }

      // Project Name is the remaining part of the string
      let projectName = cleanRest.trim().replace(/^_+|_+$/g, ''); // Clean leading/trailing underscores
      if (!projectName) {
        projectName = rest; // Fallback to rest if empty
      }

      // Find matching tag.
      // Check:
      // 1. Tag points to the exact same commit SHA
      // 2. Tag name matches refs/tags/{version} or refs/tags/{projectName}_VC{version} or contains version/commitSha
      const matchedTag = tags.find(tag => {
        const isSameSha = tag.objectId === commitSha;
        if (isSameSha) return true;
        
        if (version !== 'N/A') {
          const tagName = tag.name.replace(/^refs\/tags\//, '').toLowerCase();
          const searchVersion = version.toLowerCase(); // e.g. "vc12.00"
          const isVersionMatch = tagName === searchVersion ||
                                 tagName === `${projectName.toLowerCase()}_${searchVersion}` ||
                                 tagName.includes(searchVersion);
          if (isVersionMatch) return true;
        }
        return false;
      });

      deployments.push({
        branchName: rawBranchName,
        fullRefName: branch.name,
        date: formattedDate,
        time: formattedTime,
        timestamp: `${formattedDate}T${formattedTime}:00`,
        projectName: projectName,
        version: version,
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
