import { useMemo } from 'react'
import * as THREE from 'three'
import type { GeometryData } from '@/generation/geometryTypes'

/** Wraps a renderer-agnostic GeometryData bundle into a THREE.BufferGeometry. */
export function useBufferGeometry(data: GeometryData): THREE.BufferGeometry {
  return useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
    return geometry
  }, [data])
}
