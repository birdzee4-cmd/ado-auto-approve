/**
 * POST /api/approve-pr
 *
 * PR approval is intentionally disabled in this web app.
 * Users must approve and complete pull requests directly in Azure DevOps.
 */

module.exports = async function (context) {
  context.res = {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      ok: false,
      error: 'PR approval is disabled in this dashboard',
      hint: 'Open the pull request in Azure DevOps and approve or complete it manually.'
    })
  };
};
