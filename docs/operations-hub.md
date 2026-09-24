# Operations Hub

Operations Hub is the incident tracking and Tier 1 coordination module in the existing repository and Azure Static Web App. Its canonical production entry point is:

`https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html`

The existing Production Power Automate workflow remains responsible for Outlook alerts, Teams messages, approvals, the primary Azure DevOps Work Item, and the existing SharePoint incident record. Operations Hub adds Related Work Items through its API only when the corresponding feature flags are enabled.

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
applications.html -> operations.html -> /api/operations/* -> SharePoint Lists / Azure DevOps
```

## Components

- `operations-ui/` — React, TypeScript, and Vite Operations Hub.
- `public/operations.html` — thin entry point using hash routing.
- `api/operations/` — role-protected HTTP API for dashboard, incident list, and incident details.
- `api/shared/operations-sharepoint-client.js` — Microsoft Graph client for the existing incident list and opt-in supporting lists.
- Power Automate — the existing workflow continues to own alert parsing, approval, and primary ADO creation. Any reconciliation automation is created as a separate workflow.

Operations Hub reuses the existing Azure DevOps delegated OAuth flow and does not introduce a duplicate authentication implementation.

## Authentication and authorization

`/operations.html`, `/operations-assets/*`, and `/api/operations/*` require `it_support_approve` or `admin`. The API repeats the role check using the Static Web Apps client principal. The browser never receives Microsoft Graph credentials.

Read operations:

- `GET /api/operations/dashboard`
- `GET /api/operations/incidents?status=&search=`
- `GET /api/operations/incidents/{incidentId}`
- `GET /api/operations/mappings`
- `GET /api/operations/mappings/resolve`

Feature-flagged Tier 1 write operations:

- `POST /api/operations/incidents/{incidentId}/work-items/related`
- `POST /api/operations/incidents/{incidentId}/work-items/link`
- `POST /api/operations/incidents/{incidentId}/synchronize`
- `POST /api/operations/incidents/{incidentId}/confirm-recovery`
- `POST /api/operations/incidents/{incidentId}/close`
- `POST /api/operations-reconcile` for the separate scheduled automation

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
- `OPERATIONS_WORK_ITEMS_LIST_NAME` — optional during rollout; set to `Operations Hub Work Items` after the supporting list is provisioned. When omitted, the API remains compatible with the existing incident list and exposes its `AdoWorkItemId` as the sole `PRIMARY/TIER1` work item.
- `OPERATIONS_WRITE_ROLES` — comma-separated roles allowed to perform future Operations Hub write actions; defaults to `it_support_approve,admin`. This does not grant Azure DevOps access by itself; a verified delegated connection is also required.

The Operations Hub header uses the existing `/api/ado-auth-*` endpoints. Connection status is considered valid only after the backend calls Azure DevOps `connectionData` with the delegated access token and receives an authenticated identity. The API returns Operations Hub and Azure DevOps identities as separate objects so later audit records cannot conflate them.

## Supporting lists

The compatibility layer does not modify or migrate `Operations Hub Incidents`. Provision these lists separately before enabling later write phases:

### Operations Hub Work Items

| Internal name | Suggested type | Purpose |
|---|---|---|
| `Title` | Single line text | Human-readable work-item label |
| `IncidentId` | Single line text, indexed | Existing Operations Hub incident correlation ID |
| `WorkItemId` | Number, indexed | Azure DevOps work-item ID |
| `Role` | Choice | `PRIMARY` or `RELATED`; supporting records normally use `RELATED` |
| `SupportTeam` | Choice | `TIER1`, `APP_SUPPORT`, or `TIER2` |
| `State` | Single line text | Latest Azure DevOps state |
| `WorkItemUrl` | Hyperlink or single line text | Trusted Azure DevOps HTTPS URL |
| `AssignedTo` | Single line text | Latest assignee display value |
| `CreatedAt` | Date and time | Work-item creation time |
| `ClosedAt` | Date and time | Work-item closure time |
| `LastSyncedAt` | Date and time | Latest reconciliation time |
| `IdempotencyKey` | Single line text, indexed | SHA-256 request key used to prevent duplicate creation |

Create a unique-data or application-level uniqueness rule for `WorkItemId`. The API always preserves the existing incident `AdoWorkItemId` as `PRIMARY/TIER1` if a duplicate supporting record exists.

### Operations Hub Service Mapping

| Internal name | Suggested type |
|---|---|
| `Title` | Single line text |
| `MappingId` | Single line text, indexed |
| `Service` | Single line text, indexed |
| `AlertNamePattern` | Single line text |
| `ResourcePattern` | Single line text |
| `Environment` | Choice |
| `SupportTeam` | Choice |
| `AdoProject` | Single line text |
| `WorkItemType` | Single line text |
| `AreaPath` | Single line text |
| `IterationPath` | Single line text |
| `AssignedTeam` | Single line text |
| `DefaultTags` | Single line text |
| `Enabled` | Yes/No |
| `Priority` | Number |

### Operations Hub Audit

| Internal name | Suggested type |
|---|---|
| `Title` | Single line text |
| `EventId` | Single line text, indexed |
| `EventKey` | Single line text, indexed |
| `CorrelationId` | Single line text, indexed |
| `IncidentId` | Single line text, indexed |
| `WorkItemId` | Number, indexed |
| `Action` | Single line text |
| `Result` | Single line text |
| `OperationsUserId` | Single line text |
| `OperationsUserName` | Single line text |
| `OperationsUserEmail` | Single line text |
| `AdoIdentityId` | Single line text |
| `AdoIdentityName` | Single line text |
| `AdoIdentityEmail` | Single line text |
| `Detail` | Multiple lines text |
| `OccurredAt` | Date and time |

The existing `Operations Hub Incidents` list needs these optional Operations Hub columns before close actions are enabled: `RecoveryConfirmed` (Yes/No), `RecoveryConfirmedBy` (text), `RecoveryConfirmedAt` (date/time), `OperationsStatus` (text/choice), `OperationsClosedBy` (text), and `OperationsClosedAt` (date/time). Existing production workflow columns and behavior remain unchanged.

### Operations feature flags

All write and automation capabilities are disabled unless explicitly enabled:

| Setting | Purpose |
|---|---|
| `OPERATIONS_CREATE_ENABLED` | Create mapped Related Work Items |
| `OPERATIONS_LINK_ENABLED` | Link an existing ADO Work Item as Related |
| `OPERATIONS_SYNC_ENABLED` | Synchronize Work Item states |
| `OPERATIONS_CLOSE_ENABLED` | Confirm recovery and close Operations Hub incidents |
| `OPERATIONS_RECONCILIATION_ENABLED` | Enable the separate reconciliation endpoint |
| `OPERATIONS_NOTIFICATION_ENABLED` | Send deduplicated reconciliation notifications |
| `OPERATIONS_AUTOMATION_KEY` | Secret header value required by `/api/operations-reconcile` |
| `OPERATIONS_HUB_URL` | Canonical URL inserted into notifications |
| `OPERATIONS_MAPPINGS_LIST_NAME` | Supporting mapping list name |
| `OPERATIONS_AUDIT_LIST_NAME` | Supporting audit list name |

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
