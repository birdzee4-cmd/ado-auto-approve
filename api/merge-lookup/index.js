const ado = require('../shared/ado-client');
const {
  findMergePipelineRule,
  findStagingPipelineMappingByCi,
  findPossibleStagingPipelineMapping,
  buildCandidateTokens,
  getPartnerCountry,
  getPipelineCountry,
  isMergePr
} = require('../shared/merge-pipeline-map');

function shortBranch(refName) {
  return String(refName || '').replace(/^refs\/heads\//i, '');
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function parsePrId(value) {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
}

function getBuildDate(build) {
  return Date.parse(build && (build.queueTime || build.startTime || build.finishTime));
}

function pickRelevantBuild(pr, builds, rule) {
  const values = Array.isArray(builds) ? builds : [];
  const openedAt = Date.parse(pr && pr.creationDate);
  const closedAt = Date.parse(pr && (pr.closedDate || pr.completionDate));
  const upperBound = Number.isFinite(closedAt) ? closedAt + 60 * 60 * 1000 : Date.now() + 60 * 60 * 1000;
  const expectedCiName = rule && rule.ci && rule.ci.name;

  const relevant = values
    .filter(build => {
      const date = getBuildDate(build);
      return Number.isFinite(date) &&
        (!Number.isFinite(openedAt) || date >= openedAt) &&
        date <= upperBound;
    })
    .sort((a, b) => getBuildDate(b) - getBuildDate(a));

  const candidates = relevant.length
    ? relevant
    : values
      .filter(build => Number.isFinite(getBuildDate(build)))
      .sort((a, b) => getBuildDate(b) - getBuildDate(a));

  if (!candidates.length) return null;

  if (expectedCiName) {
    const exact = candidates.find(build =>
      normalizeName(build && build.definition && build.definition.name) === normalizeName(expectedCiName)
    );
    if (exact) return exact;
  }

  return candidates[0];
}

function adoErrorDto(result) {
  if (!result || result.ok) return null;
  const body = result.body || {};
  return {
    status: Number(result.status) || 0,
    message: String(body.message || body.error && body.error.message || body.error || 'Azure DevOps lookup failed')
  };
}

async function getDetectedBuild(repositoryId, branchName, pr, rule, authOptions) {
  if (!repositoryId || !branchName) return { branch: '', build: null, count: 0 };
  const result = await ado.getBuildsForBranch(repositoryId, branchName, 20, authOptions);
  if (!result.ok) return { branch: branchName, build: null, count: 0, error: adoErrorDto(result) };
  const builds = Array.isArray(result.body && result.body.value) ? result.body.value : [];
  return {
    branch: branchName,
    build: pickRelevantBuild(pr, builds, rule),
    count: builds.length
  };
}

function parseBuildId(value) {
  const text = String(value || '');
  const match = text.match(/[?&]buildId=(\d+)/i) || text.match(/\/builds\/(\d+)/i);
  return match ? match[1] : '';
}

function buildIdsFromStatuses(statuses) {
  const values = Array.isArray(statuses) ? statuses : [];
  return [...new Set(values.map(status =>
    parseBuildId(status && status.targetUrl) ||
    parseBuildId(status && status.description) ||
    parseBuildId(status && status.context && status.context.name)
  ).filter(Boolean))];
}

async function getDetectedBuildFromPrStatus(repositoryId, pr, expectedCiName, authOptions) {
  const statusResult = await ado.getPullRequestStatuses(repositoryId, pr.pullRequestId, authOptions);
  if (!statusResult.ok) return { build: null, error: adoErrorDto(statusResult), buildIds: [] };
  const statuses = Array.isArray(statusResult.body && statusResult.body.value)
    ? statusResult.body.value
    : [];
  const buildIds = buildIdsFromStatuses(statuses);
  const builds = [];
  for (const buildId of buildIds.slice(0, 5)) {
    const buildResult = await ado.getBuildById(buildId, authOptions);
    if (buildResult.ok && buildResult.body && buildResult.body.id) {
      builds.push(buildResult.body);
    }
  }
  const exact = expectedCiName && builds.find(build =>
    normalizeName(build && build.definition && build.definition.name) === normalizeName(expectedCiName)
  );
  return { build: exact || builds[0] || null, buildIds };
}

function buildToDto(build, branchName) {
  if (!build) return null;
  return {
    id: build.id || '',
    name: build.definition && build.definition.name || '',
    definitionId: build.definition && build.definition.id || '',
    status: build.status || '',
    result: build.result || '',
    queueTime: build.queueTime || '',
    startTime: build.startTime || '',
    finishTime: build.finishTime || '',
    branch: shortBranch(branchName),
    url: build._links && build._links.web && build._links.web.href || ''
  };
}

function getPrWebUrl(pr) {
  return pr && pr.repository && pr.repository.webUrl
    ? pr.repository.webUrl + '/pullrequest/' + pr.pullRequestId
    : pr && pr.url || '';
}

function historicalMinTime(pr) {
  const created = Date.parse(pr && pr.creationDate);
  const anchor = Number.isFinite(created) ? created : Date.now();
  return new Date(anchor - 548 * 24 * 60 * 60 * 1000).toISOString();
}

function buildMatchesComponent(build, tokens) {
  const haystack = normalizeName([
    build && build.sourceBranch,
    build && build.definition && build.definition.name
  ].filter(Boolean).join(' ')).replace(/[^a-z0-9]+/g, '');
  return (tokens || []).some(token => token.length >= 5 && haystack.includes(token));
}

function buildMatchesCountry(build, countryCode) {
  if (!countryCode) return true;
  return getPipelineCountry({
    ciName: build && build.definition && build.definition.name || '',
    ciFolder: build && build.definition && build.definition.path || ''
  }).code === countryCode;
}

function closestCompletedPr(build, pullRequests) {
  const buildTime = getBuildDate(build);
  const branch = normalizeName(build && build.sourceBranch);
  return (Array.isArray(pullRequests) ? pullRequests : [])
    .filter(item => normalizeName(item && item.targetRefName) === branch)
    .filter(item => {
      const closed = Date.parse(item && (item.closedDate || item.completionDate));
      return !Number.isFinite(buildTime) || !Number.isFinite(closed) || closed <= buildTime + 5 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(b.closedDate || b.completionDate || 0) - Date.parse(a.closedDate || a.completionDate || 0))[0] || null;
}

async function getHistoricalEvidence(repositoryId, pr, mapping, authOptions) {
  if (!repositoryId || !mapping || !(mapping.ciId || mapping.ciName)) {
    return { evidence: [], count: 0, confidence: '', error: null };
  }
  const tokens = buildCandidateTokens(pr);
  const country = getPartnerCountry(pr);
  if (!tokens.length) return { evidence: [], count: 0, confidence: '', error: null };

  const buildResult = await ado.listBuilds({
    repositoryId,
    definitions: mapping.ciId || '',
    minTime: historicalMinTime(pr),
    top: 100,
    accessToken: authOptions && authOptions.accessToken
  });
  if (!buildResult.ok) {
    return { evidence: [], count: 0, confidence: '', error: adoErrorDto(buildResult) };
  }

  const builds = (Array.isArray(buildResult.body && buildResult.body.value) ? buildResult.body.value : [])
    .filter(build => !mapping.ciName || normalizeName(build && build.definition && build.definition.name) === normalizeName(mapping.ciName))
    .filter(build => buildMatchesComponent(build, tokens))
    .filter(build => buildMatchesCountry(build, country.code))
    .filter(build => {
      const branch = normalizeName(build && build.sourceBranch);
      return branch !== normalizeName(pr && pr.sourceRefName) &&
        branch !== normalizeName(pr && pr.targetRefName);
    })
    .sort((a, b) => getBuildDate(b) - getBuildDate(a));
  if (!builds.length) return { evidence: [], count: 0, confidence: '', error: null };

  const branches = [...new Set(builds.slice(0, 6).map(build => build.sourceBranch).filter(Boolean))];
  const prResults = await Promise.all(branches.map(branch =>
    ado.getPullRequestsForTargetBranch(repositoryId, branch, 20, authOptions)
  ));
  const pullRequests = prResults.flatMap(result =>
    result.ok && Array.isArray(result.body && result.body.value) ? result.body.value : []
  );
  const evidence = builds.slice(0, 6).map(build => {
    const matchedPr = closestCompletedPr(build, pullRequests);
    return {
      build: buildToDto(build, build.sourceBranch),
      pr: matchedPr ? {
        id: matchedPr.pullRequestId,
        title: matchedPr.title || '',
        closedDate: matchedPr.closedDate || '',
        url: getPrWebUrl(matchedPr)
      } : null
    };
  });
  const distinctPrIds = new Set(evidence.map(item => item.pr && item.pr.id).filter(Boolean));
  const confidence = distinctPrIds.size >= 2 || evidence.length >= 2 ? 'high' : 'medium';
  return { evidence, count: builds.length, confidence, error: null };
}

function classify(recommended, detected) {
  const mappedCi = recommended && recommended.ciName;
  const detectedCi = detected && detected.name;
  if (mappedCi && detectedCi && normalizeName(mappedCi) === normalizeName(detectedCi)) return 'matched';
  if (mappedCi && detectedCi) return 'mismatch';
  if (mappedCi) return 'mapped-only';
  if (detectedCi) return 'detected-only';
  return 'not-found';
}

module.exports = async function (context, req) {
  const responseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  function jsonResponse(status, body) {
    context.res = { status, headers: responseHeaders, body };
  }

  const prId = parsePrId(req.query && req.query.prId);
  if (!prId) {
    jsonResponse(400, { ok: false, error: 'PR ID is required' });
    return;
  }

  try {
    const auth = require('../shared/auth');
    const principal = auth.parseClientPrincipal(req.headers);
    if (!principal) {
      jsonResponse(401, { ok: false, error: 'Authentication required' });
      return;
    }

    const delegated = require('../shared/ado-user-token');
    const userToken = await delegated.getValidAccessToken(req, principal, { allowStoreRecovery: true });
    if (!userToken.ok) {
      jsonResponse(userToken.status || 428, {
        ok: false,
        error: userToken.error || 'Azure DevOps connection required',
        detail: userToken.detail || '',
        connectUrl: '/api/ado-auth-start?returnTo=/merge.html'
      });
      return;
    }
    if (userToken.setCookie) responseHeaders['Set-Cookie'] = userToken.setCookie;
    const userAuth = { accessToken: userToken.accessToken };

    const prResp = await ado.getPullRequest(prId, userAuth);
    if (!prResp.ok) {
      const adoStatus = Number(prResp.status);
      const status = adoStatus === 401
        ? 428
        : [403, 404].includes(adoStatus)
        ? adoStatus
        : 502;
      const errors = {
        428: 'Azure DevOps connection is no longer valid',
        403: 'Your Azure DevOps account cannot access this Pull Request',
        404: 'Pull Request not found'
      };
      jsonResponse(status, {
        ok: false,
        error: errors[status] || 'Azure DevOps lookup failed',
        adoStatus: adoStatus || null,
        detail: prResp.body || null,
        connectUrl: status === 428 ? '/api/ado-auth-start?returnTo=/merge.html' : undefined
      });
      return;
    }
    if (!prResp.body || !prResp.body.pullRequestId) {
      jsonResponse(502, {
        ok: false,
        error: 'Azure DevOps returned an invalid Pull Request response'
      });
      return;
    }

    const pr = prResp.body;
    const repositoryId = pr.repository && pr.repository.id;
    const rule = findMergePipelineRule(pr);
    const partnerCountry = getPartnerCountry(pr);
    const branchCandidate = !rule ? findPossibleStagingPipelineMapping(pr) : null;

    let detectedTarget = await getDetectedBuild(repositoryId, pr.targetRefName, pr, rule, userAuth);
    let detectedSource = { branch: pr.sourceRefName, build: null, count: 0 };
    let detected = detectedTarget;
    if (!detectedTarget.build && pr.sourceRefName) {
      detectedSource = await getDetectedBuild(repositoryId, pr.sourceRefName, pr, rule, userAuth);
      detected = detectedSource.build ? detectedSource : detectedTarget;
    }

    let detectedPrStatus = { build: null, buildIds: [] };
    if (!detected.build) {
      const expectedCiName = rule && rule.ci && rule.ci.name || branchCandidate && branchCandidate.ciName || '';
      detectedPrStatus = await getDetectedBuildFromPrStatus(repositoryId, pr, expectedCiName, userAuth);
      if (detectedPrStatus.build) {
        detected = {
          branch: detectedPrStatus.build.sourceBranch || '',
          build: detectedPrStatus.build,
          count: 1,
          origin: 'pr-status'
        };
      }
    }

    const detectedBuild = buildToDto(detected.build, detected.branch);
    const detectedCountry = detectedBuild
      ? getPipelineCountry({ ciName: detectedBuild.name })
      : { code: '', name: '', inferred: false };
    const stgMapping = !rule && detectedBuild
      ? findStagingPipelineMappingByCi(detectedBuild.name)
      : null;
    const historical = !rule && !detectedBuild && !stgMapping && branchCandidate
      ? await getHistoricalEvidence(repositoryId, pr, branchCandidate, userAuth)
      : { evidence: [], count: 0, confidence: '', error: null };
    const historicalMatch = historical.evidence.length > 0;
    const recommended = rule ? {
      source: 'branch-rule',
      ciName: rule.ci && rule.ci.name || '',
      cdName: rule.cd && rule.cd.name || '',
      environment: rule.environment || '',
      confidence: rule.confidence || '',
      country: partnerCountry,
      note: 'Recommended by branch mapping rule'
    } : stgMapping ? {
      source: 'staging-csv',
      ciName: stgMapping.ciName || '',
      cdName: stgMapping.cdName || '',
      ciId: stgMapping.ciId || '',
      ciFolder: stgMapping.ciFolder || '',
      cdId: stgMapping.cdId || '',
      cdPath: stgMapping.cdPath || '',
      environment: 'STG',
      confidence: 'high',
      country: partnerCountry,
      note: 'Recommended by Staging CI/CD mapping CSV'
    } : historicalMatch ? {
      source: 'historical-builds',
      ciName: branchCandidate.ciName || '',
      cdName: branchCandidate.cdName || '',
      ciId: branchCandidate.ciId || '',
      ciFolder: branchCandidate.ciFolder || '',
      cdId: branchCandidate.cdId || '',
      cdPath: branchCandidate.cdPath || '',
      environment: 'STG',
      confidence: historical.confidence || 'medium',
      country: partnerCountry,
      note: 'Verified from previous build runs for the same branch component'
    } : null;
    const possible = !recommended && branchCandidate ? {
      source: 'branch-name-candidate',
      ciName: branchCandidate.ciName || '',
      cdName: branchCandidate.cdName || '',
      ciId: branchCandidate.ciId || '',
      ciFolder: branchCandidate.ciFolder || '',
      cdId: branchCandidate.cdId || '',
      cdPath: branchCandidate.cdPath || '',
      environment: 'STG',
      confidence: 'medium',
      country: partnerCountry,
      note: 'Possible CI/CD inferred from component names in the PR branches. Please verify before use.'
    } : null;
    const lookupErrors = [
      detectedTarget.error ? { source: 'target-branch-builds', ...detectedTarget.error } : null,
      detectedSource.error ? { source: 'source-branch-builds', ...detectedSource.error } : null,
      detectedPrStatus.error ? { source: 'pr-statuses', ...detectedPrStatus.error } : null,
      historical.error ? { source: 'historical-builds', ...historical.error } : null
    ].filter(Boolean);
    const countryMismatch = partnerCountry.code && detectedBuild && detectedCountry.code !== partnerCountry.code;
    const status = countryMismatch
      ? 'country-mismatch'
      : historicalMatch
      ? 'historical'
      : recommended || detectedBuild
      ? classify(recommended, detectedBuild)
      : possible
      ? 'possible'
      : lookupErrors.length
      ? 'unavailable'
      : 'not-found';
    const webUrl = getPrWebUrl(pr);

    jsonResponse(200, {
        ok: true,
        pr: {
          id: pr.pullRequestId,
          title: pr.title || '',
          repository: pr.repository && pr.repository.name || '',
          sourceBranch: shortBranch(pr.sourceRefName),
          targetBranch: shortBranch(pr.targetRefName),
          status: pr.status || '',
          mergeStatus: pr.mergeStatus || '',
          createdBy: pr.createdBy && pr.createdBy.displayName || '',
          creationDate: pr.creationDate || '',
          closedDate: pr.closedDate || '',
          url: webUrl,
          country: partnerCountry,
          isMergePr: isMergePr(pr)
        },
        mapping: rule ? {
          matched: true,
          key: rule.key,
          label: rule.label,
          environment: rule.environment,
          confidence: rule.confidence,
          country: partnerCountry,
          source: 'branch-rule'
        } : stgMapping ? {
          matched: true,
          key: 'staging-csv:' + (stgMapping.ciName || ''),
          label: stgMapping.ciName || '',
          environment: 'STG',
          confidence: 'high',
          country: partnerCountry,
          source: 'staging-csv'
        } : historicalMatch ? {
          matched: true,
          key: 'historical:' + (branchCandidate.ciName || ''),
          label: branchCandidate.ciName || '',
          environment: 'STG',
          confidence: historical.confidence || 'medium',
          country: partnerCountry,
          source: 'historical-builds'
        } : {
          matched: false
        },
        recommended,
        possible,
        detected: {
          ci: detectedBuild,
          targetBuildCount: detectedTarget.count,
          sourceBuildCount: detectedSource.count,
          prStatusBuildIds: detectedPrStatus.buildIds,
          country: detectedCountry,
          origin: detected.origin || (detectedBuild ? 'branch' : '')
        },
        historical: {
          count: historical.count,
          confidence: historical.confidence,
          evidence: historical.evidence
        },
        lookupErrors,
        result: {
          status,
          message: {
            matched: 'Recommended CI matches detected build run',
            mismatch: 'Recommended CI is different from detected build run',
            'mapped-only': 'Found mapping rule, but no relevant build run was detected yet',
            'detected-only': 'Detected a build run, but no mapping rule matched this PR',
            'country-mismatch': 'Detected CI/CD country is different from the PR partner country',
            historical: 'CI/CD was verified from previous build runs for the same component',
            possible: 'No build evidence was found, but possible CI/CD was inferred from the PR branches',
            unavailable: 'Azure DevOps build history could not be read',
            'not-found': 'No mapping rule or build run was found'
          }[status] || status
        }
      });
  } catch (err) {
    context.log && context.log.error && context.log.error(err);
    jsonResponse(500, {
        ok: false,
        error: err.message || 'Merge lookup failed'
      });
  }
};

module.exports._test = {
  parseBuildId,
  buildIdsFromStatuses,
  buildMatchesComponent,
  buildMatchesCountry,
  closestCompletedPr,
  getHistoricalEvidence,
  pickRelevantBuild,
  classify
};
