import { MAX_TREES, TREE_SCATTER_STEP_M } from '@/config/constants'
import type { LocalPoint } from '@/geo/coords'
import type { LandUseArea, TreePoint } from '@/world/schema'

function pointInPolygon(point: LocalPoint, polygon: LocalPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i]
    const { x: xj, y: yj } = polygon[j]
    const crosses = yi > point.y !== yj > point.y
    if (crosses && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function polygonBounds(polygon: LocalPoint[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

/** Jittered-grid scatter of tree points inside forest/wood polygons, capped at MAX_TREES. */
export function scatterTrees(forestAreas: LandUseArea[]): TreePoint[] {
  const trees: TreePoint[] = []

  outer: for (const area of forestAreas) {
    const { minX, minY, maxX, maxY } = polygonBounds(area.polygon)
    for (let y = minY; y <= maxY; y += TREE_SCATTER_STEP_M) {
      for (let x = minX; x <= maxX; x += TREE_SCATTER_STEP_M) {
        if (trees.length >= MAX_TREES) break outer

        const candidate: LocalPoint = {
          x: x + (Math.random() - 0.5) * TREE_SCATTER_STEP_M,
          y: y + (Math.random() - 0.5) * TREE_SCATTER_STEP_M,
        }
        if (pointInPolygon(candidate, area.polygon)) {
          trees.push({
            position: candidate,
            radius: 1.5 + Math.random() * 1.5,
            heightMeters: 6 + Math.random() * 8,
          })
        }
      }
    }
  }

  return trees
}
