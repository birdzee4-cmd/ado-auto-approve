// Requires the archive connection string in the process environment.
// Adds an idempotent event index without deleting or changing snapshots.
require('../api/shared/company-monitor-archive').store().backfillEvents()
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
