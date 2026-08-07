const ado = require('../shared/ado-client');
const {
  findMergePipelineRule,
  findStagingPipelineMappingByCi,
  findPossibleStagingPipelineMapping,
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

async function getDetectedBuild(repositoryId, branchName, pr, rule, authOptions) {
  if (!repositoryId || !branchName) return { branch: '', build: null, count: 0 };
  const result = await ado.getBuildsForBranch(repositoryId, branchName, 20, authOptions);
  if (!result.ok) return { branch: branchName, build: null, count: 0, error: result.body };
  const builds = Array.isArray(result.body && result.body.value) ? result.body.value : [];
  return {
    branch: branchName,
    build: pickRelevantBuild(pr, builds, rule),
    count: builds.length
  };
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

    let detectedTarget = await getDetectedBuild(repositoryId, pr.targetRefName, pr, rule, userAuth);
    let detectedSource = { branch: pr.sourceRefName, build: null, count: 0 };
    let detected = detectedTarget;
    if (!detectedTarget.build && pr.sourceRefName) {
      detectedSource = await getDetectedBuild(repositoryId, pr.sourceRefName, pr, rule, userAuth);
      detected = detectedSource.build ? detectedSource : detectedTarget;
    }

    const detectedBuild = buildToDto(detected.build, detected.branch);
    const stgMapping = !rule && detectedBuild
      ? findStagingPipelineMappingByCi(detectedBuild.name)
      : null;
    const recommended = rule ? {
      source: 'branch-rule',
      ciName: rule.ci && rule.ci.name || '',
      cdName: rule.cd && rule.cd.name || '',
      environment: rule.environment || '',
      confidence: rule.confidence || '',
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
      note: 'Recommended by Staging CI/CD mapping CSV'
    } : null;
    const possibleMapping = !recommended
      ? findPossibleStagingPipelineMapping(pr)
      : null;
    const possible = possibleMapping ? {
      source: 'repo-name-candidate',
      ciName: possibleMapping.ciName || '',
      cdName: possibleMapping.cdName || '',
      ciId: possibleMapping.ciId || '',
      ciFolder: possibleMapping.ciFolder || '',
      cdId: possibleMapping.cdId || '',
      cdPath: possibleMapping.cdPath || '',
      environment: 'STG',
      confidence: 'medium',
      note: 'Possible CI/CD inferred from repository name. Please verify before use.'
    } : null;
    const status = recommended || detectedBuild
      ? classify(recommended, detectedBuild)
      : possible
      ? 'possible'
      : 'not-found';
    const webUrl = pr.repository && pr.repository.webUrl
      ? pr.repository.webUrl + '/pullrequest/' + pr.pullRequestId
      : (pr.url || '');

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
          isMergePr: isMergePr(pr)
        },
        mapping: rule ? {
          matched: true,
          key: rule.key,
          label: rule.label,
          environment: rule.environment,
          confidence: rule.confidence,
          source: 'branch-rule'
        } : stgMapping ? {
          matched: true,
          key: 'staging-csv:' + (stgMapping.ciName || ''),
          label: stgMapping.ciName || '',
          environment: 'STG',
          confidence: 'high',
          source: 'staging-csv'
        } : {
          matched: false
        },
        recommended,
        possible,
        detected: {
          ci: detectedBuild,
          targetBuildCount: detectedTarget.count,
          sourceBuildCount: detectedSource.count
        },
        result: {
          status,
          message: {
            matched: 'Recommended CI matches detected build run',
            mismatch: 'Recommended CI is different from detected build run',
            'mapped-only': 'Found mapping rule, but no relevant build run was detected yet',
            'detected-only': 'Detected a build run, but no mapping rule matched this PR',
            possible: 'No confirmed mapping was found, but possible CI/CD was inferred',
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
