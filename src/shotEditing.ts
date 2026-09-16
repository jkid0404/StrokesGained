import type { Hole, Shot } from './domain'

export function updateShotInHole(
  hole: Hole,
  shotIndex: number,
  updatedShot: Shot,
): Hole {
  if (shotIndex < 0 || shotIndex >= hole.shots.length) return hole

  return {
    ...hole,
    shots: hole.shots.map((shot, index) => {
      if (index === shotIndex) return updatedShot
      if (index === shotIndex + 1) return { ...shot, start: updatedShot.finish }
      return shot
    }),
  }
}
