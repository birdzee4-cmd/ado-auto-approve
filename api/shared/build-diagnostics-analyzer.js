'use strict';

const catalog = require('./build-diagnostics-catalog');
const { redactLog } = require('./build-diagnostics-redactor');

const ERROR_PRIORITY = {
  DOCKER_BUILDKIT_SECRET_MISSING: 120,
  NEXT_TURBOPACK_DUPLICATE_IDENTIFIER: 110,
  NU3012: 105,
  CS_COMPILE_ERROR: 95,
  TS_COMPILE_ERROR: 95,
  NPM_CONFLICT: 90,
  ESLINT_ERROR: 85,
  UNIT_TEST_FAILURE: 80,
  GIT_MERGE_CONFLICT: 75,
  TIMEOUT: 70,
  NETSDK1045: 70,
  DOCKER_BUILD_ERROR: 20,
  GENERIC_ERROR: 0
};

const CONFIDENCE_PRIORITY = { high: 20, medium: 10, low: 0 };

function lineEvidence(text, pattern, kind) {
  const lines = String(text || '').split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return null;
  return { lineNumber: index + 1, text: lines[index].trim(), kind: kind };
}

function collectWrapperErrors(text) {
  const pattern = /(failed to solve|executor failed running|The process '\/usr\/bin\/docker' failed|docker failed with exit code|ERROR: failed to build|exit code:\s*\d+)/i;
  const seen = new Set();
  return String(text || '').split(/\r?\n/).reduce((items, line, index) => {
    const value = line.trim();
    if (!value || !pattern.test(value) || seen.has(value)) return items;
    seen.add(value);
    items.push({ lineNumber: index + 1, text: value, kind: 'wrapper' });
    return items;
  }, []).slice(0, 8);
}

