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

    // 2) Fetch All Repositories in the project
    const reposPath = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.0`;
    const reposResult = await ado.adoRequest('GET', reposPath);

    if (!reposResult.ok || !reposResult.body || !Array.isArray(reposResult.body.value)) {
      jsonResponse(502, {
        ok: false,
        error: `Failed to list ADO repositories: HTTP ${reposResult.status}`,
        detail: typeof reposResult.body === 'string' ? reposResult.body.substring(0, 300) : reposResult.body
      });
      return;
    }

    const repositories = reposResult.body.value;

    // 3) Fetch Branches for All Repositories in Parallel
    const repoBranchesResults = await Promise.all(
      repositories.map(async (repo) => {
        try {
          const branchesRes = await ado.listGitRefs(repo.id, 'heads/');
          if (!branchesRes.ok) {
            return { repoName: repo.name, repoId: repo.id, branches: [], error: `HTTP ${branchesRes.status}` };
          }
          
          let branchesBody = branchesRes.body;
          if (typeof branchesBody === 'string') {
            try { branchesBody = JSON.parse(branchesBody); } catch (e) {}
          }
          const value = branchesBody && Array.isArray(branchesBody.value) ? branchesBody.value : [];
          return { repoName: repo.name, repoId: repo.id, branches: value };
        } catch (e) {
          return { repoName: repo.name, repoId: repo.id, branches: [], error: e.message };
        }
      })
    );

    // Filter branches matching pattern and find active repositories
    const deploymentRegex = /^refs\/heads\/(\d{8})_(\d{4})_(.+)$/;
    const activeRepoIds = new Set();
    const rawDeployments = [];

    for (const repoRes of repoBranchesResults) {
      for (const branch of repoRes.branches) {
        if (branch.name.match(deploymentRegex)) {
          activeRepoIds.add(repoRes.repoId);
          rawDeployments.push({
            repoName: repoRes.repoName,
            repoId: repoRes.repoId,
            branch: branch
          });
        }
      }
    }

    // 4) Fetch Tags for Active Repositories in Parallel
    const activeRepoIdsArray = Array.from(activeRepoIds);
    const repoTagsResults = await Promise.all(
      activeRepoIdsArray.map(async (repoId) => {
        try {
          const tagsRes = await ado.listGitRefs(repoId, 'tags/');
          if (!tagsRes.ok) return { repoId, tags: [] };
          
          let tagsBody = tagsRes.body;
          if (typeof tagsBody === 'string') {
            try { tagsBody = JSON.parse(tagsBody); } catch (e) {}
          }
          const value = tagsBody && Array.isArray(tagsBody.value) ? tagsBody.value : [];
          return { repoId, tags: value };
        } catch (e) {
          return { repoId, tags: [] };
        }
      })
    );

    const tagsMap = new Map();
    for (const tagsRes of repoTagsResults) {
      tagsMap.set(tagsRes.repoId, tagsRes.tags);
    }

    // 5) Parse Deployments and Match Tags
    const deployments = [];

    for (const rawDep of rawDeployments) {
      const branch = rawDep.branch;
      const match = branch.name.match(deploymentRegex);
      if (!match) continue; // safety check

      const [, dateStr, timeStr, rest] = match;
      const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const formattedTime = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
      const rawBranchName = branch.name.replace(/^refs\/heads\//, '');

      // Parse commitSha
      let commitSha = branch.objectId;
      let cleanRest = rest;
      const shaMatch = rest.match(/_Git_([0-9a-fA-F]{40})$/i) || rest.match(/_([0-9a-fA-F]{40})$/i);
      if (shaMatch) {
        commitSha = shaMatch[1];
        cleanRest = rest.substring(0, rest.length - shaMatch[0].length);
      }

      // Parse version
      let version = 'N/A';
      const versionMatch = cleanRest.match(/_VC([\d.]+)/i) || 
                           cleanRest.match(/_V([\d.]+)/i) || 
                           cleanRest.match(/_Version_([\d.]+)/i);
      if (versionMatch) {
        version = `VC${versionMatch[1]}`;
        cleanRest = cleanRest.replace(versionMatch[0], '');
      }

      // Project Name
      let projectName = cleanRest.trim().replace(/^_+|_+$/g, '');
      if (!projectName) {
        projectName = rest;
      }

      // Find matching tag in the specific repository
      const repoTags = tagsMap.get(rawDep.repoId) || [];
      const matchedTag = repoTags.find(tag => {
        const isSameSha = tag.objectId === commitSha;
        if (isSameSha) return true;
        
        if (version !== 'N/A') {
          const tagName = tag.name.replace(/^refs\/tags\//, '').toLowerCase();
          const searchVersion = version.toLowerCase();
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
        repositoryName: rawDep.repoName,
        repositoryId: rawDep.repoId,
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

    // Sort by Date & Time descending
    deployments.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    jsonResponse(200, {
      ok: true,
      count: deployments.length,
      organization: org,
      project: project,
      debug: {
        totalRepositories: repositories.length,
        repositories: repositories.map(r => r.name),
        activeRepositoriesCount: activeRepoIds.size,
        totalRawDeployments: rawDeployments.length,
        repoBranchCounts: repoBranchesResults.map(r => ({ name: r.repoName, branches: r.branches.length, error: r.error }))
      },
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
