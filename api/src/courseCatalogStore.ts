import { CosmosClient, type Container } from '@azure/cosmos'
import type { StoredCourseCatalog } from './courseCatalogModel.js'

let container: Container | null = null

export async function readCourseCatalog(): Promise<StoredCourseCatalog | null> {
  try {
    const response = await getContainer()
      .item('catalog', 'catalog')
      .read<StoredCourseCatalog>()
    return response.resource ?? null
  } catch (error) {
    if (getStatusCode(error) === 404) return null
    throw error
  }
}

function getContainer(): Container {
  if (container) return container

  const connectionString = process.env.COSMOS_CONNECTION_STRING
  const databaseName = process.env.COSMOS_DATABASE_NAME
  const containerName = process.env.COSMOS_COURSES_CONTAINER_NAME
  if (!connectionString || !databaseName || !containerName) {
    throw new Error('Shared course catalog settings are incomplete.')
  }

  container = new CosmosClient(connectionString)
    .database(databaseName)
    .container(containerName)
  return container
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'number') return error.code
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return undefined
}
