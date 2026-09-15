targetScope = 'resourceGroup'

@description('Short lowercase prefix used to generate globally unique resource names.')
@minLength(3)
@maxLength(20)
param prefix string

@description('Azure region for all supported resources.')
param location string = 'westus2'

@description('Cosmos DB SQL database name.')
param databaseName string = 'strokesgained'

@description('Cosmos DB container name.')
param containerName string = 'ownerState'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id, prefix)
var cosmosAccountName = take(toLower('${prefix}${suffix}'), 44)
var staticWebAppName = take(toLower('${prefix}-${suffix}'), 60)

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    enableAutomaticFailover: false
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource stateContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [
          '/ownerId'
        ]
        kind: 'Hash'
        version: 2
      }
    }
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
  }
}

output cosmosAccountName string = cosmosAccount.name
output cosmosDatabaseName string = database.name
output cosmosContainerName string = stateContainer.name
output staticWebAppName string = staticWebApp.name
output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
