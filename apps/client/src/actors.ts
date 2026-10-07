import * as THREE from 'three';
import type { ItemSnapshot, PlayerSnapshot } from '@campus/shared';
import type { Assets } from './assets.js';
export class Actor {
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly sockets: { large: THREE.Object3D; small: THREE.Object3D };
  readonly actions = new Map<string, THREE.AnimationAction>();
  speed = 0;
  private current = '';
  private shotUntil = 0;
  private time = 0;
  private previous = new THREE.Vector3();
  private initialized = false;
  private held: string | null = null;
  private owned: THREE.Object3D;
  constructor(assets: Assets, variant: number) {
    const { object, clips } = assets.student(variant); this.owned = object; this.root.add(object);
    this.mixer = new THREE.AnimationMixer(object);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip); const def = assets.manifest.animations[clip.name]!;
      action.setLoop(def.loop ? THREE.LoopRepeat : THREE.LoopOnce, def.loop ? Infinity : 1); action.clampWhenFinished = !def.loop;
      this.actions.set(clip.name, action);
    }
    this.sockets = { large: object.getObjectByName(assets.manifest.sockets.large)!, small: object.getObjectByName(assets.manifest.sockets.small)! };
  }
  private play(name: string, speed = 1) {
    const next = this.actions.get(name)!;
    if (name !== this.current) {
      const old = this.actions.get(this.current); const phase = old && this.current.toLowerCase().includes('walk') && name.toLowerCase().includes('walk') ? old.time / old.getClip().duration : 0;
      next.reset(); next.time = phase * next.getClip().duration; next.setEffectiveWeight(1).setEffectiveTimeScale(speed).play();
      if (old) next.crossFadeFrom(old, .16, false); this.current = name;
    }
    next.setEffectiveTimeScale(speed);
  }
  update(p: PlayerSnapshot, item: ItemSnapshot | undefined, dt: number, success: boolean, teleport = false) {
    this.time += dt;
    const position = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
    if (!this.initialized || teleport || this.root.position.distanceTo(position) > 3) { this.root.position.copy(position); this.previous.copy(position); this.initialized = true; this.speed = 0; }
    else this.root.position.lerp(position, 1 - Math.exp(-dt * 22));
    const instant = this.root.position.distanceTo(this.previous) / Math.max(.001, dt); this.previous.copy(this.root.position);
    this.speed = THREE.MathUtils.lerp(this.speed, Math.min(instant, 6), 1 - Math.exp(-dt * 14));
    this.root.rotation.y += Math.atan2(Math.sin(p.facing - this.root.rotation.y), Math.cos(p.facing - this.root.rotation.y)) * (1 - Math.exp(-dt * 20));
    if (this.held !== p.heldItemId) {
      if (p.heldItemId) { this.play('pickup'); this.shotUntil = this.time + .85; }
      else if (this.held) { this.play('drop'); this.shotUntil = this.time + .8; }
      this.held = p.heldItemId;
    }
    if (success) this.play('celebrate');
    else if (this.time >= this.shotUntil) {
      const moving = this.speed > .15;
      if (item) {
        const big = item.kind === 'crate'; const name = moving ? big ? 'carryWalk' : 'carrySmallWalk' : big ? 'carryIdle' : 'carrySmallIdle';
        this.play(name, moving ? Math.max(.15, this.speed / (big ? 1.3 : 1.5)) : 1);
      } else if (p.holdTarget) this.play('interact');
      else if (moving) this.play(p.sprinting ? 'run' : 'walk', Math.max(.15, this.speed / (p.sprinting ? 3.1 : 1.5)));
      else this.play('idle');
    }
    this.mixer.update(dt); this.root.visible = p.connected;
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.owned); this.owned.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); }); this.root.removeFromParent(); }
}
