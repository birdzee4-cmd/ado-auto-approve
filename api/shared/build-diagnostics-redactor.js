'use strict';

const REDACTED = '[REDACTED]';

function addCount(counts, category, amount) {
  counts[category] = (counts[category] || 0) + (amount || 1);
}

function replaceTracked(text, pattern, replacement, category, counts) {
  return text.replace(pattern, function () {
    addCount(counts, category, 1);
    const args = Array.prototype.slice.call(arguments);
    return typeof replacement === 'function' ? replacement.apply(null, args) : replacement;
  });
}

function looksLikeHighEntropyToken(value) {
  if (!value || value.length < 32 || value.length > 4096) return false;
  if (/^[a-f0-9]{32,}$/i.test(value)) return true;
  if (!/^[A-Za-z0-9+/_=.-]+$/.test(value)) return false;
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[+/_=.-]/.test(value)]
    .filter(Boolean).length;
  return classes >= 3 && !/^sha(?:1|256|512)[:-]/i.test(value);
}

function redactLog(logText) {
  let text = String(logText || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
  const categories = {};

  text = replaceTracked(
    text,
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
    '[REDACTED PRIVATE KEY]',
    'privateKey',
    categories
  );
  text = replaceTracked(text, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer ' + REDACTED, 'bearerToken', categories);
  text = replaceTracked(text, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED, 'jwt', categories);
  text = replaceTracked(
    text,
    /\b(AZDO|VSS_NUGET_EXTERNAL_FEED_ENDPOINTS|SYSTEM_ACCESSTOKEN|API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|PASSWD|PWD|ACCOUNTKEY|SHAREDACCESSKEY)\b(\s*[:=]\s*)([^\s,;]+)/gi,
    function (_match, key, separator) { return key + separator + REDACTED; },
    'namedCredential',
    categories
  );
  text = replaceTracked(
    text,
    /\b(Password|Pwd|AccountKey|SharedAccessKey|SharedAccessSignature)=([^;\s]+)/gi,
    function (_match, key) { return key + '=' + REDACTED; },
    'connectionString',
    categories
  );
  text = replaceTracked(
    text,
    /(["']?(?:password|passwd|pwd|clientSecret|apiKey|accessToken|refreshToken|clearTextPassword)["']?\s*[:=]\s*["'])([^"'\r\n]+)(["'])/gi,
    function (_match, prefix, _value, suffix) { return prefix + REDACTED + suffix; },
    'structuredCredential',
    categories
  );
  text = replaceTracked(
    text,
    /(key=["']ClearTextPassword["'][^>\r\n]*\bvalue=["'])([^"']*)(["'])/gi,
    function (_match, prefix, _value, suffix) { return prefix + REDACTED + suffix; },
    'nugetCredential',
    categories
  );
  text = replaceTracked(
    text,
    /\bhttps?:\/\/([^\s/@:]+):([^\s/@]+)@/gi,
    function (match) { return match.replace(/\/\/[^@]+@/, '//[REDACTED]@'); },
    'credentialUrl',
    categories
  );
  text = replaceTracked(text, /\b(?:ghp|github_pat|ado|azd|sk|pk)_[A-Za-z0-9_-]{20,}\b/gi, REDACTED, 'apiToken', categories);

  text = text.replace(/\b[A-Za-z0-9+/_=.-]{32,}\b/g, function (value) {
    if (!looksLikeHighEntropyToken(value)) return value;
    addCount(categories, 'highEntropyToken', 1);
    return REDACTED;
  });

  const total = Object.values(categories).reduce((sum, count) => sum + count, 0);
  return {
    text: text,
    summary: {
      total: total,
      categories: categories
    }
  };
}

module.exports = {
  REDACTED,
  redactLog,
  looksLikeHighEntropyToken
};
