/**
 * Lazy three.js renderer for instrument GLBs.
 *
 * InstrumentStage uses one WebGL context and scissored viewports. A gallery card uses the same
 * path with a single view, because a card is its own element. Playback time is an argument:
 * the idle clip is not played, and nothing is integrated from the previous frame.
 *
 * Frame: models face +Z. The camera sits on +Z and looks at the origin (down its own −Z).
 * Dragging right decreases rotation.y so the model's right side comes toward the camera.
 * CSS rotate is clockwise; rotation.z uses the opposite sign. Jingle nodes carry a quantization
 * scale, so a world-space shift is divided by that scale.
 */
import type { InstrumentDrive, InstrumentRenderer } from '@/instruments/animation';
import type { InstrumentStyle } from '@/app/settings';
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
  radius: number;
  pbr: Material[];
  owned: Material[];
  turn: number;
  rotate: number;
  yaw: number;
  pitch: number;
  presence: number;
}

function passMaterial(THREE: THREE, uniforms: Uniforms, thickness: number | null): import('three').MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: thickness === null ? THREE.FrontSide : THREE.BackSide,
    transparent: true,
    depthWrite: thickness === null,
    depthTest: true,
    toneMapped: false,
  });
  // `thickness` is the outline width in device pixels. Null is the hatch pass.
  // Body and string hulls bake different widths, so the cache key includes the number.
  mat.customProgramCacheKey = () => (thickness === null ? 'll-hatch' : `ll-hull-${thickness}`);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = uniforms.uInk;
    shader.uniforms.uDraw = uniforms.uDraw;
    shader.uniforms.uHatch = uniforms.uHatch;
    shader.uniforms.uOpacity = uniforms.uOpacity;
    shader.uniforms.uViewportH = uniforms.uViewportH;
    // MeshBasic does not compute normals unless the material uses an env map.
    const normals = '#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n';
    // Push the hull out in screen space so a small card keeps a readable line. World-space
    // extrusion shrinks to a broken pixel when the plate is a couple of hundred pixels tall.
    const outline = thickness === null
      ? ''
      : `vec3 viewN = normalize(mat3(modelViewMatrix) * objectNormal);
         vec2 clipN = (projectionMatrix * vec4(viewN, 0.0)).xy;
         float clipLen = max(length(clipN), 0.0001);
         gl_Position.xy += (clipN / clipLen) * (${thickness.toFixed(2)} / max(uViewportH, 1.0)) * 2.0 * gl_Position.w;`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uViewportH;\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <project_vertex>', `${normals}vObj = transformed;\nvObjN = objectNormal;\n#include <project_vertex>\n${outline}`);
    const hatch = thickness === null
      ? `vec3 nrm = normalize(vObjN);
         float ndotl = clamp(dot(nrm, normalize(vec3(-0.45, 0.72, 0.55))), 0.0, 1.0);
         float stripes = fract(vObj.x * 42.0 + vObj.y * 26.0);
         float onLine = step(0.72, stripes);
         float shadow = 1.0 - smoothstep(0.2, 0.95, ndotl);
         if (onLine * shadow * uHatch < 0.22) discard;`
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInk;\nuniform float uDraw;\nuniform float uHatch;\nuniform float uOpacity;\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${hatch}\ndiffuseColor.rgb = uInk;\ndiffuseColor.a = uDraw * uOpacity;`);
  };
  return mat;
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
  const bodyHatch = passMaterial(THREE, uniforms, null);
  const stringHatch = passMaterial(THREE, uniforms, null);
  const bodyHull = passMaterial(THREE, uniforms, 1.7);
  const stringHull = passMaterial(THREE, uniforms, 0.85);
  // Opaque depth prepass so the hull's back faces only survive at the silhouette.
  // An opacity of 0 would be skipped, and the outline would fill the whole instrument.
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });
  owned.push(bodyHatch, stringHatch, bodyHull, stringHull, depthMat);
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    const cloned = (mesh.material as Material).clone();
    cloned.transparent = true;
    mesh.userData.pbr = cloned;
    pbr.push(cloned);
    owned.push(cloned);
    const isString = mesh.name.startsWith('part-string-');
    const depth = new THREE.Mesh(mesh.geometry, depthMat);
    const hull = new THREE.Mesh(mesh.geometry, isString ? stringHull : bodyHull);
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
    mesh.userData.hatch = isString ? stringHatch : bodyHatch;
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

function applyStyle(root: Group, style: InstrumentStyle) {
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
  setStyle(style: InstrumentStyle): void;
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
  const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 40);
  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x2c261f, 0.9);
  const key = new THREE.DirectionalLight(0xfff8f0, 1.2);
  key.position.set(-0.7, 1.2, 0.9);
  const fill = new THREE.DirectionalLight(0xd5e4ff, 0.38);
  fill.position.set(0.9, 0.15, 0.5);
  scene.add(hemi, key, fill);

  let style: InstrumentStyle = 'engraving';
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
      renderer.toneMappingExposure = isDark() ? 0.82 : 1.05;
    }
  };

  const fit = (radius: number, aspect: number) => {
    const fov = (28 * Math.PI) / 180;
    return radius / 0.84 / Math.tan(fov / 2) / Math.min(1, aspect);
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
      for (const other of slots) other.model.root.visible = other === slot;
      const drive = override?.[slots.indexOf(slot)] ?? slot.drive;
      slot.model.uniforms.uViewportH.value = Math.max(1, Math.round(h * dpr));
      applyPose(THREE, slot.model, drive, time);
      camera.aspect = w / Math.max(1, h);
      camera.position.set(0, camTargetY + 0.01 * camScale, fit(slot.model.radius, camera.aspect) * camScale);
      camera.lookAt(0, camTargetY, 0);
      camera.updateProjectionMatrix();
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
    const template = await templateFor(key);
    const root = template.clone(true);
    const uniforms: Uniforms = {
      uInk: { value: new THREE.Color('#6b4a12') },
      uDraw: { value: 1 },
      uHatch: { value: 1 },
      uOpacity: { value: 1 },
      uViewportH: { value: 800 },
    };
    const parts = dress(THREE, root, uniforms);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const model: ViewModel = {
      key,
      root,
      uniforms,
      strings: parts.strings,
      skin: parts.skin,
      jingles: parts.jingles,
      radius: Math.max(0.25, sphere.radius),
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
      for (const slot of slots) for (const mat of slot.model.owned) mat.dispose();
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
  setStyle(style: InstrumentStyle): void;
} {
  let session: StageSession | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let host: HTMLElement | null = null;
  let alive = true;
  let style: InstrumentStyle = 'engraving';

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
