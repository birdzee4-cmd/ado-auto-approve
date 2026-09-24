function normalizeAdoIdentity(connectionData) {
  const user = connectionData && connectionData.authenticatedUser;
  if (!user || !user.id) return null;
  const email = firstNonEmpty([
    user.uniqueName,
    user.mailAddress,
    user.properties && user.properties.Account && user.properties.Account.$value
  ]);
  return {
    id: String(user.id),
    descriptor: String(user.descriptor || ''),
    displayName: String(user.providerDisplayName || user.displayName || email || 'Azure DevOps user'),
    email,
    verified: true
  };
}

async function verifyAdoIdentity(accessToken, adoClient) {
  if (!accessToken) return { ok: false, status: 428, error: 'Azure DevOps connection required' };
  const client = adoClient || require('./ado-client');
  const result = await client.getConnectionData({ accessToken });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      error: 'Azure DevOps identity validation failed'
    };
  }
  const identity = normalizeAdoIdentity(result.body);
  if (!identity) {
    return { ok: false, status: 502, error: 'Azure DevOps did not return an authenticated identity' };
  }
  return { ok: true, status: 200, identity };
}

function firstNonEmpty(values) {
  for (const value of values || []) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

module.exports = { normalizeAdoIdentity, verifyAdoIdentity };
