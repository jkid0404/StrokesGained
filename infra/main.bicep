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

@description('Shared course catalog Cosmos DB container name.')
param coursesContainerName string = 'courses'

@description('Course publication proposal Cosmos DB container name.')
param proposalsContainerName string = 'courseProposals'

@description('Microsoft account email that bootstraps the first application administrator.')
param adminUserEmail string

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

resource coursesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: coursesContainerName
  properties: {
    resource: {
      id: coursesContainerName
      partitionKey: {
        paths: [
          '/id'
        ]
        kind: 'Hash'
        version: 2
      }
    }
  }
}

resource proposalsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: proposalsContainerName
  properties: {
    resource: {
      id: proposalsContainerName
      partitionKey: {
        paths: [
          '/proposerId'
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

resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    COSMOS_CONNECTION_STRING: cosmosAccount.listConnectionStrings().connectionStrings[0].connectionString
    COSMOS_DATABASE_NAME: database.name
    COSMOS_CONTAINER_NAME: stateContainer.name
    COSMOS_COURSES_CONTAINER_NAME: coursesContainer.name
    COSMOS_PROPOSALS_CONTAINER_NAME: proposalsContainer.name
    ADMIN_USER_EMAIL: adminUserEmail
    ALLOWED_USER_EMAIL: adminUserEmail
  }
}

output cosmosAccountName string = cosmosAccount.name
output cosmosDatabaseName string = database.name
output cosmosContainerName string = stateContainer.name
output cosmosCoursesContainerName string = coursesContainer.name
output cosmosProposalsContainerName string = proposalsContainer.name
output staticWebAppName string = staticWebApp.name
output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
