# Operations Hub v3.8.6 lifecycle repair

## What this release fixes

The v3.8.5 export cannot complete the intended FIRING-to-RESOLVED lifecycle:

- The Outlook trigger filters for `🔥 ALERT FIRING`, so RESOLVED messages never start a run.
- Subject routing accepts NOWALERT App Service FIRING only.
- The FIRING duplicate condition compares priority to a controlled-test sentinel and therefore never takes the existing-incident branch.
- Message-level duplicate detection searches `SourceMessageId` but not `LastSourceMessageId`.

The v3.8.6 builder removes the trigger subject filter, accepts NOWALERT App Service FIRING and RESOLVED subjects, restores IncidentId dedup, and searches both message ID fields. It refuses to build when the existing RESOLVED correlation query does not constrain Title, Resource, open FIRING status, null ResolvedAt, and event ordering.

## Deliberate limitation

Trigger concurrency remains `1`. The flow waits up to 15 minutes inside its approval action, so later email can queue. Raising concurrency before the approval stage is moved into a second flow is unsafe: the current SharePoint query-before-create sequence is not atomic and parallel FIRING runs can create duplicate incidents and Azure DevOps work items.

The next architecture step is to split the solution into:

1. A short-running ingestion flow that parses, correlates, and records FIRING/RESOLVED events.
2. An asynchronous approval/work-item flow triggered by a SharePoint state transition.

Only after that split should ingestion concurrency be increased.

## Build and verify

```powershell
node scripts\build-operations-hub-v386-lifecycle-fix.js <extracted-v3.8.5> <new-output-directory>
node scripts\validate-operations-hub-v386-lifecycle-fix.js <new-output-directory>
```

The builder never overwrites its source or an existing output directory.

## Safe rollout

1. Import v3.8.6 into a non-production environment and bind the existing Outlook, SharePoint, Teams, Approvals, and Azure DevOps connections.
2. Keep the production v3.8.5 flow enabled during non-production validation.
3. Run controlled UAT with unique alert/resource names:
   - First P1 FIRING creates one SharePoint incident and one Azure DevOps work item.
   - Repeated FIRING updates the same incident and does not create another work item.
   - RESOLVED updates the matching open FIRING incident and records `LastSourceMessageId`.
   - Replaying either email does not change the record a second time.
   - An unmatched RESOLVED is recorded as CANCELLED for audit rather than creating a work item.
4. Export the UAT-tested definition and run the validator against that export.
5. Schedule a short cutover window. Disable v3.8.5, enable v3.8.6, then send one controlled FIRING/RESOLVED pair.
6. Roll back by disabling v3.8.6 and re-enabling v3.8.5. Do not run both flows against the same mailbox folder simultaneously.

## Production acceptance evidence

Record the flow run IDs, SharePoint item ID, IncidentId, Azure DevOps work item ID, received/resolved timestamps, occurrence count, and screenshots for every UAT case. Production write feature flags remain off until this evidence is reviewed.
