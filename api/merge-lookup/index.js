const ado = require('../shared/ado-client');
const { findMergePipelineRule, isMergePr } = require('../shared/merge-pipeline-map');

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

  if (!relevant.length) return null;

  if (expectedCiName) {
    const exact = relevant.find(build =>
      normalizeName(build && build.definition && build.definition.name) === normalizeName(expectedCiName)
    );
    if (exact) return exact;
  }

  return relevant[0];
}

async function getDetectedBuild(repositoryId, branchName, pr, rule) {
  if (!repositoryId || !branchName) return { branch: '', build: null, count: 0 };
  const result = await ado.getBuildsForBranch(repositoryId, branchName, 20);
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

function classify(rule, detected) {
  const mappedCi = rule && rule.ci && rule.ci.name;
  const detectedCi = detected && detected.name;
  if (mappedCi && detectedCi && normalizeName(mappedCi) === normalizeName(detectedCi)) return 'matched';
  if (mappedCi && detectedCi) return 'mismatch';
  if (mappedCi) return 'mapped-only';
  if (detectedCi) return 'detected-only';
  return 'not-found';
}

module.exports = async function (context, req) {
  const prId = parsePrId(req.query && req.query.prId);
  if (!prId) {
    context.res = {
      status: 400,
      body: { ok: false, error: 'PR ID is required' }
    };
    return;
  }

  try {
    const prResp = await ado.getPullRequest(prId);
    if (!prResp.ok || !prResp.body || !prResp.body.pullRequestId) {
      context.res = {
        status: prResp.status || 404,
        body: { ok: false, error: 'Pull Request not found', detail: prResp.body || null }
      };
      return;
    }

    const pr = prResp.body;
    const repositoryId = pr.repository && pr.repository.id;
    const rule = findMergePipelineRule(pr);

    let detectedTarget = await getDetectedBuild(repositoryId, pr.targetRefName, pr, rule);
    let detectedSource = { branch: pr.sourceRefName, build: null, count: 0 };
    let detected = detectedTarget;
    if (!detectedTarget.build && pr.sourceRefName) {
      detectedSource = await getDetectedBuild(repositoryId, pr.sourceRefName, pr, rule);
      detected = detectedSource.build ? detectedSource : detectedTarget;
    }

    const detectedBuild = buildToDto(detected.build, detected.branch);
    const status = classify(rule, detectedBuild);
    const webUrl = pr.repository && pr.repository.webUrl
      ? pr.repository.webUrl + '/pullrequest/' + pr.pullRequestId
      : (pr.url || '');

    context.res = {
      status: 200,
      body: {
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
          confidence: rule.confidence
        } : {
          matched: false
        },
        recommended: rule ? {
          ciName: rule.ci && rule.ci.name || '',
          cdName: rule.cd && rule.cd.name || '',
          note: 'Recommended by branch mapping rule'
        } : null,
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
            'not-found': 'No mapping rule or build run was found'
          }[status] || status
        }
      }
    };
  } catch (err) {
    context.log && context.log.error && context.log.error(err);
    context.res = {
      status: 500,
      body: {
        ok: false,
        error: err.message || 'Merge lookup failed'
      }
    };
  }
};
