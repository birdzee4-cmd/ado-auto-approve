# Deployment Report Portal

The Deployment Report Portal is hosted by the existing Azure Static Web App at
`/deployment.html`. It uses the existing Microsoft Entra authentication and the
`it_support_approve`/`admin` application roles.

## Storage

The Functions use the first available connection string:

1. `DEPLOYMENT_STORAGE_CONNECTION_STRING`
2. `AzureWebJobsStorage`
3. `AZURE_STORAGE_CONNECTION_STRING`

The following optional settings override the default table names:

| Setting | Default |
| --- | --- |
| `DEPLOYMENT_RECORDS_TABLE` | `DeploymentRecords` |
| `DEPLOYMENT_MASTER_TABLE` | `DeploymentProjects` |
| `DEPLOYMENT_AUDIT_TABLE` | `DeploymentAuditLogs` |
| `DEPLOYMENT_COUNTERS_TABLE` | `DeploymentCounters` |

Tables are created on first use. For production, prefer a dedicated
`DEPLOYMENT_STORAGE_CONNECTION_STRING` so deployment data is isolated from
Azure Functions runtime storage.

## Initial import

1. Sign in with an account assigned the `admin` role.
2. Open **Deployment Report → Master Data**.
3. Select `Report Deploy_2026.xlsx`.
4. Choose **Import workbook**.

The import is idempotent by Job No. Existing rows are skipped. Rows that only
reserve a Job No. but contain no deployment details are reported as invalid and
are not stored; their numbers still advance the counter so they cannot be
reissued.

The import accepts files up to 15 MB and reads:

- `2026` as Web/Service deployments.
- `2026 (APP)` as Mobile deployments.
- `Projects` as independent Deploy Type and Project Name lists.

## Local verification

From the repository root:

```powershell
node --test api\shared\deployment-model.test.js api\shared\deployment-excel.test.js
node --check public\deployment.js
```

The portal is not deployed automatically until the branch is pushed or merged
into a branch covered by the existing Static Web Apps workflow.
