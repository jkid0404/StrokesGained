[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$AllowedUserEmail,

  [ValidatePattern('^[a-z0-9]{3,20}$')]
  [string]$Prefix = 'strokesgained',

  [string]$ResourceGroupName = 'StrokesGained',

  [string]$Location = 'westus2'
)

$ErrorActionPreference = 'Stop'
$SubscriptionId = 'df94a33e-9b22-41f5-aa9b-1294be285b37'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI is required. Install it and run az login before this script.'
}

Write-Host "Selecting Azure subscription $SubscriptionId..."
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw 'Unable to select the Azure subscription.' }

Write-Host "Ensuring resource group $ResourceGroupName exists in $Location..."
az group create `
  --name $ResourceGroupName `
  --location $Location `
  --subscription $SubscriptionId `
  --output none
if ($LASTEXITCODE -ne 0) { throw 'Unable to create or update the resource group.' }

Write-Host 'Deploying Azure resources...'
$outputsJson = az deployment group create `
  --name "strokes-gained-$(Get-Date -Format 'yyyyMMddHHmmss')" `
  --resource-group $ResourceGroupName `
  --subscription $SubscriptionId `
  --template-file (Join-Path $PSScriptRoot 'main.bicep') `
  --parameters prefix=$Prefix location=$Location allowedUserEmail=$AllowedUserEmail `
  --query properties.outputs `
  --output json
if ($LASTEXITCODE -ne 0) { throw 'Bicep deployment failed.' }

$outputs = $outputsJson | ConvertFrom-Json
$staticWebAppName = $outputs.staticWebAppName.value
$hostname = $outputs.staticWebAppDefaultHostname.value

Write-Host ''
Write-Host 'Infrastructure and application settings are ready.'
Write-Host "Static Web App: https://$hostname"
Write-Host "Next: retrieve the deployment token with:"
Write-Host "  az staticwebapp secrets list --name $staticWebAppName --resource-group $ResourceGroupName --query properties.apiKey -o tsv"
Write-Host 'Store that value as the GitHub repository secret AZURE_STATIC_WEB_APPS_API_TOKEN.'
Write-Host 'Then push the repository to trigger the GitHub Actions workflow.'
