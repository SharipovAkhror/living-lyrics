/**
 * Lazy three.js renderer for instrument GLBs.
 *
 * InstrumentStage uses one WebGL context and scissored viewports. A gallery card uses the same
 * path with a single view, because a card is its own element. Playback time is an argument:
 * the idle clip is not played, and nothing is integrated from the previous frame.
 *
 * Frame: models face +Z, Y up, X to the right. `cameras.hero.position` in the manifest is a
 * direction from the target to the camera, not a placed point. The distance is fitted so the
 * projected instrument is about 80% of the frame height and at most 90% of its width. The aim
 * point slides in the camera's view plane until the box is centered; the hero direction stays.
 * Dragging right decreases rotation.y; the camera does
 * not orbit. CSS rotate is clockwise, so rotation.z uses the opposite sign. Jingle nodes carry
 * a quantization scale, so a world-space shift is divided by that scale.
 *
 * Hatch lines are computed in instrument space (the root spin removed) so they stick to the
 * wood. The studio light stays in world space. Meshopt stores a normalized position plus a
 * node scale, so the pattern uses the world position, not the raw attribute.
 */
import type { InstrumentDrive, InstrumentRenderer } from '@/instruments/animation';

/**
 * Hatch shader versus lit materials. The reader never picks the hatch: settings offer
 * "realistic", and the song stage always asks for materials. The hatch stays callable.
 */
export type VolumeLook = 'engraving' | 'materials';
import { jingleShift, skinWeight, stringWeight, sway } from './pose';

import './stage3d.css';

type THREE = typeof import('three');
type Mesh = import('three').Mesh;
type Object3D = import('three').Object3D;
type Group = import('three').Group;
type Material = import('three').Material;
type WebGLRenderer = import('three').WebGLRenderer;

interface Engine {
  THREE: THREE;
  loader: InstanceType<typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader>;
  templates: Map<string, Group>;
}

let enginePromise: Promise<Engine> | null = null;

function engine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('meshoptimizer/decoder'),
      ]);
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return { THREE, loader, templates: new Map() };
    })();
  }
  return enginePromise;
}

async function templateFor(key: string): Promise<Group> {
  const eng = await engine();
  const cached = eng.templates.get(key);
  if (cached) return cached;
  const gltf = await eng.loader.loadAsync(`/instruments/3d/${key}.glb`);
  const root = (gltf.scene.getObjectByName('instrument') as Group | undefined) ?? gltf.scene;
  eng.templates.set(key, root);
  return root;
}

interface Uniforms {
  uInk: { value: import('three').Color };
  uDraw: { value: number };
  uHatch: { value: number };
  uOpacity: { value: number };
  /** Scissor height in device pixels. The outline is a fixed number of those pixels. */
  uViewportH: { value: number };
  /** Root rotation. Removing it puts hatch coordinates back on the wood. */
  uRoot: { value: import('three').Matrix3 };
}

/** Same vector as the key light's position. Both sides normalize it. */
const KEY = 'vec3(-0.25, 0.48, 0.84)';

type Role = 'spruce' | 'bowl' | 'wood' | 'wood-inner' | 'skin' | 'metal' | 'string' | 'guard' | 'seam' | 'ebony' | 'leather';

function roleOf(meshName: string, matName: string): Role {
  if (meshName === 'bowl') return 'bowl';
  if (meshName === 'bowl-inner') return 'wood-inner';
  if (meshName === 'soundboard' || meshName === 'rosettes' || matName === 'spruce') return 'spruce';
  if (meshName === 'part-skin' || matName === 'skin') return 'skin';
  if (meshName.startsWith('rings-') || meshName === 'hooks' || meshName === 'tacks' || matName === 'metal') return 'metal';
  if (meshName.startsWith('part-string') || meshName === 'string-tails' || matName === 'string') return 'string';
  if (meshName === 'pickguard' || matName === 'guard') return 'guard';
  if (meshName === 'seams' || meshName === 'purfling' || matName === 'seam') return 'seam';
  if (meshName === 'band' || matName === 'leather') return 'leather';
  if (matName === 'ebony' || meshName === 'fingerboard' || meshName === 'pegbox' || meshName === 'finial' || meshName === 'pegs' || meshName === 'bridge' || meshName === 'tail') return 'ebony';
  return 'wood';
}

function contourOnly(name: string) {
  return name.startsWith('part-string-')
    || name === 'string-tails'
    || name.startsWith('rings-')
    || name === 'hooks'
    || name === 'tacks'
    || name === 'pegs'
    || name === 'purfling'
    || name === 'seams'
    || name === 'rosettes';
}

