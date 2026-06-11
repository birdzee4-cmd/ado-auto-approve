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

    // 2) Load ADO Config
    const { org, project } = ado.getConfig();

    // 3) Fetch All Repositories in the project
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

    const repositories = reposResult.body.value.map(r => ({
      id: r.id,
      name: r.name,
      webUrl: r.webUrl
    }));

    // Sort repositories by name alphabetically
    repositories.sort((a, b) => a.name.localeCompare(b.name));

    jsonResponse(200, {
      ok: true,
      count: repositories.length,
      repositories: repositories
    });

  } catch (err) {
    context.log.error('Unexpected error in list-repositories:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err.message
    });
  }
};
