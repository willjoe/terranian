import { Canvas } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import type { WorldModel } from '@/world/schema'
import { TerrainMesh } from '@/scene/TerrainMesh'
import { TerrainSkirt } from '@/scene/TerrainSkirt'
import { Buildings } from '@/scene/Buildings'
import { Roads } from '@/scene/Roads'
import { LandUse } from '@/scene/LandUse'
import { Water } from '@/scene/Water'
import { Trees } from '@/scene/Trees'

export function WorldScene({ world }: { world: WorldModel }) {
  const radius = Math.max(world.boundsMeters.width, world.boundsMeters.depth)

  return (
    <Canvas
      shadows
      // The far/near ratio here is huge (terrain-scale far plane, sub-meter
      // near plane), which starves a default linear depth buffer of enough
      // precision to reliably separate roads/land-use/water from the
      // terrain a few centimeters below them — causing z-fighting flicker.
      gl={{ logarithmicDepthBuffer: true }}
      camera={{ position: [radius * 0.6, radius * 0.5, radius * 0.6], near: 0.1, far: radius * 10 }}
    >
      <Sky sunPosition={[100, 80, 50]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, 150, 80]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]} />
      <fog attach="fog" args={['#cfe8ff', radius * 1.5, radius * 4]} />
      <OrbitControls target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.05} />

      <TerrainMesh terrain={world.terrain} />
      <TerrainSkirt terrain={world.terrain} />
      <LandUse landUse={world.landUse} terrain={world.terrain} />
      <Water landUse={world.landUse} terrain={world.terrain} />
      <Roads roads={world.roads} terrain={world.terrain} />
      <Buildings buildings={world.buildings} terrain={world.terrain} />
      <Trees trees={world.trees} terrain={world.terrain} />
    </Canvas>
  )
}