function hullPx(name: string) {
  if (name.startsWith('part-string-') || name === 'string-tails') return 0.9;
  if (contourOnly(name)) return 1.15;
  return 1.55;
}

interface HeroView {
  dir: import('three').Vector3;
  target: import('three').Vector3;
  fov: number;
}

async function loadHero(THREE: THREE, key: string): Promise<HeroView> {
  const dir = new THREE.Vector3(0.58, 0.34, 0.74).normalize();
  const target = new THREE.Vector3();
  try {
    const res = await fetch(`/instruments/3d/${key}.json`);
    if (!res.ok) return { dir, target, fov: 36 };
    const json = (await res.json()) as { cameras?: { hero?: { position?: number[]; target?: number[]; fov?: number } } };
    const hero = json.cameras?.hero;
    const p = hero?.position;
    if (!p || p.length !== 3) return { dir, target, fov: 36 };
    const look = new THREE.Vector3(p[0], p[1], p[2]);
    if (look.lengthSq() < 1e-8) return { dir, target, fov: 36 };
    look.normalize();
    const t = hero?.target;
    const fov = typeof hero?.fov === 'number' && hero.fov > 8 && hero.fov < 80 ? hero.fov : 36;
    return { dir: look, target: t && t.length === 3 ? new THREE.Vector3(t[0], t[1], t[2]) : target, fov };
  } catch {
    return { dir, target, fov: 36 };
  }
}

function copySpin(root: Object3D, target: import('three').Matrix3) {
  root.updateMatrix();
  const e = root.matrix.elements;
  target.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]);
}

interface Jingle {
  obj: Object3D;
  base: import('three').Vector3;
  axis: import('three').Vector3;
  phase: number;
  scale: number;
}

interface MorphRef {
  influences: number[];
  slot: number;
  index: number;
}

interface ViewModel {
  key: string;
  root: Group;
  uniforms: Uniforms;
  strings: MorphRef[];
  skin: MorphRef | null;
  jingles: Jingle[];
  /** Distance from the origin to the farthest point of the rest pose. */
  reach: number;
  /**
   * Rest-pose surface points in the root's local space. The hero frame is fitted
   * to these, not to the bounding-box corners: a disk's box sticks out past the rim.
   */
  shell: Float32Array;
  hero: HeroView;
  shadow: Mesh;
  shadowAlpha: { value: number };
  pbr: Material[];
  owned: Material[];
  turn: number;
  rotate: number;
  yaw: number;
  pitch: number;
  presence: number;
}

type PassMode = 'hatch' | 'line' | number;

