import { CosmosClient, type Container } from '@azure/cosmos'
import type {
  CourseCatalogPayload,
  StoredCourseCatalog,
} from './courseCatalogModel.js'

let container: Container | null = null

export type CourseCatalogWriteResult =
  | { conflict: false; catalog: StoredCourseCatalog }
  | { conflict: true; catalog: StoredCourseCatalog | null }

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

export async function writeCourseCatalog(
  payload: CourseCatalogPayload,
): Promise<CourseCatalogWriteResult> {
  const current = await readCourseCatalog()
  const currentRevision = current?.revision ?? 0
  if (payload.revision !== currentRevision) {
    return { conflict: true, catalog: current }
  }

  const next: StoredCourseCatalog = {
    id: 'catalog',
    courses: payload.courses,
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  }

  try {
    if (!current) {
      const response = await getContainer().items.create<StoredCourseCatalog>(next)
      return { conflict: false, catalog: response.resource ?? next }
    }

    const response = await getContainer()
      .item('catalog', 'catalog')
      .replace<StoredCourseCatalog>(next, {
        accessCondition: current._etag
          ? { type: 'IfMatch', condition: current._etag }
          : undefined,
      })
    return { conflict: false, catalog: response.resource ?? next }
  } catch (error) {
    if (getStatusCode(error) === 409 || getStatusCode(error) === 412) {
      return { conflict: true, catalog: await readCourseCatalog() }
    }
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
