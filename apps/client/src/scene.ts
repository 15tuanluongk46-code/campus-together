import * as THREE from 'three';
import { TARGETS, targetCompleted, type GameSnapshot, type PlayerSnapshot, type Vec3 } from '@campus/shared';
import { Assets } from './assets.js';
import { Actor } from './actors.js';
import { WorldArt } from './world-art.js';
import { cameraDistance } from './prediction.js';
import { destinationIds, itemNames, symbolIcons, type ContextAction, type Settings } from './model.js';
export interface WorldLabel { id: string; text: string; x: number; y: number; type: 'player' | 'item' | 'target' | 'ping'; variant?: number }
export class CampusScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(52, 1, .08, 140);
  readonly scene = new THREE.Scene();
  readonly assets = new Assets();
  readonly actors = new Map<string, Actor>();
  private items = new Map<string, THREE.Object3D>();
  private art!: WorldArt;
  private highlight: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private cameraRadius = 6;
  private look = new THREE.Vector3(-8, 1.1, 0);
  private cameraReady = false;
  private resized: ResizeObserver;
  private sun: THREE.DirectionalLight;
  private disposed = false;
  settings: Settings;
  constructor(readonly canvas: HTMLCanvasElement, settings: Settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#b9d3ce'); this.scene.fog = new THREE.Fog('#b9d3ce', 40, 100);
    this.scene.add(new THREE.HemisphereLight('#fff1d6', '#6c9c86', 2.25));
    this.sun = new THREE.DirectionalLight('#ffe3b6', 3.2); this.sun.position.set(-20, 35, 20); this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -35, right: 35, top: 30, bottom: -30, near: .5, far: 90 });
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.normalBias = .035; this.sun.shadow.bias = -.0001; this.scene.add(this.sun, this.sun.target);
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(.57, .63, 64), new THREE.MeshBasicMaterial({ color: '#ffd969', side: THREE.DoubleSide, depthTest: false })); this.highlight.rotation.x = -Math.PI / 2; this.highlight.renderOrder = 10; this.highlight.visible = false; this.scene.add(this.highlight);
    this.resized = new ResizeObserver(() => this.resize()); this.resized.observe(canvas); this.applySettings(settings); this.resize();
  }
  async load(progress: (value: number) => void, signal: AbortSignal) {
    await this.assets.load(progress, signal); if (signal.aborted || this.disposed) return;
    await document.fonts.ready; if (signal.aborted || this.disposed) return;
    this.art = new WorldArt(this.assets); this.scene.add(this.art.root);
    for (let i = 0; i < 4; i++) { const a = new Actor(this.assets, i); this.actors.set(`preview-${i}`, a); this.scene.add(a.root); }
  }
  applySettings(settings: Settings) { this.settings = settings; this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 1.7 : 1)); this.renderer.shadowMap.enabled = settings.quality === 'high'; this.resize(); }
  private resize() { const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  resetSession() {
    for (const [id, actor] of this.actors) if (!id.startsWith('preview-')) { actor.dispose(); this.actors.delete(id); }
    for (const item of this.items.values()) item.removeFromParent(); this.items.clear(); this.cameraReady = false;
  }
  render(s: GameSnapshot | null, players: PlayerSnapshot[], localId: string, local: Vec3, yaw: number, pitch: number, mode: 'title' | 'lobby' | 'play' | 'results', context: ContextAction | null, dt: number, time: number): WorldLabel[] {
    if (!this.art || this.disposed) return [];
    const labels: WorldLabel[] = [];
    for (const [id, actor] of this.actors) if (id.startsWith('preview-')) {
      const i = Number(id.slice(-1)); actor.root.visible = mode === 'title';
      if (mode === 'title') actor.update({ id, name: '', variant: i, connected: true, ready: false, position: { x: -8.2 + i * .88, y: 0, z: 2 + Math.sin(i) * .25 }, facing: .45, heldItemId: null, ackSeq: 0, moving: false, sprinting: false, holdTarget: null }, undefined, dt, false);
    }
    const ids = new Set(players.map(p => p.id));
    for (const [id, actor] of this.actors) if (!id.startsWith('preview-') && !ids.has(id)) { actor.dispose(); this.actors.delete(id); }
    for (const p of players) {
      let actor = this.actors.get(p.id); if (!actor) { actor = new Actor(this.assets, p.variant); this.actors.set(p.id, actor); this.scene.add(actor.root); }
      const held = s?.items.find(i => i.id === p.heldItemId); actor.update(p, held, dt, s?.result === 'success');
    }
    if (s) {
      for (const item of s.items) {
        let mesh = this.items.get(item.id); if (!mesh) { mesh = this.assets.prop(item.symbol ? `module-${item.symbol}` : item.kind); this.items.set(item.id, mesh); }
        if (item.state === 'CARRIED') {
          const actor = item.holderId ? this.actors.get(item.holderId) : undefined;
          if (actor) { const socket = item.kind === 'crate' ? actor.sockets.large : actor.sockets.small; if (mesh.parent !== socket) { socket.add(mesh); mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.setScalar(1); } mesh.visible = true; }
          else mesh.visible = false;
        } else {
          if (mesh.parent !== this.scene) { this.scene.add(mesh); mesh.quaternion.identity(); mesh.scale.setScalar(1); }
          const target = item.targetId ? TARGETS.find(t => t.id === item.targetId) : undefined;
          mesh.position.set((target?.position ?? item.position).x, .06, (target?.position ?? item.position).z);
          mesh.visible = true;
          if (item.kind === 'banner' && item.state === 'DELIVERED') { mesh.position.y = 2.7; mesh.scale.setScalar(2); }
          if (item.kind === 'lantern' && item.state === 'DELIVERED') { mesh.position.y = 2.5; mesh.scale.setScalar(1.6); }
        }
      }
    }
    this.highlight.visible = context?.status === 'actionable'; if (context) this.highlight.position.set(context.position.x, .07, context.position.z);
    const destinations = s ? destinationIds(s, localId) : [];
    if (mode === 'title' || mode === 'lobby') {
      const target = new THREE.Vector3(-5, .8, -1); this.camera.position.set(-1, 14.8, 23.5); this.camera.lookAt(target); this.cameraReady = false;
      this.art.update(s, { x: 999, y: 0, z: 999 }, time, this.settings.reducedMotion);
    } else {
      const actor = this.actors.get(localId); const feet = actor?.root.position ?? new THREE.Vector3(local.x, 0, local.z);
      const target = new THREE.Vector3(feet.x, feet.y + 1.22, feet.z);
      if (!this.cameraReady) { this.look.copy(target); this.cameraReady = true; }
      else this.look.copy(target); // actor positions are already smoothed; a lagging pivot can cross walls
      const desired = new THREE.Vector3();
      let safe = 0;
      // Keep horizontal heading/controls stable. A steep, collision-tested overhead
      // view preserves the avatar when backed against a wall, instead of entering it.
      for (const elevation of [pitch, ...[.7, 1, 1.25, 1.45, 1.565].filter(p => p > pitch)]) {
        desired.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(6).add(this.look);
        safe = cameraDistance(this.look, desired, s?.gateOpen ?? false);
        if (safe >= 3) break;
      }
      this.cameraRadius = safe < this.cameraRadius ? safe : THREE.MathUtils.lerp(this.cameraRadius, safe, 1 - Math.exp(-dt * 5));
      this.camera.position.copy(desired).sub(this.look).normalize().multiplyScalar(this.cameraRadius).add(this.look); this.camera.lookAt(this.look);
       this.art.update(s, feet, time, this.settings.reducedMotion, destinations);
    }
    this.renderer.render(this.scene, this.camera);
    const project = (position: Vec3, height: number) => {
      const v = new THREE.Vector3(position.x, position.y + height, position.z).project(this.camera);
      return v.z < 1 && v.z > -1 && Math.abs(v.x) < .95 && Math.abs(v.y) < .92 ? { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight } : null;
    };
    if (mode === 'play') {
      for (const p of players) if (p.connected && p.id !== localId) { const pos = project(this.actors.get(p.id)!.root.position, 2); if (pos) labels.push({ id: p.id, text: `${p.variant + 1} · ${p.name}`, ...pos, type: 'player', variant: p.variant }); }
      for (const item of s?.items ?? []) if (item.state === 'WORLD' && (item.kind !== 'module' || s?.phase === 'power') && Math.hypot(item.position.x - local.x, item.position.z - local.z) < 14) {
        const pos = project(item.position, .8); if (pos) labels.push({ id: item.id, text: item.symbol ? `${symbolIcons[item.symbol]} ${itemNames[item.kind]}` : itemNames[item.kind], ...pos, type: 'item' });
      }
      for (const t of TARGETS) if ((t.phase === s?.phase || t.phase === 'any') && Math.hypot(t.position.x - local.x, t.position.z - local.z) < 17) {
        const completed = !!s && targetCompleted(s, t);
        const pos = project(t.position, 1.05); if (pos) labels.push({ id: t.id, text: `${completed ? '✓ ' : destinations.includes(t.id) ? '◎ Mang đến: ' : ''}${t.label}${completed ? ' · Đã xong' : ''}`, ...pos, type: 'target' });
      }
      for (const ping of s?.pings ?? []) {
        const target = TARGETS.find(t => t.id === ping.targetId) ?? s?.items.find(i => i.id === ping.targetId) ?? s?.players.find(p => p.id === ping.targetId);
        const owner = s?.players.find(p => p.id === ping.playerId); if (!target || !owner) continue;
        const pos = project(target.position, 2.6); if (pos) labels.push({ id: `ping-${ping.id}`, text: `${owner.name}: ${ping.preset in symbolIcons ? symbolIcons[ping.preset as keyof typeof symbolIcons] : ping.preset === 'help' ? 'Cần giúp!' : ping.preset === 'ready' ? 'Sẵn sàng!' : 'Ở đây!'}`, ...pos, type: 'ping', variant: owner.variant });
      }
    }
    return labels;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.resized.disconnect();
    for (const actor of this.actors.values()) actor.dispose(); this.actors.clear();
    // Scene traversal owns the highlight geometry/material too; do not dispose twice.
    this.assets.dispose([this.scene, ...(this.art?.batchedSources ?? [])]);
    this.sun.shadow.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
