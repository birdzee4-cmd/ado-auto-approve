# Operations Hub auto-restart guard (draft)

The scheduled Operations Hub reconciliation now contains an optional fail-closed path for automatic App Service restart.

It only proceeds when all of the following are true:

- `OPERATIONS_AUTO_RESTART_ENABLED=true`
- `OPERATIONS_RESTART_ENABLED=true`
- the incident is still `FIRING`
- priority is `P1`
- the alert/resource identifies an Azure App Service
- at least five minutes have elapsed since `FirstSeen`
- a primary VSTS Work Item exists
- no prior automatic restart attempt was recorded for the incident

The attempt is recorded before the Azure restart request with the audit key `operations-auto-restart:<incidentId>`. This prevents a scheduler retry from issuing a second production restart. The existing restart implementation is reused, so the normal audit entry, VSTS Discussion, and `ITSupport_Tier1` tag behavior remain consistent with the Operations Hub button.

The feature remains disabled unless `OPERATIONS_AUTO_RESTART_ENABLED` is explicitly enabled. The scheduler must continue to use the configured `OPERATIONS_AUTOMATION_KEY`, and the existing restart/App Service and Azure DevOps credentials must be available.
