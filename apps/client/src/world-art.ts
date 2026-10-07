import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, COLLIDERS, PATHS, TARGETS, targetCompleted, type GameSnapshot, type Vec3 } from '@campus/shared';
import type { Assets } from './assets.js';
const C = { cream: '#f6e7c9', plaster: '#efdab5', clay: '#b95e45', roof: '#ab4b38', teal: '#287c78', dark: '#185b57', gold: '#edb83d', lawn: '#83aa81', path: '#dccbab', blue: '#7bafad', ink: '#28544e' };
export class WorldArt {
  readonly root = new THREE.Group();
  readonly roofs = new Map<string, THREE.Group>();
  readonly targets = new Map<string, THREE.Group>();
  readonly gate = new THREE.Group();
  readonly festival = new THREE.Group();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private planeGeo = new THREE.PlaneGeometry(1, 1);
  private confetti: THREE.InstancedMesh;
  private confettiData: { x: number; y: number; z: number; phase: number }[] = [];
  private lamps: THREE.Mesh[] = [];
  readonly batchedSources: THREE.Object3D[] = [];
  constructor(private assets: Assets) {
    this.root.name = 'Campus architecture / shared campus-1';
    this.ground(); this.architecture(); this.landscape(); this.stage(); this.interactables();
    this.root.add(this.gate, this.festival);
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(.11, .2), this.material(C.gold), 150);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.confetti.frustumCulled = false;
    for (let i = 0; i < 150; i++) { this.confettiData.push({ x: 12 + (i * 1.791 % 10), y: i * .57 % 8, z: -6 + (i * 2.39 % 12), phase: i * 1.71 }); this.confetti.setColorAt(i, new THREE.Color([C.gold, C.clay, C.teal, C.cream][i % 4]!)); }
    this.festival.add(this.confetti); this.festival.visible = false;
    this.batchStatic(this.root, new Set([this.gate, this.festival, ...this.roofs.values(), ...this.targets.values(), ...this.lamps]));
    for (const roof of this.roofs.values()) this.batchStatic(roof, new Set());
  }
  private batchStatic(root: THREE.Group, exclude: Set<THREE.Object3D>) {
    root.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    const visit = (o: THREE.Object3D) => {
      if (exclude.has(o)) return;
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !Array.isArray(o.material) && !('map' in o.material && o.material.map)) {
        const list = groups.get(o.material) ?? []; list.push(o); groups.set(o.material, list);
      }
      for (const child of o.children) visit(child);
    };
    visit(root);
    for (const [material, meshes] of groups) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map(m => {
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const attribute of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(attribute)) geo.deleteAttribute(attribute);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position!.count * 2), 2));
        geo.applyMatrix4(m.matrixWorld); return geo;
      });
      const merged = mergeGeometries(geometries); for (const geo of geometries) geo.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
      for (const m of meshes) { m.removeFromParent(); this.batchedSources.push(m); }
    }
  }
  private material(color: string) { if (!this.mats.has(color)) this.mats.set(color, new THREE.MeshStandardMaterial({ color, roughness: .88 })); return this.mats.get(color)!; }
  private box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, parent: THREE.Object3D = this.root) {
    const mesh = new THREE.Mesh(this.boxGeo, this.material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private floor(x: number, z: number, w: number, d: number, color: string, y = .012) {
    const m = new THREE.Mesh(this.planeGeo, this.material(color)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.set(w, d, 1); m.receiveShadow = true; this.root.add(m); return m;
  }
  label(text: string, width: number, height: number, bg = C.dark, fg = C.cream) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.round(1024 * height / width);
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${Math.min(canvas.height * .46, 1024 / (text.length * .55))}px "Be Vietnam Pro"`;
    ctx.fillText(text, 512, canvas.height / 2 + 2, 950);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })); return mesh;
  }
  private sign(text: string, x: number, y: number, z: number, w: number, h: number, yaw = 0, bg = C.dark, parent: THREE.Object3D = this.root) {
    const m = this.label(text, w, h, bg); m.position.set(x, y, z); m.rotation.y = yaw; parent.add(m); return m;
  }
  private ground() {
    this.floor(0, 0, 160, 160, '#b7c2a0', -.035); this.floor(0, 0, 48, 36, C.lawn, 0);
    this.floor(-6, 0, 11.6, 8.3, '#d4c09b'); this.floor(13, 0, 21, 15, '#d4c09b');
    for (const path of PATHS) for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!, b = path.points[i]!;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      this.floor(x, z, Math.abs(b.x - a.x) + path.width + .3, Math.abs(b.z - a.z) + path.width + .3, C.clay, .015);
      this.floor(x, z, Math.abs(b.x - a.x) + path.width, Math.abs(b.z - a.z) + path.width, C.path, .019);
    }
    this.floor(0, 12.8, 47.6, 6, '#c9b695', .012);
    // Fine paver joints are surface markings, never raised steps.
    const tiles = new THREE.InstancedMesh(this.planeGeo, this.material('#c1aa86'), 400);
    const dummy = new THREE.Object3D(); let index = 0;
    for (let x = -23; x <= 23; x += 1.2) for (const z of [10.2, 11.4, 12.6, 13.8, 15]) {
      dummy.position.set(x, .025, z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(.018, 1.14, 1); dummy.updateMatrix(); tiles.setMatrixAt(index++, dummy.matrix);
    }
    tiles.count = index; this.root.add(tiles);
    for (const z of [9.8, 15.6]) this.floor(0, z, 47.5, .07, C.cream, .026);
    // Courtyard compass medallion.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 64), this.material(C.clay)); disc.rotation.x = -Math.PI / 2; disc.position.set(-6, .024, 0); this.root.add(disc);
    const medallion = this.label('HẸN NHAU Ở SÂN TRƯỜNG', 2.1, .44, C.clay); medallion.rotation.x = -Math.PI / 2; medallion.position.set(-6, .029, 0); this.root.add(medallion);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; this.floor(-6 + Math.sin(a) * 1.35, Math.cos(a) * 1.35, .1, .1, C.cream, .025); }
  }
  private architecture() {
    for (const c of COLLIDERS) {
      const parent = c.role === 'gate' ? this.gate : this.root;
      // The entire solid volume is present, not merely a decorative shell.
      const color = c.role === 'planter' ? C.teal : c.role === 'gate' ? C.dark : c.id.startsWith('divider') ? C.teal : C.cream;
      const wall = this.box(c.center.x, c.center.y, c.center.z, c.half.x * 2, c.half.y * 2, c.half.z * 2, color, parent); wall.name = `collider:${c.id}`;
      if (c.role === 'gate') {
        for (let z = -1.3; z < 1.5; z += .4) this.box(.185, 1, z, .015, 1.75, .06, C.gold, parent);
        this.sign('LỐI TẮT', .197, 1.7, 0, 1.55, .24, Math.PI / 2, C.dark, parent); continue;
      }
      const alongX = c.half.x > c.half.z;
      this.box(c.center.x, .25, c.center.z, c.half.x * 2 + .015, .5, c.half.z * 2 + .015, c.role === 'planter' ? C.dark : C.clay);
      this.box(c.center.x, c.half.y * 2 - .07, c.center.z, c.half.x * 2 + .025, .14, c.half.z * 2 + .025, c.role === 'planter' ? C.cream : C.clay);
      if (c.role === 'planter') continue;
      const length = alongX ? c.half.x * 2 : c.half.z * 2;
      // Window murals and muntins are flush with the authoritative wall face.
      if (!c.id.startsWith('divider')) for (let p = -length / 2 + 1; p < length / 2 - .5; p += 2.25) {
        for (const side of [-1, 1]) {
          const x = c.center.x + (alongX ? p : side * (c.half.x + .009));
          const z = c.center.z + (alongX ? side * (c.half.z + .009) : p);
          this.box(x, 1.75, z, alongX ? 1.23 : .014, 1.55, alongX ? .014 : 1.23, C.dark);
          this.box(x + (alongX ? 0 : side * .009), 1.78, z + (alongX ? side * .009 : 0), alongX ? 1.08 : .012, 1.32, alongX ? .012 : 1.08, C.blue);
          this.box(x + (alongX ? 0 : side * .018), 1.78, z + (alongX ? side * .018 : 0), alongX ? .055 : .013, 1.34, alongX ? .013 : .055, C.cream);
          this.box(x + (alongX ? 0 : side * .02), 1.72, z + (alongX ? side * .02 : 0), alongX ? 1.12 : .014, .055, alongX ? .014 : 1.12, C.cream);
        }
      }
      if (c.id.startsWith('divider')) {
        for (let z = c.center.z - c.half.z + .4; z < c.center.z + c.half.z; z += .7) this.box(-.19, 2.65, z, .012, .4, .045, C.gold);
      }
    }
    for (const b of BUILDINGS) {
      this.floor(b.center.x, b.center.z, b.size.x, b.size.z, b.id === 'classroom' ? '#ddbe89' : '#dcccb1', .032);
      for (let x = b.center.x - b.size.x / 2 + .5; x < b.center.x + b.size.x / 2; x += 1) this.floor(x, b.center.z, .014, b.size.z - .3, '#c3a879', .034);
      const roof = new THREE.Group(); roof.name = `cutaway:${b.id}`; this.roofs.set(b.id, roof); this.root.add(roof);
      this.box(b.center.x, 3.15, b.center.z, b.size.x + .65, .24, b.size.z + .65, C.cream, roof);
      for (const side of [-1, 1]) {
        const m = this.box(b.center.x, 3.78, b.center.z + side * b.size.z / 4, b.size.x + .9, .16, b.size.z / 2 + .65, C.roof, roof); m.rotation.x = side * .18;
        for (let x = b.center.x - b.size.x / 2 - .2; x < b.center.x + b.size.x / 2 + .4; x += .38) {
          const tile = this.box(x, 3.86, b.center.z + side * b.size.z / 4, .075, .08, b.size.z / 2 + .65, '#bf684b', roof); tile.rotation.x = side * .18;
        }
      }
      this.box(b.center.x, 4.13, b.center.z, b.size.x + 1, .18, .3, C.clay, roof);
      for (const door of b.doors) {
        const alongX = door.axis === 'x';
        this.box(door.center.x, 2.95, door.center.z, alongX ? door.width : .38, .12, alongX ? .38 : door.width, C.dark);
        this.sign(b.label, door.center.x + (alongX ? 0 : .215), 2.59, door.center.z + (alongX ? .215 : 0), Math.min(door.width - .25, 3.1), .38, alongX ? 0 : Math.PI / 2);
      }
    }
    this.sign('Lớp học sáng tạo', -4, 2.63, -14.78, 4, .42);
    this.sign('CÙNG NHAU, MÌNH LÀM ĐƯỢC', -4, 1.85, -14.765, 4.7, .9, 0, C.teal);
    this.sign('Đọc gợi ý ở đây • E', -5, .85, -14.76, 3, .36, 0, C.clay);
    this.sign('Kho lễ hội', -19.77, 2.52, 0, 3.1, .5, Math.PI / 2);
    // Storage shelf illustrations at the wall, with original graphic inventory labels.
    for (let i = 0; i < 4; i++) {
      this.sign(['Dây điện', 'Trang trí', 'Ánh sáng', 'Băng rôn'][i]!, -19.765, 1.2, -3.2 + i * 2.1, 1.6, 1.1, Math.PI / 2, i % 2 ? C.clay : C.teal);
    }
    this.sign('Hành lang kết nối', 4.5, 2.55, -14.77, 4.3, .43);
    for (let i = 0; i < 3; i++) this.sign(['Cùng chuẩn bị', 'Cùng giải mã', 'Cùng thắp sáng'][i]!, 2 + i * 2.35, 1.65, -14.765, 1.75, 1.05, 0, [C.clay, C.teal, '#ae822d'][i]!);
    this.sign('Lối vòng sân khấu  ›', 0, 2.4, 18 - .005, 6, .7, Math.PI, C.teal);
    this.sign('Campus Together', -10, 2.4, 18 - .01, 6, .7, Math.PI, C.clay);
  }
  private landscape() {
    for (const c of COLLIDERS.filter(c => c.role === 'planter')) {
      this.box(c.center.x, .7, c.center.z, c.half.x * 1.84, .035, c.half.z * 1.8, '#6f6343');
      const tree = this.assets.prop('tree-round'); tree.position.set(c.center.x, .72, c.center.z); tree.scale.setScalar(.85); this.root.add(tree);
      for (const side of [-1, 1]) { const flowers = this.assets.prop('flower-pot'); flowers.position.set(c.center.x + side * .83, .72, c.center.z + .23); flowers.scale.setScalar(.55); this.root.add(flowers); }
    }
    // Background trees and furniture stay outside the traversable world or on colliders.
    for (let i = 0; i < 26; i++) {
      const tree = this.assets.prop(i % 3 ? 'tree-round' : 'tree-slender');
      const side = i % 4; const p = -23 + Math.floor(i / 4) * 7.7;
      tree.position.set(side < 2 ? p : side === 2 ? -26.5 : 26.5, 0, side < 2 ? side === 0 ? -21.5 : 21.5 : p * .75);
      tree.rotation.y = i * 1.79; tree.scale.setScalar(1.1 + i % 3 * .15); this.root.add(tree);
    }
    for (const x of [-18, -8, 5, 16]) { const bench = this.assets.prop('bench'); bench.position.set(x, 0, 20); bench.rotation.y = Math.PI; this.root.add(bench); }
    for (let x = -20; x < 23; x += 3) { const bunting = this.assets.prop('bunting'); bunting.position.set(x, 1.4, 14.8); this.root.add(bunting); }
    // Embedded path guide inlays.
    for (const [text, x, z] of [['Kho dụng cụ  ‹', -9, 3.5], ['Lớp học  ↑', -4, -5.9], ['Sân khấu  ›', 8, 10]] as const) {
      const sign = this.label(text, 2.8, .5, C.path, C.dark); sign.rotation.x = -Math.PI / 2; sign.position.set(x, .04, z); this.root.add(sign);
    }
    const globeMaterial = new THREE.MeshStandardMaterial({ color: C.cream, emissive: C.gold, emissiveIntensity: .4 });
    const globeGeometry = new THREE.SphereGeometry(.17, 12, 8);
    for (let x = -21; x <= 21; x += 7) {
      this.box(x, 3.65, 18.3, .12, 1.3, .12, C.dark);
      const globe = new THREE.Mesh(globeGeometry, globeMaterial); globe.position.set(x, 4.3, 18.3); this.root.add(globe);
    }
  }
  private stage() {
    this.floor(17, -.5, 10, 11.5, C.teal, .04);
    this.floor(17, -.5, 9.4, 10.9, '#d7bc8d', .041);
    this.floor(17, -.5, 8.95, 10.45, '#bf7957', .042);
    for (let x = 12.7; x < 21.7; x += .42) this.floor(x, -.5, .018, 10.4, '#995e49', .044);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), this.material(C.cream)); rug.rotation.x = -Math.PI / 2; rug.position.set(17, .045, .1); this.root.add(rug);
    const seal = this.label('MÙA HẸN • LỄ HỘI SÂN TRƯỜNG', 4, .6, C.cream, C.teal); seal.rotation.x = -Math.PI / 2; seal.position.set(17, .047, .1); this.root.add(seal);
    // Backdrop mounted onto the east boundary. Nothing blocks the stage floor.
    this.sign('Mùa hẹn', 23.98, 2.15, 0, 8, 1.25, -Math.PI / 2, C.clay);
    this.sign('MỘT SÂN TRƯỜNG • NHIỀU NGƯỜI BẠN', 23.97, .92, 0, 8, .5, -Math.PI / 2, C.teal);
    const lampMaterial = new THREE.MeshStandardMaterial({ color: C.gold, emissive: '#ffb944', emissiveIntensity: .25 });
    const lampGeometry = new THREE.SphereGeometry(.19, 12, 8);
    for (let z = -7; z <= 7; z += 2) {
      this.box(24.3, 4.2, z, .15, 2.4, .15, C.dark);
      const light = new THREE.Mesh(lampGeometry, lampMaterial); light.position.set(24, 4, z); this.root.add(light); this.lamps.push(light);
    }
    for (const z of [-6.8, 6.8]) for (let x = 12; x < 24; x += 3) { const b = this.assets.prop('bunting'); b.position.set(x + 1.5, 2.3, z); this.root.add(b); }
    for (let z = -6; z <= 6; z += 3) { const b = this.assets.prop('bunting'); b.position.set(12, 2.3, z); b.rotation.y = Math.PI / 2; this.root.add(b); }
    this.sign('Chúng mình làm được rồi!', 23.96, 3.05, 0, 7, .55, -Math.PI / 2, C.dark, this.festival);
  }
  private interactables() {
    for (const t of TARGETS) {
      const group = new THREE.Group(); group.name = t.id; group.position.set(t.position.x, 0, t.position.z); this.root.add(group); this.targets.set(t.id, group);
      const ring = new THREE.Mesh(new THREE.RingGeometry(.43, .51, 48), new THREE.MeshBasicMaterial({ color: t.phase === 'any' ? C.gold : C.teal, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = .055; group.add(ring);
      const icon = this.label(t.kind === 'module' ? `${(t.slot ?? 0) + 1}` : t.kind === 'station' ? t.id === 'station-a' ? 'A' : 'B' : t.kind === 'gate' ? 'E' : t.kind === 'clue' ? '?' : '+', .48, .48, C.cream, C.teal); icon.rotation.x = -Math.PI / 2; icon.position.y = .057; group.add(icon);
      // Target art remains small/nonblocking per shared contract.
      if (t.kind === 'station' || t.kind === 'gate') { const prop = this.assets.prop('station'); prop.scale.setScalar(.42); prop.position.y = .02; group.add(prop); }
      if (t.kind === 'module') this.box(t.position.x, .04, t.position.z, .6, .04, .6, C.dark);
    }
  }
  update(s: GameSnapshot | null, local: Vec3, time: number, reduced: boolean, destinations: string[] = []) {
    this.gate.visible = !s?.gateOpen;
    for (const b of BUILDINGS) {
      const near = Math.abs(local.x - b.center.x) < b.size.x / 2 + 2 && Math.abs(local.z - b.center.z) < b.size.z / 2 + 2;
      this.roofs.get(b.id)!.visible = !near;
    }
    const success = s?.result === 'success'; this.festival.visible = success;
    for (const lamp of this.lamps) (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = success ? 2.5 : .25;
    for (const [id, object] of this.targets) {
      const target = TARGETS.find(t => t.id === id)!; const filled = !!s && targetCompleted(s, target);
      const ring = object.children[0] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
      const destination = destinations.includes(id);
      ring.material.color.set(destination ? C.gold : filled ? '#486d60' : target.phase === 'any' || target.phase === s?.phase ? C.teal : '#978e73');
      ring.scale.setScalar(destination ? 1.65 : filled ? .8 : 1);
      object.visible = !s || s.phase !== 'results';
    }
    if (success) {
      const dummy = new THREE.Object3D();
      this.confettiData.forEach((p, i) => { dummy.position.set(p.x + (reduced ? 0 : Math.sin(time + p.phase) * .3), reduced ? p.y : 8 - ((p.y + time * .7) % 8), p.z); dummy.rotation.set(p.phase + (reduced ? 0 : time), p.phase, p.phase); dummy.updateMatrix(); this.confetti.setMatrixAt(i, dummy.matrix); }); this.confetti.instanceMatrix.needsUpdate = true;
    }
  }
}
