import { describe, expect, it } from 'vitest';
import { player, snapshot } from './fixtures.js';
import { contextAction, deriveLobby, normalizeSettings, parseInvite, endpointFor, HoldRepeater, SessionEpoch, cameraInput, missionView, destinationIds, FirstUseTips } from '../../apps/client/src/model.js';
describe('authoritative UI view', () => {
  it('blocks two ready connected players when a third reserved seat is disconnected, explains why', () => {
    const s = snapshot({ phase: 'lobby', players: [player({ ready: true }), player({ id: 'b', ready: true }), player({ id: 'c', ready: true, connected: false })] });
    expect(deriveLobby(s, 'me').canStart).toBe(false);
    expect(deriveLobby(s, 'me').reason).toContain('giữ chỗ');
  });
  it('Solo ready lobby and sequential launch view use the actual room mode', () => {
    const s = snapshot({ mode: 'solo', phase: 'lobby', players: [player({ ready: true })] });
    expect(deriveLobby(s, 'me').canStart).toBe(true);
    s.phase = 'launch'; s.launchProgressMs = 1500;
    expect(missionView(s).progress).toBe(.25); expect(missionView(s).detail).toContain('trạm A');
    s.stationAComplete = true;
    expect(missionView(s).progress).toBe(.75); expect(missionView(s).detail).toContain('trạm B');
  });
  it('requires two connected ready people, not reserved seats', () => {
    const s = snapshot({ phase: 'lobby', players: [player({ ready: true }), player({ id: 'b', connected: false, ready: true })] });
    expect(deriveLobby(s, 'me').canStart).toBe(false);
    s.players[1]!.connected = true;
    expect(deriveLobby(s, 'me').canStart).toBe(true);
    expect(deriveLobby(s, 'b').canStart).toBe(false);
  });
  it('context uses authoritative item revision and respects LOS/reach', () => {
    const s = snapshot();
    expect(contextAction(s, 'me', () => true)?.intent).toEqual({ type: 'pickup', itemId: 'crate-a', expectedRevision: 0 });
    expect(contextAction(s, 'me', () => false)).toBeNull();
    s.players[0]!.position = { x: -10, y: 0, z: -2 };
    expect(contextAction(s, 'me', () => true)).toBeNull();
  });
  it('places instead of picking up with full hands and never offers occupied sockets', () => {
    const s = snapshot(); s.players[0]!.heldItemId = 'crate-a'; s.players[0]!.position = { x: 13, y: 0, z: -3 };
    s.items[0]!.state = 'CARRIED'; s.items[0]!.holderId = 'me'; s.items[0]!.revision = 4;
    expect(contextAction(s, 'me', () => true)?.intent).toEqual({ type: 'place', itemId: 'crate-a', expectedRevision: 4, targetId: 'decor-a' });
    s.targets.find(t => t.id === 'decor-a')!.itemId = 'crate-b';
    expect(contextAction(s, 'me', () => true)).toMatchObject({ status: 'completed', intent: null });
  });
  it('shows private clue interaction only in power, modules only in power', () => {
    const s = snapshot(); s.players[0]!.position = { x: -7, y: 0, z: -12 };
    expect(contextAction(s, 'me', () => true)).toBeNull();
    s.phase = 'power'; expect(contextAction(s, 'me', () => true)?.intent?.type).toBe('pickup');
    s.players[0]!.position = { x: -5, y: 0, z: -13 };
    expect(contextAction(s, 'me', () => true)?.intent?.type).toBe('read-clue');
    expect(missionView(s).detail).not.toContain('sun');
  });
  it('no interactions in results or for disconnected identity', () => {
    expect(contextAction(snapshot({ phase: 'results' }), 'me', () => true)).toBeNull();
    expect(contextAction(snapshot({ players: [player({ connected: false })] }), 'me', () => true)).toBeNull();
  });
});
describe('discoverable guidance without hidden solutions', () => {
  it('only compatible unfinished destinations highlight, including the current module slot without guessing symbols', () => {
    const s = snapshot(); s.players[0]!.heldItemId = 'crate-a';
    expect(destinationIds(s, 'me')).toEqual(['decor-a', 'decor-b']);
    s.targets.find(t => t.id === 'decor-a')!.itemId = 'crate-b';
    expect(destinationIds(s, 'me')).toEqual(['decor-b']);
    s.phase = 'power'; expect(destinationIds(s, 'me')).toEqual([]);
    s.players[0]!.heldItemId = 'module-wave'; s.powerStep = 1;
    expect(destinationIds(s, 'me')).toEqual(['power-1']);
    s.targets.find(t => t.id === 'power-1')!.itemId = 'module-sun'; expect(destinationIds(s, 'me')).toEqual([]);
    s.players[0]!.heldItemId = 'banner'; expect(destinationIds(s, 'me')).toEqual(['banner-socket']);
    s.phase = 'results'; expect(destinationIds(s, 'me')).toEqual([]);
  });
  it('first-use tips teach pickup, drop and gate once, retain discovery through pause, and reset per session', () => {
    const tips = new FirstUseTips(), s = snapshot();
    const pickup = contextAction(s, 'me', () => true);
    expect(tips.next(s, 'me', pickup)).toContain('E'); expect(tips.next(s, 'me', pickup)).toBeNull();
    s.players[0]!.heldItemId = 'crate-a'; expect(tips.next(s, 'me', null)).toContain('G');
    expect(tips.next(s, 'me', null)).toBeNull();
    s.players[0]!.position = { x: -1.3, y: 0, z: 2.7 };
    s.mode = 'solo'; expect(tips.next(s, 'me', contextAction(s, 'me', () => true))).toContain('15 giây');
    expect(tips.next(s, 'me', contextAction(s, 'me', () => true))).toBeNull();
    tips.reset(); expect(tips.next(s, 'me', null)).toContain('G');
  });
});
describe('input and lifecycle', () => {
  it('camera-relative movement is normalized and points away from camera', () => {
    expect(cameraInput(new Set(['KeyW']), 0).z).toBe(-1);
    expect(cameraInput(new Set(['KeyW']), Math.PI / 2).x).toBeCloseTo(-1);
    const i = cameraInput(new Set(['KeyW', 'KeyD']), 0); expect(Math.hypot(i.x, i.z)).toBeCloseTo(1);
  });
  it('E hold heartbeats every 120ms and releases on target change/clear', () => {
    const h = new HoldRepeater();
    expect(h.update('gate-switch', true, 0)).toEqual([{ type: 'hold', targetId: 'gate-switch', active: true }]);
    expect(h.update('gate-switch', true, 100)).toEqual([]);
    expect(h.update('gate-switch', true, 120)).toHaveLength(1);
    expect(h.update('station-a', true, 140)).toEqual([{ type: 'hold', targetId: 'gate-switch', active: false }, { type: 'hold', targetId: 'station-a', active: true }]);
    expect(h.update(null, false, 150)).toEqual([{ type: 'hold', targetId: 'station-a', active: false }]);
    expect(h.update(null, false, 160)).toEqual([]);
  });
  it('cancelled async session cannot take ownership after a new session', () => {
    const e = new SessionEpoch(); const first = e.begin(); e.cancel(); const next = e.begin();
    expect(e.current(first)).toBe(false); expect(e.current(next)).toBe(true);
  });
  it('validates invites and settings without trusting storage', () => {
    expect(parseInvite('?room=abcdefgh')).toBe('ABCDEFGH'); expect(parseInvite('?room=<script>')).toBe('');
    expect(normalizeSettings({ music: 5, effects: -2, sensitivity: 'bad', quality: 'ultra' })).toEqual({ music: 1, effects: 0, sensitivity: 1, quality: 'high', reducedMotion: false });
  });
  it('production uses same-origin secure endpoint; configurable URL is respected', () => {
    expect(endpointFor('https://campus.example/')).toBe('wss://campus.example');
    expect(endpointFor('http://localhost:5173', 'http://localhost:2567')).toBe('ws://localhost:2567');
  });
});
