# Approve Release Workflow

เอกสารนี้อธิบาย workflow การ Approve Release บนระบบ ADO Auto-Approve Dashboard

## Main Workflow

```mermaid
flowchart TD
  A["Open Dashboard"] --> B["Fetch active PRs from Azure DevOps"]
  B --> C["Filter PRs for staging / MergeCode and IT Support Approve"]

  C --> D{"PR approval complete?"}

  D -- "No" --> E["Show Approve / Reject actions"]
  E --> F["User clicks Approve PR"]
  F --> G["Approve vote in Azure DevOps"]
  G --> H["Set auto-complete"]
  H --> I["Write SharePoint Log"]
  I --> J["Refresh Dashboard"]

  D -- "Yes" --> K["Check Build / Policy status"]
  K --> L{"Build or Policy failed?"}

  L -- "Yes" --> M["Show failed status"]
  M --> N["Send Teams exception notification"]

  L -- "No" --> O["Check related Release"]
  O --> P{"Release approval pending?"}

  P -- "Yes" --> Q["Show Approve Release button"]
  Q --> R["User clicks Approve Release"]
  R --> S["Re-check latest Release approval in Azure DevOps"]
  S --> T{"Still pending?"}

  T -- "Yes" --> U["Approve Release"]
  U --> V["Write SharePoint Log: Release Approved"]
  V --> W["Refresh Dashboard"]

  T -- "No" --> X["Show message: Release no longer pending"]

  P -- "No" --> Y{"Release status?"}
  Y -- "Expected only" --> Z["Show Release expected"]
  Y -- "Deploying" --> AA["Show Deploying"]
  Y -- "Succeeded" --> AB["Show Deploy succeeded"]
  Y -- "Failed" --> AC["Show Deploy failed"]
  Y -- "Not found" --> AD["Show No release yet"]

  W --> AE["Track deploy result"]
  AE --> Y
```

## Status Lifecycle

```mermaid
flowchart LR
  A["PR Approval"] --> B["Build / Policy"]
  B --> C["Release Approval"]
  C --> D["Deploy Result"]

  A --> A1["Approve / Reject"]
  B --> B1["Pending / Approved / Failed"]
  C --> C1["Expected / Pending / Approved"]
  D --> D1["Waiting / Deploying / Succeeded / Failed"]
```

## Dashboard Rules

| Condition | Dashboard Behavior |
| --- | --- |
| PR approval is still pending | Show Approve / Reject actions |
| PR approval complete, build or policy failed | Show failed status and keep visible for attention |
| Release approval is pending | Show Approve Release button |
| Release is expected from CI/CD mapping only | Show Release expected, no approve button |
| Release deploy is running | Show Deploying |
| Release deploy succeeded | Show Deploy succeeded |
| Release deploy failed | Show Deploy failed |
| No release was found | Show No release yet |

## Important Guardrails

- The system must approve release only when Azure DevOps reports a real pending release approval.
- The system must re-check the latest release approval before submitting approval.
- The system must not approve release from CI/CD mapping alone.
- Every successful release approval must be written to SharePoint Log as `Release Approved`.
- Build / Policy exception notification is separate from release approval action.
