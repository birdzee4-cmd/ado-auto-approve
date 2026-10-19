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
