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
    // 1) Auth Check (Requires it_support_approve role)
    const requiredRole = auth.getRequiredApproverRole();
    const authResult = auth.requireRole(context, req, requiredRole);
    if (!authResult.ok) {
      jsonResponse(authResult.status, authResult.body);
      return;
    }

    // 2) Parse parameters
    const body = req.body || {};
    const commitSha = body.commitSha;
    let tagName = body.tagName;

    if (!commitSha || !tagName) {
      jsonResponse(400, {
        ok: false,
        error: 'Missing commitSha or tagName in request body'
      });
      return;
    }

    // Clean tag name
    tagName = String(tagName).trim().replace(/\s+/g, '_');
    if (tagName.length === 0) {
      jsonResponse(400, {
        ok: false,
        error: 'Tag name cannot be empty or only spaces'
      });
      return;
    }

    // Validate commitSha
    const shaRegex = /^[0-9a-fA-F]{40}$/;
    if (!shaRegex.test(commitSha)) {
      jsonResponse(400, {
        ok: false,
        error: 'Invalid commitSha format. Must be a 40-character hexadecimal string.'
      });
      return;
    }

    // 3) Resolve Repository
    const repoName = process.env.ADO_REPOSITORY || 'Net';
    let repositoryId;
    try {
      repositoryId = await ado.getRepositoryIdByName(repoName);
    } catch (e) {
      context.log.error(`Failed to resolve repository ID for "${repoName}":`, e);
      jsonResponse(500, {
        ok: false,
        error: `Failed to resolve repository: ${e.message}`
      });
      return;
    }

    // 4) Create Git Ref (Tag)
    const refName = `refs/tags/${tagName}`;
    const result = await ado.createGitRef(repositoryId, refName, commitSha);

    if (!result.ok) {
      context.log.error(`ADO returned error creating ref ${refName}:`, result.body);
      
      // Look for custom error messages (e.g. tag already exists)
      let errorMessage = 'Failed to create Git tag in Azure DevOps';
      let detail = '';
      if (result.body) {
        if (typeof result.body === 'object') {
          detail = result.body.message || JSON.stringify(result.body);
        } else {
          detail = String(result.body);
        }
      }
      
      if (detail.includes('already exists') || detail.includes('AlreadyExists')) {
        errorMessage = `Tag "${tagName}" already exists on Azure DevOps`;
      }

      jsonResponse(result.status === 400 ? 400 : 502, {
        ok: false,
        error: errorMessage,
        detail: detail
      });
      return;
    }

    // 5) Try Logging to SharePoint (Optional)
    const userEmail = authResult.principal ? auth.getUserEmail(authResult.principal) : 'Unknown User';
    try {
      let sp;
      try {
        sp = require('../shared/sharepoint-client');
      } catch (e) {}
      
      if (sp) {
        const logFields = sp.buildLogFields({
          prId: 0,
          action: 'Git Tag Created',
          user: userEmail,
          repository: repoName,
          prTitle: `Created tag refs/tags/${tagName}`,
          targetBranch: '',
          result: 'Success',
          reason: `Tag pointing to commit ${commitSha.substring(0, 8)}`,
          source: 'Dashboard'
        });
        await sp.addLogItem(logFields);
        context.log('Successfully logged tag creation to SharePoint');
      }
    } catch (logErr) {
      context.log.warn('Failed to log tag creation to SharePoint:', logErr.message);
    }

    jsonResponse(200, {
      ok: true,
      tagName: tagName,
      refName: refName,
      commitSha: commitSha,
      message: `Successfully created tag "${tagName}"`
    });

  } catch (err) {
    context.log.error('Unexpected error in create-tag:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err.message
    });
  }
};
