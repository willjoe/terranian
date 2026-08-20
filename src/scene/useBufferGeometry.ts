import { useMemo } from 'react'
import * as THREE from 'three'
import type { GeometryData } from '@/generation/geometryTypes'

/** Wraps a renderer-agnostic GeometryData bundle into a THREE.BufferGeometry. `extraAttributes` lets a caller (e.g. Buildings.tsx) attach extra per-vertex data beyond the standard position/normal/uv/index set. */
export function useBufferGeometry(
  data: GeometryData,
  extraAttributes?: Record<string, { array: Float32Array; itemSize: number }>,
): THREE.BufferGeometry {
  return useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
    if (extraAttributes) {
      for (const [name, { array, itemSize }] of Object.entries(extraAttributes)) {
        geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
      }
    }
    return geometry
  }, [data, extraAttributes])
}
