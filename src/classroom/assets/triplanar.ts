// World-space triplanar PBR material (ported from modulo-places sceneMaterials.ts).
//
// The greybox has no UVs, so PBR materials are projected along the three world axes and blended by
// the surface normal. Instancing-aware (InstancedMesh tables, chair parts, ceiling slats).
// Maps: colour (sRGB), OpenGL normal, ORM/"arm" (R = AO, G = roughness, B = metalness).
import * as THREE from 'three';

export interface PbrMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  armMap: THREE.Texture;
}

export interface TriplanarOptions {
  /** Metres per texture repeat. */
  scale: number;
  /** Multiplies the albedo (sRGB hex), e.g. to warm or darken a texture. */
  tint?: string;
  /** Albedo multiplier (> 1 brightens; a tint alone can only darken). */
  brightness?: number;
  /** Multiplies roughness from the ORM map. */
  roughness?: number;
  /** Multiplies metalness from the ORM map (0 = force dielectric, 1 = use the map). */
  metalness?: number;
  /** Adds to metalness (for chrome when the source has no metal map). */
  metalBias?: number;
  /** Normal map strength. */
  normalScale?: number;
  side?: THREE.Side;
  /** Blend sharpness between projection axes (higher = crisper seams). */
  sharpness?: number;
}

const PARS = /* glsl */ `
uniform sampler2D tTriC; uniform sampler2D tTriN; uniform sampler2D tTriA;
uniform float uTriScale; uniform float uTriSharp; uniform vec3 uTriTint; uniform float uTriRough;
uniform float uTriMetal; uniform float uTriMetalBias; uniform float uTriNormal;
varying vec3 vTriWorld; varying vec3 vTriNormal;
vec3 triW(vec3 n) { vec3 b = pow(abs(n), vec3(uTriSharp)); return b / (b.x + b.y + b.z); }
vec4 triSample(sampler2D t, vec3 p, vec3 w) {
  return texture(t, p.zy * uTriScale) * w.x + texture(t, p.xz * uTriScale) * w.y + texture(t, p.xy * uTriScale) * w.z;
}
vec3 triNormal(vec3 p, vec3 n, vec3 w) {
  vec3 tx = texture(tTriN, p.zy * uTriScale).xyz * 2.0 - 1.0;
  vec3 ty = texture(tTriN, p.xz * uTriScale).xyz * 2.0 - 1.0;
  vec3 tz = texture(tTriN, p.xy * uTriScale).xyz * 2.0 - 1.0;
  tx.xy *= uTriNormal; ty.xy *= uTriNormal; tz.xy *= uTriNormal;
  // Whiteout blend; sign-correct for faces pointing along negative axes.
  vec3 s = sign(n);
  tx = vec3(tx.xy * vec2(s.x, 1.0) + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy * vec2(1.0, s.y) + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy * vec2(-s.z, 1.0) + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
`;

export function createTriplanarMaterial(
  key: string,
  maps: PbrMaps,
  o: TriplanarOptions,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: `tri:${key}`,
    roughness: 1,
    metalness: 1,
    side: o.side ?? THREE.FrontSide,
  });
  for (const t of [maps.map, maps.normalMap, maps.armMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    tTriC: { value: maps.map },
    tTriN: { value: maps.normalMap },
    tTriA: { value: maps.armMap },
    uTriScale: { value: 1 / o.scale },
    uTriSharp: { value: o.sharpness ?? 6 },
    uTriTint: { value: new THREE.Color(o.tint ?? '#ffffff').multiplyScalar(o.brightness ?? 1) },
    uTriRough: { value: o.roughness ?? 1 },
    uTriMetal: { value: o.metalness ?? 1 },
    uTriMetalBias: { value: o.metalBias ?? 0 },
    uTriNormal: { value: o.normalScale ?? 1 },
  };
  mat.userData.triUniforms = uniforms;
  mat.customProgramCacheKey = () => 'classroom-triplanar-v1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTriWorld;\nvarying vec3 vTriNormal;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 tw = vec4(transformed, 1.0);
          mat3 tn = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            tw = instanceMatrix * tw;
            tn = tn * mat3(instanceMatrix);
          #endif
          vTriWorld = (modelMatrix * tw).xyz;
          vTriNormal = normalize(tn * objectNormal);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace(
        '#include <map_fragment>',
        `vec3 triN = normalize(vTriNormal);
        vec3 triWt = triW(triN);
        vec3 triArm = triSample(tTriA, vTriWorld, triWt).rgb;
        diffuseColor.rgb *= triSample(tTriC, vTriWorld, triWt).rgb * uTriTint;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = clamp(triArm.g * uTriRough, 0.04, 1.0);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        'float metalnessFactor = clamp(triArm.b * uTriMetal + uTriMetalBias, 0.0, 1.0);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{ vec3 nW = triNormal(vTriWorld, triN, triWt);
           normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz) * faceDirection; }`,
      )
      .replace(
        '#include <aomap_fragment>',
        `{ float ambientOcclusion = mix(1.0, triArm.r, 0.8);
           reflectedLight.indirectDiffuse *= ambientOcclusion;
           #if defined( USE_ENVMAP ) && defined( STANDARD )
             float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
             reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
           #endif
         }`,
      );
  };
  return mat;
}
