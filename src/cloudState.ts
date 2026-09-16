import type { CourseTemplate, Round } from './domain'

export interface LocalState {
  rounds: Round[]
  courses: CourseTemplate[]
  deletedCourseKeys: string[]
  clubs: string[]
}

export interface CloudState extends LocalState {
  revision: number
  updatedAt: string | null
  exists: boolean
}

export type BootstrapDecision =
  | { action: 'upload-local'; state: LocalState; revision: 0 }
  | { action: 'use-cloud'; state: LocalState; revision: number }

export function decideBootstrap(
  localState: LocalState,
  cloudState: CloudState,
): BootstrapDecision {
  if (!cloudState.exists && hasLocalData(localState)) {
    return { action: 'upload-local', state: localState, revision: 0 }
  }

  return {
    action: 'use-cloud',
    state: {
      rounds: cloudState.rounds,
      courses: cloudState.courses,
      deletedCourseKeys: cloudState.deletedCourseKeys,
      clubs: cloudState.clubs,
    },
    revision: cloudState.revision,
  }
}

export function hasLocalData(state: LocalState): boolean {
  return (
    state.rounds.length > 0 ||
    state.courses.length > 0 ||
    state.deletedCourseKeys.length > 0 ||
    state.clubs.length > 0
  )
}

export function stateFingerprint(state: LocalState): string {
  return JSON.stringify([
    state.rounds,
    state.courses,
    state.deletedCourseKeys,
    state.clubs,
  ])
}
