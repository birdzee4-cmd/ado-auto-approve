param(
  [Parameter(Mandatory = $true)]
  [string]$PrincipalId,

  [string]$SubscriptionId = "f9bca0f4-1e5b-487f-a2ef-a6578a936ef1",

  [string]$ResourceGroupName = "Default-STG-TH-ServicesBackEnd-All-Group",

  [string]$RoleName = "Website Contributor"
)

$ErrorActionPreference = "Stop"

Write-Host "Checking Azure CLI login..."
$account = az account show --query "{name:name, id:id, user:user.name}" -o json | ConvertFrom-Json
Write-Host "Current Azure account: $($account.name) [$($account.id)] user=$($account.user)"

if ($account.id -ne $SubscriptionId) {
  Write-Host "Switching subscription to $SubscriptionId..."
  az account set --subscription $SubscriptionId
}

$scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName"

Write-Host "Validating target resource group..."
az group show --subscription $SubscriptionId --name $ResourceGroupName --query "{name:name, location:location, id:id}" -o table

Write-Host "Target principal ID: $PrincipalId"
Write-Host "Target scope: $scope"
Write-Host "Role: $RoleName"

$existing = az role assignment list `
  --assignee-object-id $PrincipalId `
  --scope $scope `
  --query "[?roleDefinitionName=='$RoleName'].{role:roleDefinitionName, scope:scope, principalId:principalId}" `
  -o json | ConvertFrom-Json

if ($existing -and $existing.Count -gt 0) {
  Write-Host "Role assignment already exists. No change needed."
  $existing | Format-Table -AutoSize
  exit 0
}

Write-Host "Creating role assignment..."
az role assignment create `
  --assignee-object-id $PrincipalId `
  --assignee-principal-type ServicePrincipal `
  --role $RoleName `
  --scope $scope `
  -o json | ConvertFrom-Json | Format-List

Write-Host "Verifying role assignment..."
az role assignment list `
  --assignee-object-id $PrincipalId `
  --scope $scope `
  --query "[].{role:roleDefinitionName, scope:scope, principalId:principalId}" `
  -o table

Write-Host "Done."
