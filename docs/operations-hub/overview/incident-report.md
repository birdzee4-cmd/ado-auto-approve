# Incident Report

The Operations Hub sidebar now includes Report at `/operations.html#/reports`.

- Weekly periods run Monday through Sunday; monthly periods use calendar months. All date boundaries use Asia/Bangkok, consistent with the dashboard API.
- Counts use records first seen in the period, falling back to received/created timestamps when firstSeen is absent. Alert occurrenceCount is intentionally not a count of separate incidents.
- The page shows total incidents, distinct resources, resources with more than one incident, latest active/recovered status, daily frequency, resource rankings, and a paginated incident log with detail links.
- Resource identity includes subscription, resource group and resource name (case insensitive). Unknown resources remain visible. The report includes all resource types in the incident store; it does not infer that every resource is an App Service.
- Resource buttons filter the log. CSV exports all matching log records, including records beyond the current page.
- `GET /api/operations/reports?period=week|month&date=YYYY-MM-DD` uses existing Operations read roles. It follows all Graph pages without the dashboard's 1,000-record cap. Read failures return an error rather than partial totals. Invalid dates are rejected; records with unparseable start dates are reported as excluded.
- Active/recovered values reflect current monitoring state, not a historical end-of-period snapshot. Missing subscription/group metadata can limit resource identity matching.

Validation: TypeScript and production Vite build passed. Report tests cover Bangkok boundaries, weekly/year crossover, leap month, resource identity, empty periods, invalid dates, authorization and endpoint response. The existing operations-api suite has an unrelated capabilities expectation failure: it omits manualAlertStatus/manualCloseIncident booleans already present in the API.

Deployment: the existing Azure Static Web Apps workflow builds operations-ui and deploys public plus api on main/master pushes. Generated operations-assets are ignored. No production deployment or authenticated browser verification was performed in this change.

## Resource investigation extension

- Selecting a resource filters its daily chart and incident log, clears the date filter, and scrolls/focuses the investigation section. Clicking a chart bar or selecting an incident date filters the log using Asia/Bangkok dates.
- Resource rankings include distinct days affected and the latest incident start. The investigation summary lists environments, App Service Plans, and alert frequencies for the resource within the selected period.
- The log shows monitoring recovery time, valid nonnegative elapsed minutes to recovery, severity, and primary/related ADO work item links with role, stored state, and assignee. Missing recovery timestamps are not treated as zero duration; monitoring recovery is not confirmed downtime.
- The report reader loads all configured related-work-item pages as well as incident pages. If either read fails, the endpoint fails instead of presenting an incomplete report. Related work items require the existing work-items list configuration and read permissions.
- CSV exports all records matching resource/date filters, beyond pagination, with recovery, environment, plan, metric/value/threshold, severity, work item roles, URLs, states and assignees. It retains formula-prefix escaping.
- Scope remains incidents first seen during the week/month. No cross-period backlog, historical status snapshot, deployment correlation, or confirmed downtime is inferred.
