/**
 * Renderer-agnostic geometry bundle. Only src/scene/ wraps these typed
 * arrays into actual THREE.BufferGeometry objects, keeping the three.js
 * dependency confined to that one layer.
 */
export interface GeometryData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

export const EMPTY_GEOMETRY: GeometryData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  uvs: new Float32Array(0),
  indices: new Uint32Array(0),
}
