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

## App Service Scope

The portal must manage only this staging scope:

```text
Subscription: f9bca0f4-1e5b-487f-a2ef-a6578a936ef1
Resource group: Default-STG-TH-ServicesBackEnd-All-Group
App name prefix: stg-
```

Apps outside this resource group or not starting with `stg-` must not be listed, read, or restarted.

## Pending RBAC Setup

An Azure admin with `Owner` or `User Access Administrator` must grant the Static Web App Managed Identity access to the staging resource group.

Recommended short-term assignment:

```powershell
az role assignment create `
  --assignee-object-id 69558ef6-ab36-4b6b-a110-9e7a68669465 `
  --assignee-principal-type ServicePrincipal `
  --role "Website Contributor" `
  --scope "/subscriptions/f9bca0f4-1e5b-487f-a2ef-a6578a936ef1/resourceGroups/Default-STG-TH-ServicesBackEnd-All-Group"
```

Preferred least-privilege custom role actions:

```text
Microsoft.Web/sites/read
Microsoft.Web/sites/config/read
Microsoft.Web/sites/restart/action
```

If a custom role is used, assign it at the same resource group scope.

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

Wait 1-5 minutes after RBAC assignment for propagation, then test with a user that has `tester_appservice_manager` or `admin`.

1. Open `/applications.html`
2. Confirm the App Service Portal tile is visible
3. Open `/portal.html`
4. Confirm only `stg-*` apps from `Default-STG-TH-ServicesBackEnd-All-Group` are listed
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

## Cost Guardrails

- Keep Static Web App SKU as `Standard`
- Do not enable Azure Front Door add-on unless explicitly approved
- Add a monthly Azure Budget alert for `rg-ado-auto-approve`
- Suggested thresholds: USD 10, USD 15, USD 20

