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
    // 1) Auth Check (Requires authenticated user)
    const authResult = auth.requireRole(context, req, 'authenticated');
    if (!authResult.ok) {
      jsonResponse(authResult.status, authResult.body);
      return;
    }

    // 2) Parse parameters
    const repositoryId = req.query.repositoryId;
    if (!repositoryId) {
      jsonResponse(400, {
        ok: false,
        error: 'Missing query parameter: repositoryId'
      });
      return;
    }

    // 3) Fetch branches (heads/) in parallel with tags (tags/)
    const [branchesRes, tagsRes] = await Promise.all([
      ado.listGitRefs(repositoryId, 'heads/'),
      ado.listGitRefs(repositoryId, 'tags/')
    ]);

    if (!branchesRes.ok) {
      jsonResponse(502, {
        ok: false,
        error: `Failed to list branches from repository: HTTP ${branchesRes.status}`,
        detail: typeof branchesRes.body === 'string' ? branchesRes.body.substring(0, 300) : branchesRes.body
      });
      return;
    }

    let branchesBody = branchesRes.body;
    if (typeof branchesBody === 'string') {
      try { branchesBody = JSON.parse(branchesBody); } catch (e) {}
    }
    const branches = branchesBody && Array.isArray(branchesBody.value) ? branchesBody.value : [];

    let tagsBody = tagsRes.ok ? tagsRes.body : { value: [] };
    if (typeof tagsBody === 'string') {
      try { tagsBody = JSON.parse(tagsBody); } catch (e) {}
    }
    const tags = tagsBody && Array.isArray(tagsBody.value) ? tagsBody.value : [];

    // Map tags by objectId (Commit SHA) for O(1) lookup
    const tagsMap = new Map();
    for (const tag of tags) {
      const cleanTagName = tag.name.replace(/^refs\/tags\//, '');
      if (!tagsMap.has(tag.objectId)) {
        tagsMap.set(tag.objectId, []);
      }
      tagsMap.get(tag.objectId).push(cleanTagName);
    }

    // 4) Map branches with tag information
    const branchesList = branches.map(branch => {
      const rawBranchName = branch.name.replace(/^refs\/heads\//, '');
      const commitSha = branch.objectId;
      const matchedTags = tagsMap.get(commitSha) || [];

      return {
        branchName: rawBranchName,
        fullRefName: branch.name,
        commitSha: commitSha,
        isTagged: matchedTags.length > 0,
        tagName: matchedTags.length > 0 ? matchedTags.join(', ') : null,
        tagsList: matchedTags
      };
    });

    // Sort branches: primary branches (main, master, staging, dev) first, then alphabetical
    const primaryBranches = ['main', 'master', 'staging', 'development', 'dev'];
    branchesList.sort((a, b) => {
      const aLower = a.branchName.toLowerCase();
      const bLower = b.branchName.toLowerCase();
      const aIndex = primaryBranches.indexOf(aLower);
      const bIndex = primaryBranches.indexOf(bLower);

      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      return a.branchName.localeCompare(b.branchName);
    });

    jsonResponse(200, {
      ok: true,
      repositoryId: repositoryId,
      branches: branchesList
    });

  } catch (err) {
    context.log.error('Unexpected error in list-repo-refs:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err.message
    });
  }
};
