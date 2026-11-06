# Deployment Analytics Implementation Plan

## Scope lock

- `Monitor งานประจำวัน` remains unchanged and is not part of this redesign.
- The new Deployment Analytics surface is read-only.
- No Azure DevOps resource, pipeline, build, PR, deployment, or Service Hook configuration is written by the UI.
- Existing user changes in the worktree are unrelated and must be preserved.

## Phase 0 baseline

- Confirmed the daily monitor is isolated in `public/company-deployment-monitor.js` and uses `GET /api/company-deployment-monitor`.
- Confirmed the Deployment Events surface uses read-only `GET` endpoints for event history and summaries.
- Confirmed the current worktree already contains unrelated user changes; they are not part of this work.

## Phase 1 delivered in this revision

- Add a separate Analytics navigation shell for organization overview, pipeline health, events, build analytics, and performance.
- Keep the existing event table and the daily monitor available as drill-down/legacy views.
- Add explicit source and data-freshness labels so Service Hook, Azure DevOps API, and Company Monitor data are not conflated.
- Add read-only dashboard cards and trend views backed by the existing event payload.

## Next phases

## Phase 2 delivered in this revision

- Add `GET /api/ado-deployment-analytics` as a read-only normalized analytics endpoint.
- Calculate project/pipeline counts, result/environment breakdowns, average duration, P50, P80, and P95 from persisted event timestamps.
- Keep unavailable metrics explicit; queue time and agent usage are not invented when the source event has no evidence.
- Add unit assertions for the normalization and percentile calculations.

## Next phases

1. Add pipeline drill-down and richer build history from verified Azure DevOps read APIs.
2. Add UAT reconciliation against known Azure DevOps runs.
3. Promote the new Analytics view after regression verification; retain the old view as fallback.
