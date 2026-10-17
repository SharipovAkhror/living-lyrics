/** Minimal types for the lazy three.js import. The package ships JavaScript only. */

declare module 'three' {
  export const SRGBColorSpace: string;
  export const NoToneMapping: number;
  export const ACESFilmicToneMapping: number;
  export const FrontSide: number;
  export const BackSide: number;

  export class MathUtils {
    static degToRad(degrees: number): number;
  }

  export class Color {
    constructor(color?: string | number);
    set(color: string | number): this;
    setStyle(style: string): this;
    copy(color: Color): this;
  }

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    sub(v: Vector3): this;
    normalize(): this;
    length(): number;
    lengthSq(): number;
    addScaledVector(v: Vector3, scale: number): this;
  }

  export class Matrix3 {
    constructor();
    set(n11: number, n12: number, n13: number, n21: number, n22: number, n23: number, n31: number, n32: number, n33: number): this;
  }

  export class Matrix4 {
    elements: number[];
  }

  export class Euler {
    order: string;
    x: number;
    y: number;
    z: number;
  }

  export class Sphere {
    center: Vector3;
    radius: number;
    constructor(center?: Vector3, radius?: number);
  }

  export class Box3 {
    min: Vector3;
    max: Vector3;
    setFromObject(object: Object3D): this;
    getBoundingSphere(target: Sphere): Sphere;
  }

  export interface ShaderPatch {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
  }

  export class Object3D {
    name: string;
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
    visible: boolean;
    userData: Record<string, unknown>;
    frustumCulled: boolean;
    renderOrder: number;
    parent: Object3D | null;
    matrix: Matrix4;
    traverse(callback: (object: Object3D) => void): void;
    updateMatrix(): void;
    add(...objects: Object3D[]): this;
    removeFromParent(): this;
    getObjectByName(name: string): Object3D | undefined;
    clone(recursive?: boolean): this;
  }

  export class Material {
    name: string;
    transparent: boolean;
    opacity: number;
    side: number;
    toneMapped: boolean;
    depthWrite: boolean;
    depthTest: boolean;
    customProgramCacheKey: () => string;
    onBeforeCompile: (shader: ShaderPatch) => void;
    clone(): this;
    dispose(): void;
  }

  export class MeshBasicMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
    color: Color;
  }

  export class MeshStandardMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
    color: Color;
    roughness: number;
    metalness: number;
  }

  export class ShaderMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
    uniforms: Record<string, { value: unknown }>;
  }

  export class CircleGeometry {
    constructor(radius?: number, segments?: number);
    dispose(): void;
  }

  export class Mesh extends Object3D {
    isMesh: boolean;
    geometry: unknown;
    material: Material | Material[];
    morphTargetInfluences?: number[];
    morphTargetDictionary?: Record<string, number>;
    constructor(geometry?: unknown, material?: Material);
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {}

  export class PerspectiveCamera extends Object3D {
    fov: number;
    aspect: number;
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    lookAt(x: number, y: number, z: number): void;
    updateProjectionMatrix(): void;
  }

  export class HemisphereLight extends Object3D {
    constructor(sky?: number, ground?: number, intensity?: number);
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export class WebGLRenderer {
    domElement: HTMLCanvasElement;
    outputColorSpace: string;
    toneMapping: number;
    toneMappingExposure: number;
    autoClear: boolean;
    constructor(parameters?: Record<string, unknown>);
    setClearColor(color: number, alpha: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setScissorTest(enable: boolean): void;
    setViewport(x: number, y: number, width: number, height: number): void;
    setScissor(x: number, y: number, width: number, height: number): void;
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
    render(scene: Object3D, camera: Object3D): void;
    dispose(): void;
    forceContextLoss(): void;
    getContext(): WebGLRenderingContext;
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Group } from 'three';
  export class GLTFLoader {
    setMeshoptDecoder(decoder: unknown): void;
    loadAsync(url: string): Promise<{ scene: Group }>;
  }
}
