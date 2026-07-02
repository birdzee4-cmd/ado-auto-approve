# App Service Portal Runbook

เอกสารนี้ใช้สำหรับตรวจและเปิดใช้งาน App Service Portal หลัง deploy ไปยัง Static Web App `ado-auto-approve`

## Current Production State

- Static Web App URL: `https://mango-wave-09cff3700.7.azurestaticapps.net`
- Static Web App name: `ado-auto-approve`
- Static Web App resource group: `rg-ado-auto-approve`
- SKU: `Standard`
- Azure Front Door add-on: not enabled
- System-assigned Managed Identity: enabled
- Managed Identity principal ID: `69558ef6-ab36-4b6b-a110-9e7a68669465`
- SWA managed identity is not used for Azure App Service ARM calls
- App Service Portal backend Function App: `func-ado-auto-approve-appservice-api`
- Function App resource group: `rg-ado-auto-approve`
- Function App system-assigned Managed Identity principal ID: `f28e5c6e-e79b-44c9-b88c-ed39a5b6e181`
- Function App RBAC status: `Website Contributor` assigned at subscription scope for `Buzzebees Staging`
- Current list scope: `APP_SERVICE_RESOURCE_GROUP=ALL`
- Current list implementation: Azure Resource Graph subscription-wide query for `stg-*`

## Current Managed API Limitation

The Static Web Apps managed API runtime currently exposes Managed Identity endpoint variables, but not the secret/header required to request an ARM token:

```text
identityEndpoint=yes
identityHeader=no
msiEndpoint=yes
msiSecret=no
```

Direct token probing returns:

```text
ManagedIdentityTokenError status=403
```

This means the App Service Portal backend cannot reliably call Azure Resource Manager directly from the integrated SWA API host. The implementation keeps ADO Auto-Approve APIs on the existing SWA managed API runtime, changes only the three App Service Portal endpoints into SWA proxy endpoints, and forwards them to a dedicated Azure Function App on the Consumption plan. Grant RBAC to the Function App managed identity, not the SWA managed API identity.

See `docs/function-app-api-migration-plan.md`.

Required proxy settings on the SWA API:

```text
APP_SERVICE_FUNCTION_BASE_URL=<portal function app base URL>
APP_SERVICE_PROXY_SECRET=<same value configured on the portal function app>
```

GitHub Actions settings for the portal-only Function App workflow:

```text
Secret: AZURE_APPSERVICE_PORTAL_FUNCTION_PUBLISH_PROFILE
Variable: APP_SERVICE_FUNCTION_APP_NAME
```

## App Service Scope

The portal must manage only Buzzebees Staging App Services matching this scope:

```text
Subscription: f9bca0f4-1e5b-487f-a2ef-a6578a936ef1
Resource group mode: ALL / subscription-wide
App name prefix: stg-
```

Apps not starting with `stg-` must not be listed, read, or restarted. In `ALL` mode, the backend uses Azure Resource Graph to list matching apps across the subscription, then uses each app's real resource group for read-only settings and restart actions.

Latest production verification:

```text
Backend endpoint: /api/appservices?refresh=true on the portal Function App
Status: 200
Response time: about 3 seconds
Total stg-* apps: 1241
Running apps: 1016
Scope returned by API: All resource groups
Configured resource group: ALL
```

## RBAC Setup

Grant Azure RBAC to the Function App managed identity, not to the Static Web App managed API identity. The SWA API only proxies App Service Portal requests to the dedicated Function App.

Current production assignments:

```text
Principal ID: f28e5c6e-e79b-44c9-b88c-ed39a5b6e181
Principal type: ServicePrincipal
Role: Website Contributor
Scope: /subscriptions/f9bca0f4-1e5b-487f-a2ef-a6578a936ef1

Role: Website Contributor
Scope: /subscriptions/f9bca0f4-1e5b-487f-a2ef-a6578a936ef1/resourceGroups/Default-STG-TH-ServicesBackEnd-All-Group
```

Equivalent subscription-wide command:

```powershell
az role assignment create `
  --assignee-object-id f28e5c6e-e79b-44c9-b88c-ed39a5b6e181 `
  --assignee-principal-type ServicePrincipal `
  --role "Website Contributor" `
  --scope "/subscriptions/f9bca0f4-1e5b-487f-a2ef-a6578a936ef1"
```

Preferred least-privilege custom role actions:

```text
Microsoft.Web/sites/read
Microsoft.Web/sites/config/read
Microsoft.Web/sites/restart/action
```

If a custom role is used with `APP_SERVICE_RESOURCE_GROUP=ALL`, assign it at subscription scope or every resource group that contains matching `stg-*` apps. If the scope is narrowed back to one resource group, assign it only at that resource group.

