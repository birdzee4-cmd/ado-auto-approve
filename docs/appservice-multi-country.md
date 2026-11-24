# Multi-country App Service configuration

The App Service APIs accept `country` and `environment` and resolve Azure targets from `APP_SERVICE_TARGETS_JSON`.

Keep this value in Function App configuration or Key Vault-backed app settings; do not commit real credentials.

```json
{
  "TH": {
    "displayName": "Thailand",
    "environments": {
      "STG": { "subscriptionId": "...", "tenantId": "...", "clientId": "...", "clientSecretEnv": "AZURE_TH_STG_CLIENT_SECRET", "resourceGroup": "ALL", "namePrefix": "stg-" },
      "PRD": { "subscriptionId": "...", "tenantId": "...", "clientId": "...", "clientSecretEnv": "AZURE_TH_PRD_CLIENT_SECRET", "resourceGroup": "ALL", "namePrefix": "prd-" }
    }
  },
  "MY": {
    "displayName": "Malaysia",
    "environments": {
      "STG": { "subscriptionId": "...", "tenantId": "...", "clientId": "...", "clientSecretEnv": "APP_SERVICE_CLIENT_SECRET", "resourceGroup": "ALL", "namePrefix": "stg-" },
      "PRD": { "subscriptionId": "...", "tenantId": "...", "clientId": "...", "clientSecretEnv": "APP_SERVICE_CLIENT_SECRET", "resourceGroup": "ALL", "namePrefix": "prd-" }
    }
  }
}
```

Repeat the same shape for `ID`, `PH`, and `VN`. A shared country subscription may be reused by both environment entries, while environment-specific prefixes keep STG and PRD separated. `clientSecretEnv` must point to an App Setting/Key Vault reference; `clientSecret` must never be placed in this JSON.
