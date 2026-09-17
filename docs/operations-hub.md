# Operations Hub V1

Operations Hub is a read-only incident tracking module in the existing repository and Azure Static Web App. Its canonical production entry point is:

`https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html`

Power Automate remains the automation engine for Outlook alerts, Teams messages, approvals, and Azure DevOps work-item creation. A dedicated SharePoint List is the V1 incident store. The existing Static Web Apps Managed API reads that list for the authenticated dashboard.

```text
Alert email
    |
    v
Power Automate
    +-- Teams notification
    +-- Approval
    +-- Azure DevOps work item
    +-- Create/update SharePoint incident
                         |
                         v
applications.html -> operations.html -> /api/operations/* -> SharePoint List
```

## Components

- `operations-ui/` — React, TypeScript, and Vite read-only dashboard.
- `public/operations.html` — thin entry point using hash routing.
- `api/operations/` — role-protected HTTP API for dashboard, incident list, and incident details.
- `api/shared/operations-sharepoint-client.js` — read-only Microsoft Graph client for the Operations Hub list.
- Power Automate — owns alert parsing, approval, ADO creation, and status synchronization. Flow changes are intentionally handled separately from this code deployment.

V1 does not deploy a dedicated Operations Function App, Storage Account, Graph webhook, Queue worker, Timer trigger, or Operations Hub-specific OAuth flow.

## Authentication and authorization

`/operations.html`, `/operations-assets/*`, and `/api/operations/*` require `it_support_approve` or `admin`. The API repeats the role check using the Static Web Apps client principal. The browser never receives Microsoft Graph credentials.

The API is read-only:

- `GET /api/operations/dashboard`
- `GET /api/operations/incidents?status=&search=`
- `GET /api/operations/incidents/{incidentId}`

## SharePoint configuration

Create a dedicated list named `Operations Hub Incidents`. Use internal column names without spaces so Power Automate and Microsoft Graph use stable names.

Recommended columns:

| Internal name | Suggested type | Purpose |
|---|---|---|
| `Title` | Single line text | Alert title |
| `IncidentId` | Single line text, indexed | Stable incident/correlation ID |
| `SourceMessageId` | Single line text, indexed | Outlook message ID for deduplication |
| `AlertStatus` | Choice | `FIRING` or `RESOLVED` |
| `WorkflowStatus` | Choice | `RECEIVED`, `AWAITING_APPROVAL`, `CREATED`, `REJECTED`, `FAILED`, `CANCELLED` |
| `Priority` | Choice | P1-P4 |
| `Service` | Single line text | Affected service |
| `Resource` | Single line text | Affected resource |
| `Environment` | Single line text | Environment name |
| `Metric` | Single line text | Alert metric |
| `Severity` | Single line text | Source severity |
| `ReceivedAt` | Date and time | Alert receipt time |
| `FirstSeenAt` | Date and time | Time monitoring first detected the incident |
| `ResolvedAt` | Date and time | Time monitoring detected recovery; must be later than `FirstSeenAt` |
| `LastAlertAt` | Date and time | Time of the most recently processed alert email |
| `LastSourceMessageId` | Single line text | Most recently processed Outlook message ID |
| `OccurrenceCount` | Number, 0 decimals | Number of alert emails processed for the incident |
| `FlowRunId` | Single line text | Latest Power Automate run ID |
| `ApprovalOutcome` | Single line text | Approve, Reject, or Timeout |
| `ApprovalAttempt` | Number, 0 decimals | Number of approval attempts |
| `ApprovalId` | Single line text | Latest Power Automate approval ID |
| `ApprovalRequestedAt` | Date and time | Time the latest approval was requested |
| `ApprovalCompletedAt` | Date and time | Time the latest approval completed |
| `ApprovalBy` | Single line text | Latest approval responder |
| `ApprovalComment` | Multiple lines text | Latest approval comment |
| `Subscription` | Single line text | Azure subscription from monitoring |
| `ResourceGroup` | Single line text | Azure resource group from monitoring |
| `AppServicePlan` | Single line text | Azure App Service plan from monitoring |
| `DefaultHost` | Single line text | Default App Service host name |
| `CurrentValue` | Single line text | Metric value reported by monitoring |
| `ThresholdDetail` | Multiple lines text | Monitoring threshold and condition details |
| `AlertSummary` | Multiple lines text | Human-readable alert summary |
| `AdoWorkItemId` | Number | Azure DevOps work-item ID |
| `AdoWorkItemUrl` | Hyperlink or single line text | Work-item URL |
| `AdoState` | Single line text | Current ADO state |
| `AssignedTo` | Single line text | Current assignee |
| `AdoCreatedAt` | Date and time | Work-item creation time |
| `AdoClosedAt` | Date and time | Work-item closure time |
| `LastSyncedAt` | Date and time | Latest Power Automate reconciliation |
| `ErrorDetail` | Multiple lines text | Flow error safe for operator display |