## Function App Settings

Required Function App settings for current production:

```text
APP_SERVICE_SUBSCRIPTION_ID=f9bca0f4-1e5b-487f-a2ef-a6578a936ef1
APP_SERVICE_RESOURCE_GROUP=ALL
APP_SERVICE_NAME_PREFIX=stg-
APP_SERVICE_PORTAL_ROLE=tester_appservice_manager
APP_SERVICE_PROXY_SECRET=<same value as SWA API>
```

Optional settings:

```text
APP_SERVICE_CACHE_TTL_SECONDS=60
APP_SERVICE_ARM_REQUEST_TIMEOUT_SECONDS=30
APP_SERVICE_ENABLE_SLOW_LIST_FALLBACK=false
APP_SERVICE_RESTART_COOLDOWN_SECONDS=300
APP_SERVICE_SHAREPOINT_LIST_NAME=App Service Portal Log
```

Required SWA API proxy settings:

```text
APP_SERVICE_FUNCTION_BASE_URL=https://func-ado-auto-approve-appservice-api-ezg5d6h3h4cpgff5.southeastasia-01.azurewebsites.net
APP_SERVICE_PROXY_SECRET=<same value as Function App>
APP_SERVICE_RESOURCE_GROUP=ALL
APP_SERVICE_NAME_PREFIX=stg-
```

Do not write secret values into documentation, commits, screenshots, or logs.

## SharePoint Audit Setup

Create a SharePoint List named:

```text
App Service Portal Log
```

Recommended columns:

```text
Title
Action
User
User_Roles
App_Service_Name
Resource_Group
Result
Reason
Log_Source
Event_Key
Viewed_Setting_Keys
```

The App Service audit client can auto-create optional text columns when `APP_SERVICE_SHAREPOINT_AUTO_CREATE_COLUMNS` is not set to `false`, but the list itself must exist.

Never store app setting values in the audit list. Store only setting key names.

## Smoke Tests Before RBAC

These checks can run before RBAC is assigned:

```powershell
curl.exe -I https://mango-wave-09cff3700.7.azurestaticapps.net/
curl.exe -i https://mango-wave-09cff3700.7.azurestaticapps.net/applications.html
curl.exe -i https://mango-wave-09cff3700.7.azurestaticapps.net/api/appservices
```

Expected:

- `/` returns `200 OK`
- `/applications.html` redirects unauthenticated users to Microsoft Entra login
- `/api/appservices` redirects unauthenticated users to Microsoft Entra login

## Smoke Tests After RBAC

Test with a user that has `tester_appservice_manager` or `admin`.

1. Open `/applications.html`
2. Confirm the App Service Portal tile is visible
3. Open `/portal.html`
4. Confirm `Total Apps` is around `1241` and `Scope` shows `All resource groups` when `APP_SERVICE_RESOURCE_GROUP=ALL`
5. Open settings for one allowed app
6. Confirm settings are read-only and values are visible only in the browser
7. Confirm `App Service Portal Log` contains setting key names only
8. Restart one low-risk staging app
9. Confirm the UI enters cooldown
10. Confirm restart audit goes to `App Service Portal Log`

Negative checks:

- `it_support_approve` without `tester_appservice_manager` must not access `/portal.html`
- Unknown app names must not return settings
- Non-`stg-` app names must be rejected
- ADO approve/reject/release logs must still go to the existing ADO Auto-Approve log

## Troubleshooting

### `App Service API is not ready`

Check these items in order:

1. Function App state is `Running`
2. Function App setting `APP_SERVICE_RESOURCE_GROUP` is `ALL` for subscription-wide mode
3. SWA API setting `APP_SERVICE_FUNCTION_BASE_URL` points to the Function App base URL
4. SWA API and Function App share the same `APP_SERVICE_PROXY_SECRET`
5. Function App managed identity has `Website Contributor` or equivalent custom role at the required scope
6. Function App workflow `Azure Functions App Service Portal API CI/CD` completed successfully

### Request timeout when loading all apps

The list endpoint should use Azure Resource Graph and respond in a few seconds for the current subscription. If it takes around 45-180 seconds, verify the deployed `api/shared/appservice-client.js` includes Resource Graph paging with `$top` and `$skipToken`. The slow `webApps.list()` path should not be used for normal `ALL` mode.

## Cost Guardrails

- Keep Static Web App SKU as `Standard`
- Do not enable Azure Front Door add-on unless explicitly approved
- Add a monthly Azure Budget alert for `rg-ado-auto-approve`
- Suggested thresholds: USD 10, USD 15, USD 20