function passMaterial(THREE: THREE, uniforms: Uniforms, mode: PassMode): import('three').MeshBasicMaterial {
  const hull = typeof mode === 'number';
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: hull ? THREE.BackSide : THREE.FrontSide,
    transparent: true,
    depthWrite: mode === 'hatch',
    depthTest: true,
    toneMapped: false,
  });
  mat.customProgramCacheKey = () => (hull ? `ll-hull-${mode}` : `ll-${mode}`);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = uniforms.uInk;
    shader.uniforms.uDraw = uniforms.uDraw;
    shader.uniforms.uHatch = uniforms.uHatch;
    shader.uniforms.uOpacity = uniforms.uOpacity;
    shader.uniforms.uViewportH = uniforms.uViewportH;
    shader.uniforms.uRoot = uniforms.uRoot;
    // MeshBasic does not compute normals unless the material uses an env map.
    const normals = '#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n';
    const stick = `vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vStick = vec3(dot(uRoot[0], vWorld), dot(uRoot[1], vWorld), dot(uRoot[2], vWorld));
         {
           vec3 viewNn = normalize(normalMatrix * objectNormal);
           mat3 camR = mat3(viewMatrix);
           vWorldN = vec3(dot(camR[0], viewNn), dot(camR[1], viewNn), dot(camR[2], viewNn));
         }
         vStickN = vec3(dot(uRoot[0], vWorldN), dot(uRoot[1], vWorldN), dot(uRoot[2], vWorldN));`;
    // Screen-space hull: a world-space extrusion becomes a broken pixel on a small card.
    const outline = typeof mode === 'number'
      ? `vec3 clipViewN = normalize(mat3(modelViewMatrix) * objectNormal);
         vec2 clipN = (projectionMatrix * vec4(clipViewN, 0.0)).xy;
         float clipLen = max(length(clipN), 0.0001);
         gl_Position.xy += (clipN / clipLen) * (${mode.toFixed(2)} / max(uViewportH, 1.0)) * 2.0 * gl_Position.w;`
      : '';
    const decl = 'uniform float uViewportH;\nuniform mat3 uRoot;\nvarying vec3 vWorld;\nvarying vec3 vWorldN;\nvarying vec3 vStick;\nvarying vec3 vStickN;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${decl}`)
      .replace('#include <project_vertex>', `${normals}${stick}\n#include <project_vertex>\n${outline}`);
    // Form hatch: strokes run along the surface (projected +Y), a hairline on the lit
    // side and a wider, doubled stroke in shadow. Width is in pixels via fwidth, so a
    // low duty does not collapse into a stipple. Line parts discard; only their hull remains.
    // smoothstep edges stay in ascending order.
    const hatch = mode === 'hatch'
      ? `vec3 nrm = normalize(vStickN);
         vec3 nrmW = normalize(vWorldN);
         float ndotl = clamp(dot(nrmW, normalize(${KEY})), 0.0, 1.0);
         float shadow = 1.0 - smoothstep(0.2, 0.78, ndotl);
         vec3 axis = vec3(0.0, 1.0, 0.0);
         vec3 tng = axis - nrm * dot(nrm, axis);
         float tlen = length(tng);
         vec3 along = tlen > 0.2 ? tng / tlen : vec3(1.0, 0.0, 0.0);
         vec3 across = normalize(cross(nrm, along));
         float u = dot(vStick, across);
         float v = dot(vStick, along);
         float face = smoothstep(0.45, 0.82, abs(nrm.z));
         float freq = mix(14.0, 20.0, face);
         float fw = max(fwidth(u), 0.0004);
         float aa = fw * 0.75;
         float dist = min(fract(u * freq), 1.0 - fract(u * freq)) / freq;
         float width = fw * mix(0.5, 1.75, shadow);
         float line = 1.0 - smoothstep(width, width + aa, dist);
         // Lit paper stays a faint grain; the shadow side carries the full stroke.
         float grain = line * mix(0.18, 1.0, shadow);
         float freq2 = freq * 2.0;
         float dist2 = min(fract(u * freq2), 1.0 - fract(u * freq2)) / freq2;
         float cover = smoothstep(0.18, 0.62, shadow);
         float width2 = fw * 1.15 * cover;
         float extra = cover * (1.0 - smoothstep(width2, width2 + aa, dist2));
         float vfw = max(fwidth(v), 0.0004);
         float vdist = min(fract(v * 12.0), 1.0 - fract(v * 12.0)) / 12.0;
         float crossCover = smoothstep(0.72, 0.95, shadow);
         float crossW = vfw * 1.05 * crossCover;
         float crossh = crossCover * (1.0 - smoothstep(crossW, crossW + vfw * 0.7, vdist));
         float hatchInk = max(grain, max(extra, crossh));
         if (hatchInk * uHatch < 0.04) discard;`
      : '';
    // A bare discard strips gl_FragColor and the draw is invalid. The uniform test keeps an output.
    const lineDiscard = mode === 'line' ? 'if (uDraw > -1.0) discard;' : '';
    const alpha = mode === 'hatch'
      ? 'diffuseColor.a = uDraw * uOpacity * hatchInk;'
      : 'diffuseColor.a = uDraw * uOpacity;';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uInk;\nuniform float uDraw;\nuniform float uHatch;\nuniform float uOpacity;\n${decl}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${hatch}\ndiffuseColor.rgb = uInk;\n${alpha}\n${lineDiscard}`);
  };
  return mat;
}

function pbrFragment(role: Role): { color: string; light: string } {
  const glint = `float spec = pow(clamp(dot(normalize(vWorldN), normalize(${KEY})), 0.0, 1.0), `;
  if (role === 'spruce') {
    return {
      color: `float fiber = sin(vStick.x * 220.0 + sin(vStick.y * 8.0) * 1.4);
         float hair = sin(vStick.x * 540.0 + vStick.y * 3.0);
         float late = smoothstep(0.82, 0.98, fract(sin(floor(vStick.x * 46.0) * 19.13) * 43758.5453));
         float g = 0.9 + 0.08 * fiber + 0.04 * hair;
         diffuseColor.rgb *= g * mix(1.0, 0.8, late);`,
      light: '',
    };
  }
  if (role === 'bowl') {
    return {
      color: `float az = atan(vStick.x, -vStick.z);
         float rib = floor(az / 3.14159265 * 15.0);
         float h = fract(sin(rib * 12.9898) * 43758.5453);
         float band = step(0.34, h) + step(0.67, h);
         vec3 tone = band < 0.5 ? vec3(1.22, 1.08, 0.9) : (band < 1.5 ? vec3(0.9, 0.78, 0.66) : vec3(0.58, 0.46, 0.36));
         float grain = 0.94 + 0.06 * sin(az * 28.0 + rib);
         diffuseColor.rgb *= tone * grain;`,
      light: '',
    };
  }
  if (role === 'wood-inner') return { color: 'diffuseColor.rgb *= vec3(0.38, 0.3, 0.26);', light: '' };
  if (role === 'skin') {
    return {
      color: `float n = sin(vStick.x * 6.5 + sin(vStick.y * 2.4) * 1.3);
         float n2 = sin(vStick.y * 4.2 - vStick.x * 1.8 + sin(vStick.x * 2.1) * 1.6);
         diffuseColor.rgb *= 0.975 + 0.02 * n + 0.015 * n2;
         diffuseColor.a *= 0.9 + 0.02 * n;`,
      light: '',
    };
  }
  if (role === 'metal') {
    return {
      color: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.7, 0.4), 0.25);',
      light: `${glint}26.0);\ngl_FragColor.rgb += vec3(0.55, 0.46, 0.28) * spec;`,
    };
  }
  if (role === 'string') {
    return { color: '', light: `${glint}18.0);\ngl_FragColor.rgb += vec3(0.5, 0.48, 0.42) * spec;` };
  }
  if (role === 'guard') {
    return {
      color: `float blot = fract(sin(dot(floor(vStick.xy * 11.0), vec2(12.9898, 78.233))) * 43758.5453);
         vec3 amber = vec3(0.62, 0.40, 0.20);
         vec3 umber = vec3(0.30, 0.17, 0.08);
         diffuseColor.rgb = mix(amber, umber, smoothstep(0.28, 0.82, blot));`,
      light: '',
    };
  }
  if (role === 'ebony') {
    return { color: '', light: `${glint}12.0);\ngl_FragColor.rgb += vec3(0.08, 0.07, 0.06) * spec;` };
  }
  if (role === 'leather') {
    return {
      color: `float n = sin(vStick.x * 80.0) * sin(vStick.y * 60.0);
         diffuseColor.rgb *= 0.92 + 0.1 * n;`,
      light: '',
    };
  }
  if (role === 'seam') return { color: 'diffuseColor.rgb *= 0.94;', light: '' };
  return {
    color: `float g = 0.92 + 0.06 * sin(vStick.y * 90.0 + vStick.x * 14.0) + 0.04 * sin(vStick.x * 70.0 + vStick.z * 40.0);
       diffuseColor.rgb *= g;`,
    light: '',
  };
}

function tune(mat: Material, role: Role) {
  const std = mat as import('three').MeshStandardMaterial;
  if (typeof std.roughness !== 'number' || !std.color) return;
  if (role === 'metal') {
    std.color.set('#e0c27a');
    std.roughness = 0.24;
    std.metalness = 0.94;
  } else if (role === 'string') {
    std.roughness = 0.2;
    std.metalness = 0.55;
  } else if (role === 'wood-inner') {
    std.color.set('#24160f');
    std.roughness = 0.9;
    std.metalness = 0.02;
  } else if (role === 'guard') {
    std.color.set('#8d6236');
    std.roughness = 0.46;
    std.metalness = 0.04;
  } else if (role === 'skin') {
    std.color.set('#efe2c4');
    std.roughness = 0.72;
    std.metalness = 0;
    std.depthWrite = false;
  } else if (role === 'ebony') {
    std.roughness = 0.34;
    std.metalness = 0.08;
  } else if (role === 'spruce') {
    std.roughness = 0.58;
    std.metalness = 0;
  }
}

function patchPbr(mat: Material, uniforms: Uniforms, role: Role) {
  const extra = pbrFragment(role);
  mat.customProgramCacheKey = () => `ll-pbr-${role}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRoot = uniforms.uRoot;
    const decl = 'uniform mat3 uRoot;\nvarying vec3 vWorld;\nvarying vec3 vWorldN;\nvarying vec3 vStick;\nvarying vec3 vStickN;';
    const stick = `vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vStick = vec3(dot(uRoot[0], vWorld), dot(uRoot[1], vWorld), dot(uRoot[2], vWorld));
         {
           vec3 viewNn = normalize(normalMatrix * objectNormal);
           mat3 camR = mat3(viewMatrix);
           vWorldN = vec3(dot(camR[0], viewNn), dot(camR[1], viewNn), dot(camR[2], viewNn));
         }
         vStickN = vec3(dot(uRoot[0], vWorldN), dot(uRoot[1], vWorldN), dot(uRoot[2], vWorldN));`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${decl}`)
      .replace('#include <project_vertex>', `${stick}\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${extra.color}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${extra.light}`);
  };
}

function dress(THREE: THREE, root: Group, uniforms: Uniforms) {
  const strings: MorphRef[] = [];
  const jingles: Jingle[] = [];
  const pbr: Material[] = [];
  const owned: Material[] = [];
  let skin: MorphRef | null = null;
  const meshes: Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  const bodyHatch = passMaterial(THREE, uniforms, 'hatch');
  const lineHatch = passMaterial(THREE, uniforms, 'line');
  const bodyHull = passMaterial(THREE, uniforms, hullPx('bowl'));
  const lineHull = passMaterial(THREE, uniforms, hullPx('rosettes'));
  const stringHull = passMaterial(THREE, uniforms, hullPx('part-string-1'));
  // Opaque depth prepass so the hull's back faces only survive at the silhouette.
  // An opacity of 0 would be skipped, and the outline would fill the whole instrument.
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });
  owned.push(bodyHatch, lineHatch, bodyHull, lineHull, stringHull, depthMat);
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    const source = mesh.material as Material;
    const role = roleOf(mesh.name, source.name);
    const cloned = source.clone();
    cloned.transparent = true;
    tune(cloned, role);
    patchPbr(cloned, uniforms, role);
    mesh.userData.pbr = cloned;
    pbr.push(cloned);
    owned.push(cloned);
    const isString = mesh.name.startsWith('part-string-');
    const line = contourOnly(mesh.name);
    const depth = new THREE.Mesh(mesh.geometry, depthMat);
    const hull = new THREE.Mesh(mesh.geometry, isString ? stringHull : line ? lineHull : bodyHull);
    for (const pass of [depth, hull]) {
      pass.frustumCulled = false;
      pass.morphTargetInfluences = mesh.morphTargetInfluences;
      pass.morphTargetDictionary = mesh.morphTargetDictionary;
      pass.renderOrder = pass === depth ? 0 : 1;
      pass.userData.pass = pass === depth ? 'depth' : 'hull';
    }
    mesh.renderOrder = 2;
    mesh.add(depth);
    mesh.add(hull);
    mesh.userData.hatch = line ? lineHatch : bodyHatch;
    mesh.userData.hull = hull;
    mesh.userData.depth = depth;
    mesh.material = mesh.userData.hatch as Material;
    const dict = mesh.morphTargetDictionary;
    if (isString && dict && dict.vibrate !== undefined && mesh.morphTargetInfluences) {
      strings.push({ influences: mesh.morphTargetInfluences, slot: dict.vibrate, index: Number(mesh.name.slice('part-string-'.length)) - 1 });
    }
    if (mesh.name === 'part-skin' && dict && dict.hit !== undefined && mesh.morphTargetInfluences) {
      skin = { influences: mesh.morphTargetInfluences, slot: dict.hit, index: 0 };
    }
  }
  root.traverse((obj) => {
    const axis = obj.userData.axis;
    if (!Array.isArray(axis) || axis.length !== 3) return;
    jingles.push({
      obj,
      base: obj.position.clone(),
      axis: new THREE.Vector3(Number(axis[0]), Number(axis[1]), Number(axis[2])).normalize(),
      phase: Number(obj.userData.phase) || 0,
      scale: obj.scale.x || 1,
    });
  });
  return { strings, skin, jingles, pbr, owned };
}

function applyStyle(root: Group, style: VolumeLook) {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || mesh.userData.pass) return;
    const engraving = style === 'engraving';
    mesh.material = (engraving ? mesh.userData.hatch : mesh.userData.pbr) as Material;
    (mesh.userData.depth as Object3D).visible = engraving;
    (mesh.userData.hull as Object3D).visible = engraving;
  });
}

function applyPose(THREE: THREE, model: ViewModel, drive: InstrumentDrive, time: number) {
  for (const s of model.strings) s.influences[s.slot] = stringWeight(drive, time, s.index);
  if (model.skin) model.skin.influences[model.skin.slot] = skinWeight(drive, time);
  for (const j of model.jingles) {
    const shift = jingleShift(drive, time, j.phase) * 0.014;
    j.obj.position.copy(j.base).addScaledVector(j.axis, shift / j.scale);
  }
  const lean = sway(drive);
  model.root.rotation.order = 'YXZ';
  model.root.rotation.y = THREE.MathUtils.degToRad(model.turn) + model.yaw;
  model.root.rotation.x = model.pitch + lean.x;
  model.root.rotation.z = -THREE.MathUtils.degToRad(model.rotate) + lean.z;
  model.uniforms.uDraw.value = drive.draw;
  model.uniforms.uHatch.value = drive.hatch;
  model.uniforms.uOpacity.value = model.presence;
  for (const mat of model.pbr) mat.opacity = model.presence * drive.draw;
}

function readInk(THREE: THREE, el: HTMLElement) {
  const color = new THREE.Color('#6b4a12');
  try {
    const raw = getComputedStyle(el).color;
    if (raw) color.setStyle(raw);
  } catch {
    /* computed colour can be a color-mix the parser rejects; keep the fallback ink */
  }
  return color;
}

function isDark() {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface StageSlotSpec {
  art: HTMLElement;
  key: string;
  turn: number;
  rotate: number;
  presence: number;
  drive: InstrumentDrive;
  z: number;
}

interface Slot {
  art: HTMLElement;
  model: ViewModel;
  drive: InstrumentDrive;
  z: number;
}

export interface StageView {
  art: HTMLElement;
  drive: InstrumentDrive;
  presence: number;
  turn: number;
  rotate: number;
  z: number;
}

/** Closer than 1 crops the fitted view. `targetY` is the look-at point in model space. */
export interface CameraFrame {
  scale?: number;
  targetY?: number;
}

export interface StageSession {
  setSlots(slots: StageSlotSpec[]): Promise<void>;
  /** Per-frame pose. Does not reload models. Ignored when the slot count does not match. */
  setViews(views: StageView[]): void;
  setTime(time: number): void;
  setDriveOverride(drives: InstrumentDrive[] | null): void;
  setOrbit(yaw: number, pitch: number): void;
  setCamera(frame: CameraFrame | null): void;
  setStyle(style: VolumeLook): void;
  draw(): void;
  pixels(): { width: number; height: number; data: Uint8ClampedArray };
  dispose(): void;
}

export async function mountStage(host: HTMLElement, canvas: HTMLCanvasElement, opts?: { preserve?: boolean }): Promise<StageSession> {
  const { THREE } = await engine();
  const renderer: WebGLRenderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: opts?.preserve ?? false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 40);
  const hemi = new THREE.HemisphereLight(0xfff4e8, 0x3a342c, 0.55);
  const key = new THREE.DirectionalLight(0xfff6ee, 1.35);
  key.position.set(-0.25, 0.48, 0.84);
  const fill = new THREE.DirectionalLight(0xd7e6ff, 0.34);
  fill.position.set(1.15, 0.25, 0.7);
  const rim = new THREE.DirectionalLight(0xffe0b0, 0.72);
  rim.position.set(0.35, 0.55, -1.25);
  scene.add(hemi, key, fill, rim);

  let style: VolumeLook = 'materials';
  let slots: Slot[] = [];
  let time = 0;
  let override: InstrumentDrive[] | null = null;
  let camScale = 1;
  let camTargetY = 0;
  let raf = 0;
  let disposed = false;
  let onScreen = true;
  let token = 0;

  const applyTone = () => {
    if (style === 'engraving') {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
    } else {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = isDark() ? 0.9 : 1.02;
    }
  };

  const ndc = new THREE.Vector3();
  const placeCamera = (model: ViewModel, aspect: number) => {
    const hero = model.hero;
    camera.fov = hero.fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const half = Math.min(vFov, hFov) / 2;
    // Start from the bounding sphere, then match the projected box: about 80% of the
    // frame height, and never wider than 90%. NDC y is the full frame from -1 to 1,
    // so a half-span of 0.8 is 80% of the height.
    let dist = (model.reach / Math.sin(half)) * camScale;
    let tx = hero.target.x;
    let ty = hero.target.y + camTargetY;
    let tz = hero.target.z;
    const aim = () => {
      camera.position.set(tx + hero.dir.x * dist, ty + hero.dir.y * dist, tz + hero.dir.z * dist);
      camera.lookAt(tx, ty, tz);
      camera.updateMatrixWorld(true);
      model.root.updateWorldMatrix(true, false);
    };
    const span = () => {
      aim();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const shell = model.shell;
      for (let p = 0; p < shell.length; p += 3) {
        ndc.set(shell[p], shell[p + 1], shell[p + 2]).applyMatrix4(model.root.matrixWorld).project(camera);
        if (ndc.x < minX) minX = ndc.x;
        if (ndc.x > maxX) maxX = ndc.x;
        if (ndc.y < minY) minY = ndc.y;
        if (ndc.y > maxY) maxY = ndc.y;
      }
      return { minX, maxX, minY, maxY, w: (maxX - minX) / 2, h: (maxY - minY) / 2 };
    };
    for (let i = 0; i < 4; i++) {
      const fitted = span();
      const cx = (fitted.minX + fitted.maxX) / 2;
      const cy = (fitted.minY + fitted.maxY) / 2;
      if (Number.isFinite(cx) && Number.isFinite(cy) && (Math.abs(cx) > 0.01 || Math.abs(cy) > 0.01)) {
        // Screen right and up are the camera matrix columns. Shift the aim by the
        // projected offset so the box center lands on the view axis.
        const e = camera.matrixWorld.elements;
        const halfH = Math.tan(vFov / 2) * dist;
        const halfW = halfH * aspect;
        tx += e[0] * cx * halfW + e[4] * cy * halfH;
        ty += e[1] * cx * halfW + e[5] * cy * halfH;
        tz += e[2] * cx * halfW + e[6] * cy * halfH;
      }
      const scale = Math.max(fitted.h / 0.8, fitted.w / 0.9);
      if (!Number.isFinite(scale) || scale < 1e-4) break;
      dist *= scale;
    }
    aim();
  };

  function draw() {
    if (disposed || !onScreen) return;
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const bw = Math.max(1, Math.round(rect.width * dpr));
    const bh = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== bw || canvas.height !== bh) renderer.setSize(bw, bh, false);
    applyTone();
    const ink = readInk(THREE, canvas);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, bw, bh);
    renderer.clear(true, true, false);
    renderer.setScissorTest(true);
    const ordered = [...slots].sort((a, b) => a.z - b.z);
    for (const slot of ordered) {
      slot.model.uniforms.uInk.value.copy(ink);
      if (slot.model.presence <= 0.001) continue;
      const art = slot.art.getBoundingClientRect();
      const x = art.left - rect.left;
      const yTop = art.top - rect.top;
      const w = art.width;
      const h = art.height;
      if (w < 2 || h < 2) continue;
      const y = rect.height - yTop - h;
      renderer.setViewport(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
      renderer.setScissor(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
      renderer.clear(true, true, false);
      for (const other of slots) {
        const on = other === slot;
        other.model.root.visible = on;
        other.model.shadow.visible = on && style === 'materials';
      }
      slot.model.shadowAlpha.value = isDark() ? 0.34 : 0.2;
      const drive = override?.[slots.indexOf(slot)] ?? slot.drive;
      slot.model.uniforms.uViewportH.value = Math.max(1, Math.round(h * dpr));
      applyPose(THREE, slot.model, drive, time);
      copySpin(slot.model.root, slot.model.uniforms.uRoot.value);
      placeCamera(slot.model, w / Math.max(1, h));
      renderer.render(scene, camera);
    }
  }

  const schedule = () => {
    if (raf || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  };

  async function createInstance(key: string): Promise<ViewModel> {
    const [template, hero] = await Promise.all([templateFor(key), loadHero(THREE, key)]);
    const root = template.clone(true);
    const uniforms: Uniforms = {
      uInk: { value: new THREE.Color('#6b4a12') },
      uDraw: { value: 1 },
      uHatch: { value: 1 },
      uOpacity: { value: 1 },
      uViewportH: { value: 800 },
      uRoot: { value: new THREE.Matrix3() },
    };
    const parts = dress(THREE, root, uniforms);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const reach = Math.max(0.25, sphere.center.length() + sphere.radius);
    root.updateWorldMatrix(true, true);
    const intoRoot = new THREE.Matrix4();
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const shellPts: number[] = [];
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || mesh.userData.pass) return;
      const pos = (mesh.geometry as { attributes?: { position?: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).attributes?.position;
      if (!pos || pos.count < 1) return;
      intoRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
      const e = intoRoot.elements;
      const step = Math.max(1, Math.ceil(pos.count / 80));
      for (let i = 0; i < pos.count; i += step) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        shellPts.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
    });
    const shell = new Float32Array(shellPts);
    const shadowAlpha = { value: 0.2 };
    const shadowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uAlpha: shadowAlpha },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uAlpha; varying vec2 vUv; void main() { float r = length((vUv - vec2(0.5)) * 2.0); float a = smoothstep(1.0, 0.35, r) * uAlpha; if (a < 0.004) discard; gl_FragColor = vec4(0.10, 0.07, 0.04, a); }',
    });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = box.min.y - 0.02;
    shadow.scale.set(Math.max(0.2, box.max.x - box.min.x) * 0.58, Math.max(0.2, box.max.z - box.min.z) * 0.5, 1);
    shadow.renderOrder = -2;
    shadow.frustumCulled = false;
    shadow.visible = false;
    scene.add(shadow);
    parts.owned.push(shadowMat);
    const model: ViewModel = {
      key,
      root,
      uniforms,
      strings: parts.strings,
      skin: parts.skin,
      jingles: parts.jingles,
      reach,
      shell,
      hero,
      shadow,
      shadowAlpha,
      pbr: parts.pbr,
      owned: parts.owned,
      turn: 0,
      rotate: 0,
      yaw: 0,
      pitch: 0,
      presence: 1,
    };
    applyStyle(root, style);
    return model;
  }

  const themeObs = new MutationObserver(() => schedule());
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => schedule();
  scheme.addEventListener('change', onScheme);
  const seen = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) schedule();
  });
  seen.observe(host);
  const resized = new ResizeObserver(() => schedule());
  resized.observe(host);

  const dropModel = (model: ViewModel) => {
    model.root.removeFromParent();
    model.shadow.removeFromParent();
    (model.shadow.geometry as { dispose(): void }).dispose();
    for (const mat of model.owned) mat.dispose();
  };

  return {
    async setSlots(next) {
      const id = ++token;
      const models: ViewModel[] = [];
      for (let i = 0; i < next.length; i++) {
        const prev = slots[i];
        if (prev && prev.model.key === next[i].key) models.push(prev.model);
        else models.push(await createInstance(next[i].key));
        if (id !== token || disposed) {
          for (const model of models) {
            if (!slots.some((s) => s.model === model)) dropModel(model);
          }
          return;
        }
      }
      const keep = new Set(models);
      for (const prev of slots) {
        if (!keep.has(prev.model)) dropModel(prev.model);
      }
      slots = next.map((spec, i) => {
        const model = models[i];
        model.turn = spec.turn;
        model.rotate = spec.rotate;
        model.presence = spec.presence;
        return { art: spec.art, model, drive: spec.drive, z: spec.z };
      });
      schedule();
    },
    setViews(views) {
      if (views.length !== slots.length) return;
      views.forEach((view, i) => {
        const slot = slots[i];
        slot.art = view.art;
        slot.drive = view.drive;
        slot.z = view.z;
        slot.model.presence = view.presence;
        slot.model.turn = view.turn;
        slot.model.rotate = view.rotate;
      });
      schedule();
    },
    setTime(t) {
      time = t;
      schedule();
    },
    setDriveOverride(drives) {
      override = drives;
      schedule();
    },
    setOrbit(yaw, pitch) {
      for (const slot of slots) {
        slot.model.yaw = yaw;
        slot.model.pitch = pitch;
      }
      schedule();
    },
    setCamera(frame) {
      camScale = frame?.scale && frame.scale > 0 ? frame.scale : 1;
      camTargetY = frame?.targetY ?? 0;
      schedule();
    },
    setStyle(nextStyle) {
      style = nextStyle;
      for (const slot of slots) applyStyle(slot.model.root, style);
      schedule();
    },
    draw() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const was = onScreen;
      onScreen = true;
      draw();
      onScreen = was;
    },
    pixels() {
      const was = onScreen;
      onScreen = true;
      draw();
      onScreen = was;
      const gl = renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const data = new Uint8ClampedArray(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return { width, height, data };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      token++;
      if (raf) cancelAnimationFrame(raf);
      themeObs.disconnect();
      scheme.removeEventListener('change', onScheme);
      seen.disconnect();
      resized.disconnect();
      for (const slot of slots) dropModel(slot.model);
      slots = [];
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

const REST: InstrumentDrive = { draw: 1, hatch: 1, energy: 0, pulse: 0, sustain: 0, breath: 0, beat: 0 };

/** One instrument, one canvas. Gallery cards use this; the stage uses `mountStage`. */
export function createInstrumentRenderer(): InstrumentRenderer & {
  setOrbit(yaw: number, pitch: number): void;
  setStyle(style: VolumeLook): void;
} {
  let session: StageSession | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let host: HTMLElement | null = null;
  let alive = true;
  let style: VolumeLook = 'materials';

  return {
    kind: 'gltf',
    async mount(container, key) {
      host = container;
      canvas = document.createElement('canvas');
      canvas.className = 'ig-gl';
      canvas.setAttribute('aria-hidden', 'true');
      container.appendChild(canvas);
      session = await mountStage(container, canvas);
      if (!alive) {
        session.dispose();
        return;
      }
      session.setStyle(style);
      await session.setSlots([{ art: canvas, key, turn: 0, rotate: 0, presence: 1, drive: REST, z: 1 }]);
      container.dataset.ready = '1';
    },
    update(drive, time) {
      if (time !== undefined) session?.setTime(time);
      session?.setDriveOverride([drive]);
    },
    setOrbit(yaw, pitch) {
      session?.setOrbit(yaw, pitch);
    },
    setStyle(next) {
      style = next;
      session?.setStyle(next);
    },
    dispose() {
      alive = false;
      session?.dispose();
      session = null;
      canvas?.remove();
      canvas = null;
      if (host) delete host.dataset.ready;
    },
  };
}