Power Automate should upsert by `IncidentId` or `SourceMessageId`, save the returned ADO ID/URL after creation, and update ADO state through a work-item update trigger plus scheduled reconciliation.

### Incident time and correlation rules

- `FirstSeenAt` is the start of the monitoring incident. `ReceivedAt` is when Outlook/Power Automate received the email; they are not interchangeable.
- `ResolvedAt` is the monitoring recovery time and must be later than `FirstSeenAt`.
- For a FIRING email, create the stable `IncidentId` from normalized `Alert + Resource + FirstSeenAt` and use `SourceMessageId` for email-level deduplication.
- For a RESOLVED email, match an open incident with the same normalized Alert and Resource, no existing `ResolvedAt`, and `FirstSeenAt < ResolvedAt`. If more than one record matches, choose the latest valid `FirstSeenAt`.
- If no FIRING record matches a RESOLVED email, store the RESOLVED record as `CANCELLED`. This is an expected transition-period outcome, not a Flow failure, and must not create an approval or ADO work item.
- If `ResolvedAt <= FirstSeenAt`, do not correlate the records. Store a safe diagnostic in `ErrorDetail` without treating the Flow run as a technical failure.
- Infer Environment from Resource prefixes: `prd-` = Production, `stg-` = Staging, `uat-` = UAT, and `dev-` = Development. Use `Unknown` when no supported prefix is present.

## Static Web App settings

The Operations client reuses the existing Entra application credentials used by the API for SharePoint access:

- `AAD_TENANT_ID`
- `AAD_CLIENT_ID`
- `AAD_CLIENT_SECRET`

Set these Operations-specific values only when different from the existing SharePoint site settings:

- `OPERATIONS_SHAREPOINT_HOSTNAME` — falls back to `SHAREPOINT_HOSTNAME`
- `OPERATIONS_SHAREPOINT_SITE_PATH` — falls back to `SHAREPOINT_SITE_PATH`
- `OPERATIONS_SHAREPOINT_LIST_NAME` — defaults to `Operations Hub Incidents`

The Entra application used by the existing API must be permitted to read the target SharePoint site/list. No Graph or ADO App Registration dedicated to Operations Hub is used in V1.

## Safe rollout

1. Create the SharePoint List and columns.
2. Deploy the read-only UI/API; an empty list produces an empty dashboard.
3. Clone the existing production Power Automate Flow before editing it.
4. Add SharePoint upsert steps and explicit failure scopes.
5. Fix approval outcome handling and the FIRING/RESOLVED branches.
6. Add ADO state synchronization and reconciliation.
7. Validate counts and work-item links before replacing the existing production Flow.

Do not configure a Power Automate Flow to write to an Azure Static Web Apps preview hostname. Use the SharePoint connector for persistence and the canonical production hostname for user navigation.

## Local verification

```powershell
cd operations-ui
npm ci
npm run build

cd ..\api
npm test
```
