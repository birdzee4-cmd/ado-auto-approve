// No owner-approved mappings have been supplied. Never infer outcome from codes,
// readiness, completion dates, stage timestamps, or the Azure Tables model.
const mappingVersion = 'unconfirmed';

function statusOf(rawCode) {
  if (rawCode !== null && !Number.isInteger(rawCode)) {
    throw new TypeError('Status must be a SQL integer or null');
  }
  return {
    rawCode,
    labelTh: rawCode === null ? 'ไม่ทราบสถานะ (ไม่ระบุรหัส)' : `ไม่ทราบสถานะ (รหัส ${rawCode})`,
    category: 'unknown',
    isTerminal: null,
    ownerEvidence: null
  };
}

module.exports = { mappingVersion, statusOf };
