import type { ItemKind, SymbolId, Vec3 } from './protocol.js';

export const WORLD_VERSION = 'campus-1';
export const WORLD_BOUNDS = { minX: -24, maxX: 24, minZ: -18, maxZ: 18 } as const;
export const PALETTE = { cream: '#f6e7c9', terracotta: '#b95e45', teal: '#287c78', marigold: '#edb83d', path: '#d8bf95' } as const;
export const point = (x: number, z: number): Vec3 => ({ x, y: 0, z });
export interface BoxCollider { id: string; center: Vec3; half: Vec3; role: 'wall' | 'boundary' | 'planter' | 'gate' }
const box = (id: string, x: number, z: number, hx: number, hz: number, role: BoxCollider['role'] = 'wall', height = 3): BoxCollider => ({ id, center: { x, y: height / 2, z }, half: { x: hx, y: height / 2, z: hz }, role });
export const COLLIDERS: readonly BoxCollider[] = [
  box('boundary-n', 0, -18.3, 24.3, .3, 'boundary'), box('boundary-s', 0, 18.3, 24.3, .3, 'boundary'),
  box('boundary-w', -24.3, 0, .3, 18.3, 'boundary'), box('boundary-e', 24.3, 0, .3, 18.3, 'boundary'),
  box('storage-w', -20, 0, .2, 5), box('storage-n', -16, -5, 4, .2), box('storage-s', -16, 5, 4, .2),
  box('storage-e-n', -12, -3.25, .2, 1.75), box('storage-e-s', -12, 3.25, .2, 1.75),
  box('class-w', -9, -11.5, .2, 3.5), box('class-n', -4, -15, 5, .2),
  box('class-s-w', -7.25, -8, 1.75, .2), box('class-s-e', -.75, -8, 1.75, .2),
  box('class-e-n', 1, -13.75, .2, 1.25), box('class-e-s', 1, -9.25, .2, 1.25),
  box('corridor-n', 4.5, -15, 3.5, .2), box('corridor-s', 4.5, -8, 3.5, .2),
  box('divider-n', 0, -4.75, .18, 3.25), box('divider-s', 0, 4.75, .18, 3.25),
  box('shortcut-gate', 0, 0, .18, 1.5, 'gate', 2),
  box('courtyard-planter', -6, 5.5, 1.2, .8, 'planter', .7),
  box('east-planter', 8, 5.5, 1.2, .8, 'planter', .7),
];
export const BUILDINGS = [
  { id: 'storage', label: 'Kho dụng cụ', center: point(-16, 0), size: { x: 8, z: 10 }, height: 3.4, doors: [{ center: point(-12, 0), width: 3, axis: 'z' }] },
  { id: 'classroom', label: 'Lớp học', center: point(-4, -11.5), size: { x: 10, z: 7 }, height: 3.4, doors: [{ center: point(-4, -8), width: 3, axis: 'x' }, { center: point(1, -11.5), width: 2, axis: 'z' }] },
  { id: 'corridor', label: 'Hành lang', center: point(4.5, -11.5), size: { x: 7, z: 7 }, height: 3.4, doors: [{ center: point(8, -11.5), width: 7, axis: 'z' }] },
] as const;
export const AREAS = [
  { id: 'courtyard', label: 'Sân trường', center: point(-6, 0) },
  { id: 'street', label: 'Đường lễ hội', center: point(0, 11) },
  { id: 'stage', label: 'Sân khấu', center: point(16, 0) },
];
export const PATHS = [
  { id: 'shortcut', points: [point(-12, 0), point(16, 0)], width: 3 },
  { id: 'south-route', points: [point(-10, 0), point(-10, 10), point(14, 10), point(14, 0)], width: 3 },
  { id: 'class-entry', points: [point(-4, 0), point(-4, -11.5), point(10, -11.5), point(10, 0)], width: 3 },
] as const;
export const SPAWNS = [point(-8, 0), point(-8, 1), point(-8, -1), point(-9, 0)] as const;
export interface TargetDefinition { id: string; label: string; position: Vec3; kind: ItemKind | 'clue' | 'gate' | 'station'; phase: 'supply' | 'power' | 'launch' | 'any'; slot?: number }
export const TARGETS: readonly TargetDefinition[] = [
  { id: 'decor-a', label: 'Trang trí trái', position: point(13, -3), kind: 'crate', phase: 'supply' },
  { id: 'decor-b', label: 'Trang trí phải', position: point(13, 3), kind: 'crate', phase: 'supply' },
  { id: 'cable-socket', label: 'Dây điện', position: point(15, -3), kind: 'cable', phase: 'supply' },
  { id: 'fuse-socket', label: 'Cầu chì', position: point(17, -3), kind: 'fuse', phase: 'supply' },
  ...[0, 1, 2].map(slot => ({ id: `power-${slot}`, label: `Ô nguồn ${slot + 1}`, position: point(15 + slot * 1.5, -5.5), kind: 'module' as const, phase: 'power' as const, slot })),
  { id: 'banner-socket', label: 'Băng rôn', position: point(19, 3), kind: 'banner', phase: 'any' },
  { id: 'lantern-socket', label: 'Đèn lồng', position: point(19, -1), kind: 'lantern', phase: 'any' },
  { id: 'clue-board', label: 'Gợi ý thứ tự', position: point(-5, -13), kind: 'clue', phase: 'power' },
  { id: 'gate-switch', label: 'Giữ mở cổng', position: point(-1.3, 2.7), kind: 'gate', phase: 'any' },
  { id: 'station-a', label: 'Trạm khởi động trái', position: point(15, 1), kind: 'station', phase: 'launch' },
  { id: 'station-b', label: 'Trạm khởi động phải', position: point(19, 1), kind: 'station', phase: 'launch' },
];
export interface ItemDefinition { id: string; kind: ItemKind; symbol: SymbolId | null; position: Vec3 }
const itemKinds: readonly [string, ItemKind, SymbolId | null][] = [
  ['crate-a', 'crate', null], ['crate-b', 'crate', null], ['cable', 'cable', null], ['fuse', 'fuse', null],
  ['module-sun', 'module', 'sun'], ['module-leaf', 'module', 'leaf'], ['module-wave', 'module', 'wave'],
  ['banner', 'banner', null], ['lantern', 'lantern', null],
];
const layouts: readonly (readonly Vec3[])[] = [
  [point(-14, -2), point(-17, 2), point(-14, 3), point(-4, -10), point(-7, -12), point(5, -12), point(-18, -3), point(-6, 9), point(10, 9)],
  [point(-17, -2), point(-14, 2), point(-7, -10), point(-18, 3), point(5, -10), point(-15, -3), point(-6, -13), point(-10, 12), point(12, 12)],
  [point(-15, -3), point(-18, 1), point(5, -13), point(-14, 3), point(-16, 2), point(-7, -11), point(6, -10), point(-5, 11), point(10, 12)],
];
export const ITEM_LAYOUTS: readonly (readonly ItemDefinition[])[] = layouts.map(positions => itemKinds.map(([id, kind, symbol], i) => ({ id, kind, symbol, position: positions[i]! })));
export const CLUE_ORDERS: readonly (readonly SymbolId[])[] = [['sun', 'leaf', 'wave'], ['leaf', 'wave', 'sun'], ['wave', 'sun', 'leaf']];
export const RECOVERY_POINTS = [point(-10, 0), point(-10, 8), point(5, 10), point(12, 0), point(-4, -10), point(5, -11)] as const;
