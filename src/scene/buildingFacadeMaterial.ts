import * as THREE from 'three'

/**
 * Windows/mullions/spandrels are painted procedurally in the fragment
 * shader from two custom per-vertex attributes carried by the merged
 * building geometry (see generation/buildingGeometry.ts):
 *   - facadeUv: (u, v) in real meters along/up each wall face, so window
 *     grid spacing is physically consistent regardless of a wall's actual
 *     length, rather than stretched 0..1 per face.
 *   - facadeParams: (seed, style) — seed is a per-building [0,1) hash
 *     varying tint/bay-width/lit-window-ness without needing true
 *     randomness (keeps regeneration deterministic); style picks which
 *     of three facade looks a vertex belongs to: 0 = glass curtain wall,
 *     1 = punched-window masonry, 2 = flat roof.
 *
 * Implemented as MeshPhysicalMaterial.onBeforeCompile rather than a raw
 * ShaderMaterial so lighting/shadows/fog keep coming from three's own PBR
 * chunks — only diffuse/roughness/metalness/emissive are overridden with
 * values computed from the facade pattern.
 */
export function createBuildingFacadeMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.DoubleSide,
  })

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 facadeUv;
attribute vec2 facadeParams;
varying vec2 vFacadeUv;
varying vec2 vFacadeParams;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFacadeUv = facadeUv;
vFacadeParams = facadeParams;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vFacadeUv;
varying vec2 vFacadeParams;
float gFacadeRoughness = 0.5;
float gFacadeMetalness = 0.0;
float gFacadeGlow = 0.0;
vec3 gFacadeGlowColor = vec3( 0.0 );

vec3 facadeFrameColor( float seed ) {
  vec3 spandrelColor = mix( vec3( 0.16, 0.18, 0.20 ), vec3( 0.26, 0.24, 0.22 ), fract( seed * 5.0 ) );
  vec3 mullionColor = vec3( 0.07, 0.08, 0.09 );
  return mix( spandrelColor, mullionColor, 0.5 );
}

vec3 masonryWallBaseColor( float seed ) {
  float wallHash = fract( seed * 3.7 );
  vec3 wall = mix( vec3( 0.72, 0.66, 0.56 ), vec3( 0.62, 0.60, 0.58 ), step( 0.33, wallHash ) );
  wall = mix( wall, vec3( 0.55, 0.34, 0.30 ), step( 0.66, wallHash ) );
  return wall;
}

vec3 facadeGlass( vec2 uv, float seed ) {
  float floorHeight = 3.3;
  float bayWidth = mix( 2.4, 3.4, fract( seed * 13.17 ) );

  float floorPos = uv.y / floorHeight;
  float floorIdx = floor( floorPos );
  float floorFrac = fract( floorPos );
  float bayPos = uv.x / bayWidth;
  float bayIdx = floor( bayPos );
  float bayFrac = fract( bayPos );

  float mullion = step( bayFrac, 0.05 ) + step( 0.95, bayFrac );
  float spandrel = step( floorFrac, 0.16 );
  float panel = min( 1.0, mullion + spandrel );

  float winHash = rand( vec2( bayIdx, floorIdx ) + seed * 71.0 );
  vec3 glass = mix( vec3( 0.42, 0.56, 0.60 ), vec3( 0.26, 0.38, 0.44 ), step( 0.33, winHash ) );
  glass = mix( glass, vec3( 0.54, 0.64, 0.64 ), step( 0.66, winHash ) );

  vec3 spandrelColor = mix( vec3( 0.16, 0.18, 0.20 ), vec3( 0.26, 0.24, 0.22 ), fract( seed * 5.0 ) );
  vec3 mullionColor = vec3( 0.07, 0.08, 0.09 );

  gFacadeRoughness = mix( 0.12, 0.4, panel );
  gFacadeMetalness = mix( 0.6, 0.05, panel );

  float glint = step( 0.88, rand( vec2( bayIdx, floorIdx ) + seed * 13.0 ) );
  gFacadeGlow = glint * ( 1.0 - panel ) * 0.4;
  gFacadeGlowColor = vec3( 0.8, 0.85, 0.9 );

  return mix( glass, mix( spandrelColor, mullionColor, mullion ), panel );
}

vec3 facadeMasonry( vec2 uv, float seed ) {
  float floorHeight = 3.2;
  float bayWidth = mix( 2.6, 3.8, fract( seed * 9.31 ) );

  float floorPos = uv.y / floorHeight;
  float floorIdx = floor( floorPos );
  float floorFrac = fract( floorPos );
  float bayPos = uv.x / bayWidth;
  float bayIdx = floor( bayPos );
  float bayFrac = fract( bayPos );

  vec3 wall = masonryWallBaseColor( seed );

  float isWindow = step( 0.22, bayFrac ) * step( bayFrac, 0.78 ) * step( 0.28, floorFrac ) * step( floorFrac, 0.82 );
  vec3 windowColor = mix( vec3( 0.12, 0.16, 0.20 ), vec3( 0.3, 0.38, 0.42 ), rand( vec2( bayIdx, floorIdx ) + seed * 23.0 ) );

  gFacadeRoughness = mix( 0.85, 0.2, isWindow );
  gFacadeMetalness = mix( 0.0, 0.3, isWindow );

  return mix( wall, windowColor, isWindow );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float facadeStyle = vFacadeParams.y;
  float facadeSeed = vFacadeParams.x;
  if ( facadeStyle < 0.5 ) {
    diffuseColor.rgb = facadeGlass( vFacadeUv, facadeSeed );
  } else if ( facadeStyle < 1.5 ) {
    diffuseColor.rgb = facadeMasonry( vFacadeUv, facadeSeed );
  } else if ( facadeStyle < 2.5 ) {
    // glass building's roof — same dark frame tone as its own mullions/spandrels, no window pattern
    diffuseColor.rgb = facadeFrameColor( facadeSeed );
    gFacadeRoughness = 0.9;
    gFacadeMetalness = 0.0;
  } else {
    // masonry building's roof — same base wall tone as its own walls, no window pattern
    diffuseColor.rgb = masonryWallBaseColor( facadeSeed );
    gFacadeRoughness = 0.9;
    gFacadeMetalness = 0.0;
  }
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = gFacadeRoughness;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = gFacadeMetalness;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float isGlass = 1.0 - step( 0.5, vFacadeParams.y );
  float fresnel = pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );
  totalEmissiveRadiance += gFacadeGlowColor * gFacadeGlow;
  totalEmissiveRadiance += gFacadeGlowColor * fresnel * 0.15 * isGlass;
}`,
      )
  }

  return material
}
