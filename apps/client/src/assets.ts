import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
export interface Manifest { characters: { id: number; url: string }[]; props: Record<string, string>; animations: Record<string, { duration: number; loop: boolean; authoredSpeed?: number }>; sockets: { large: string; small: string } }
export class Assets {
  readonly models = new Map<string, GLTF>();
  manifest!: Manifest;
  private disposed = false;
  async load(progress: (ratio: number) => void, signal: AbortSignal) {
    const response = await fetch('/assets/manifest.json', { signal }); if (!response.ok) throw new Error('Không tải được danh sách tài nguyên.');
    this.manifest = await response.json() as Manifest;
    const entries: [string, string][] = [...this.manifest.characters.map(c => [`student-${c.id}`, c.url] as [string, string]), ...Object.entries(this.manifest.props)];
    const loader = new GLTFLoader(); let loaded = 0;
    // Fetch is cancellable; parseAsync does not own network or callbacks after teardown.
    await Promise.all(entries.map(async ([name, url]) => {
      const r = await fetch(url, { signal }); if (!r.ok) throw new Error(`Không tải được ${name}.`);
      const model = await loader.parseAsync(await r.arrayBuffer(), '/assets/');
      if (this.disposed || signal.aborted) { disposeObjects([model.scene]); return; }
      // Register ownership before validation so boot failure also frees a rejected GLB.
      this.models.set(name, model);
      if (name.startsWith('student-')) {
        for (const clip of model.animations) if (!this.manifest.animations[clip.name]) throw new Error(`Tài nguyên ${name} có chuyển động chưa được hỗ trợ: ${clip.name}.`);
        for (const clip of Object.keys(this.manifest.animations)) if (!model.animations.some(a => a.name === clip)) throw new Error(`Thiếu chuyển động ${clip}.`);
        for (const socket of Object.values(this.manifest.sockets)) if (!model.scene.getObjectByName(socket)) throw new Error(`Thiếu điểm cầm ${socket}.`);
      }
      model.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      progress(++loaded / entries.length);
    }));
  }
  prop(name: string) { const source = this.models.get(name); if (!source) throw new Error(`Thiếu tài nguyên ${name}`); return source.scene.clone(true); }
  student(variant: number) { const source = this.models.get(`student-${variant}`)!; return { object: clone(source.scene), clips: source.animations }; }
  dispose(extraRoots: THREE.Object3D[] = []) { this.disposed = true; disposeObjects([...this.models.values()].map(m => m.scene as THREE.Object3D).concat(extraRoots)); this.models.clear(); }
}
/** Dispose shared geometry/material/texture once, only at the owning scene's end. */
export function disposeObjects(roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  const instances = new Set<THREE.InstancedMesh>();
  for (const root of roots) root.traverse(o => {
    if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); }
    if (o instanceof THREE.Sprite) materials.add(o.material);
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
    if (o instanceof THREE.InstancedMesh) instances.add(o);
  });
  for (const m of materials) for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
  for (const o of instances) o.dispose();
  for (const s of skeletons) s.dispose(); for (const t of textures) t.dispose(); for (const m of materials) m.dispose(); for (const g of geometries) g.dispose();
}