function detectBuildKitSecretMissing(text) {
  const missingPathMatch = text.match(/cat:\s*(\/run\/secrets\/([A-Za-z0-9_.-]+)):\s*No such file or directory/i)
    || text.match(/(\/run\/secrets\/([A-Za-z0-9_.-]+))[^\r\n]*(?:not found|does not exist)/i);
  const mountMatch = text.match(/--mount=type=secret(?:,[^\r\n ]*)?\bid=([A-Za-z0-9_.-]+)/i);
  if (!missingPathMatch && !mountMatch) return null;

  const secretName = (missingPathMatch && missingPathMatch[2]) || (mountMatch && mountMatch[1]) || 'unknown';
  const secretPath = (missingPathMatch && missingPathMatch[1]) || `/run/secrets/${secretName}`;
  const missingEvidence = lineEvidence(text, new RegExp(escapeRegExp(secretPath) + '.*(?:No such file|not found|does not exist)', 'i'), 'root-cause');
  if (!missingEvidence) return null;

  const passwordEvidence = lineEvidence(text, /Value cannot be null or empty string.*password|password[^\r\n]*(?:null|empty)/i, 'consequence');
  const restoreEvidence = lineEvidence(text, /dotnet\s+restore|NuGet[^\r\n]*(?:restore|authentication).*fail/i, 'failed-command');
  const mountEvidence = lineEvidence(text, /--mount=type=secret/i, 'configuration');
  const evidence = [missingEvidence, mountEvidence, passwordEvidence, restoreEvidence].filter(Boolean);
  const failedCommand = /dotnet\s+restore/i.test(text) ? 'dotnet restore' : '';
  const snippet = selectSnippetAround(text, missingEvidence.lineNumber, 3, 10);

  return {
    matched: true,
    status: 'classified',
    analyzerSource: 'rule',
    confidence: 'high',
    errorKey: 'DOCKER_BUILDKIT_SECRET_MISSING',
    failureLayer: 'docker-buildkit',
    title: 'Docker BuildKit Secret Missing (ไม่พบ Secret ระหว่าง Docker Build)',
    description: `Dockerfile ต้องการ Secret ชื่อ ${secretName} แต่ไม่พบไฟล์ ${secretPath} ทำให้ credential ที่คำสั่งถัดไปต้องใช้เป็นค่าว่าง`,
    rootCauseSummary: `Build ล้มเหลวเพราะ Docker Build ไม่ได้รับ BuildKit Secret ชื่อ ${secretName} (${secretPath} ไม่พบ)`,
    exactError: {
      file: 'Dockerfile',
      line: null,
      column: null,
      command: failedCommand || null,
      message: `${secretPath}: No such file or directory`,
      secretName: secretName,
      secretPath: secretPath
    },
    evidence: evidence,
    causalChain: [
      `${secretName} was not mounted into Docker Build`,
      `${secretPath} was unavailable`,
      'NuGet credential became empty',
      `${failedCommand || 'restore/build command'} failed`,
      'Docker build exited with an error'
    ],
    impactChain: [
      `${failedCommand || 'restore/build command'} failed`,
      'Docker build failed',
      'Push image skipped'
    ],
    wrapperErrors: collectWrapperErrors(text),
    warnings: [],
    missingInformation: [],
    solutions: [
      {
        title: 'ตรวจสอบการส่ง Secret ในคำสั่ง Docker Build',
        details: `ตรวจสอบ task หรือคำสั่ง docker build / docker buildx build ว่าส่ง \`--secret id=${secretName},...\` และชื่อ id ตรงกับ Dockerfile`
      },
      {
        title: 'ตรวจสอบ Pipeline variable และเพิ่ม fail-fast',
        details: `ตรวจสอบว่า variable ที่ใช้สร้าง ${secretName} มีค่า ถูก expose ให้ job และยังไม่หมดอายุ จากนั้นกำหนด secret mount เป็น required หรือทดสอบ \`test -s ${secretPath}\` โดยไม่พิมพ์ค่า Secret`
      }
    ],
    snippet: snippet.snippet,
    startLineNumber: snippet.startLineNumber
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectSnippetAround(text, lineNumber, before, after) {
  const lines = String(text || '').split(/\r?\n/);
  const index = Math.max(0, Number(lineNumber || 1) - 1);
  const start = Math.max(0, index - before);
  return {
    snippet: lines.slice(start, Math.min(lines.length, index + after + 1)).join('\n'),
    startLineNumber: start + 1
  };
}

function evidenceForLegacy(text, result) {
  const patterns = {
    NEXT_TURBOPACK_DUPLICATE_IDENTIFIER: /the name `[^`]+` is defined multiple times/i,
    NU3012: /error NU3012/i,
    CS_COMPILE_ERROR: /error CS\d{4}:/i,
    TS_COMPILE_ERROR: /error TS\d{4}:|failed to type check|type error:/i,
    NPM_CONFLICT: /npm ERR! (?:code ERESOLVE|peer)/i,
    ESLINT_ERROR: /\d+\s+problems?\s+\(\d+\s+errors?/i,
    GIT_MERGE_CONFLICT: /automatic merge failed|merge conflict/i,
    TIMEOUT: /timed out|timeout|operation was canceled/i,
    UNIT_TEST_FAILURE: /(failed|failure)\s+:[^\n]*test|assert\.fail|expected[^\n]*actual/i
  };
  const pattern = patterns[result.errorKey];
  const evidence = pattern ? [lineEvidence(text, pattern, 'root-cause')].filter(Boolean) : [];
  if (!evidence.length && result.errorKey !== 'DOCKER_BUILD_ERROR' && result.errorKey !== 'GENERIC_ERROR') {
    const fallback = lineEvidence(text, /error|failed|exception|fatal/i, 'error');
    if (fallback) evidence.push(fallback);
  }
  return evidence;
}

function canonicalizeLegacy(text, legacy) {
  const wrappers = collectWrapperErrors(text);
  const evidence = evidenceForLegacy(text, legacy);
  const isGeneric = legacy.errorKey === 'GENERIC_ERROR' || legacy.matched === false;
  const isWrapper = legacy.errorKey === 'DOCKER_BUILD_ERROR';
  const status = isGeneric ? 'unclassified' : (isWrapper ? 'partial' : 'classified');
  const confidence = isGeneric || isWrapper ? 'low' : (evidence.length ? 'medium' : 'low');
  const missingInformation = [];
  if (isGeneric) missingInformation.push('ไม่พบ pattern ที่ระบุ Root Cause ได้จาก Log ที่มีอยู่');
  if (isWrapper) missingInformation.push('พบเพียง Docker wrapper error แต่ไม่พบข้อผิดพลาดต้นเหตุที่เฉพาะเจาะจง');

  return Object.assign({}, legacy, {
    status: status,
    analyzerSource: 'rule',
    confidence: confidence,
    evidence: evidence,
    causalChain: Array.isArray(legacy.impactChain) ? legacy.impactChain.slice() : [],
    wrapperErrors: wrappers,
    missingInformation: missingInformation,
    rootCauseSummary: isGeneric
      ? 'ยังไม่พบสาเหตุหลักจากหลักฐานใน Log ที่มีอยู่'
      : legacy.rootCauseSummary
  });
}

function analyzeLog(logText) {
  const redacted = redactLog(logText);
  const text = catalog.sanitizeLog(redacted.text);
  const result = detectBuildKitSecretMissing(text) || canonicalizeLegacy(text, catalog.diagnoseLog(text));
  result.redactionSummary = redacted.summary;
  return result;
}

function scoreResult(result) {
  return (ERROR_PRIORITY[result && result.errorKey] || 0)
    + (CONFIDENCE_PRIORITY[result && result.confidence] || 0)
    + (Array.isArray(result && result.evidence) && result.evidence.length ? 3 : 0);
}

module.exports = {
  analyzeLog,
  detectBuildKitSecretMissing,
  scoreResult,
  ERROR_PRIORITY
};
