import { expect, it } from 'vitest';
import { ServerOperations, readLimits, validateLimits, type Limits } from '../../apps/server/src/operations.js';

it('canonical peers share six tokens, refill one per ten seconds; identities expire and never bypass saturation', () => {
  let now = 0; const ops = new ServerOperations(readLimits({}), () => now);
  for (let i = 0; i < 6; i++) ops.admit('::ffff:127.0.0.1');
  expect(() => ops.admit('127.0.0.1')).toThrow(/thử lại/);
  now = 9999; expect(() => ops.admit('127.0.0.1')).toThrow();
  now = 10000; ops.admit('127.0.0.1');
  for (let i = 1; i < 4096; i++) ops.admit(`10.0.${Math.floor(i / 256)}.${i % 256}`);
  expect(ops.identityCount).toBe(4096);
  expect(() => ops.admit('192.0.2.1')).toThrow();
  expect(() => ops.reserve()).toThrow(); // no transport-owned identity, fail closed
  now += 600000; ops.admit('192.0.2.1');
  expect(ops.identityCount).toBe(1);
});

it('IPv6 zone identifiers normalize without throwing or opening separate buckets', () => {
  const ops = new ServerOperations();
  for (let i = 0; i < 6; i++) ops.admit('fe80::1%eth0');
  expect(() => ops.admit('FE80:0:0:0:0:0:0:1%2')).toThrow(/thử lại/);
  for (let i = 0; i < 6; i++) ops.admit('::ffff:127.0.0.1%eth0');
  expect(() => ops.admit('127.0.0.1')).toThrow(/thử lại/);
  expect(ops.identityCount).toBe(2);
  for (const ip of ['fe80::1%', 'fe80::1%a%b', '127.0.0.1%eth0', 'not-an-ip']) expect(() => ops.admit(ip)).toThrow(/thử lại/);
  expect(ops.identityCount).toBe(2);
});

it('runtime limit validation requires exactly all five known finite integer keys', () => {
  const valid = readLimits({});
  for (const key of Object.keys(valid)) {
    const missing = { ...valid } as Record<string, unknown>; delete missing[key];
    expect(() => validateLimits(missing as unknown as Limits)).toThrow();
    for (const value of [undefined, NaN, Infinity, 0, -1, 1.5, '6']) expect(() => validateLimits({ ...valid, [key]: value } as Limits)).toThrow();
  }
  expect(() => validateLimits({ ...valid, unknown: 1 } as Limits)).toThrow();
  const hiddenInvalid = Object.defineProperty({ ...valid }, 'maxRooms', { value: NaN, enumerable: false });
  expect(() => validateLimits(hiddenInvalid)).toThrow();
});

it('inherited async contexts cannot reuse a creation grant', async () => {
  const ops = new ServerOperations();
  await ops.allocation('127.0.0.1', async () => {
    ops.reserve().release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(() => ops.reserve()).toThrow();
  });
});

it('capacity includes initializing rooms, release is idempotent and draining refuses new rooms', async () => {
  const ops = new ServerOperations({ ...readLimits({}), maxRooms: 2 }); ops.started();
  const reserve = () => ops.allocation('127.0.0.1', async () => ops.reserve());
  const a = await reserve(), b = await reserve(); await expect(reserve()).rejects.toThrow();
  a.release(); a.release(); const c = await reserve(); expect(ops.readiness().rooms).toBe(2);
  ops.drain(); expect(ops.readiness().status).toBe('draining'); await expect(reserve()).rejects.toThrow();
  b.release(); c.release(); expect(ops.readiness().rooms).toBe(0);
});

it('readiness uses successful heartbeat, at most 5s grace, >2s stale, failure cannot be healed before disposal', async () => {
  let now = 0; const ops = new ServerOperations(readLimits({}), () => now);
  expect(ops.readiness().status).toBe('starting'); ops.started(); expect(ops.readiness().status).toBe('ready');
  const room = await ops.allocation('127.0.0.1', async () => ops.reserve());
  now = 4999; expect(ops.readiness().status).toBe('ready');
  now = 5000; expect(ops.readiness()).toMatchObject({ status: 'degraded', simulation: { stale: 1 } });
  room.heartbeat(); expect(ops.readiness().status).toBe('ready');
  now += 2000; expect(ops.readiness().status).toBe('ready');
  now++; expect(ops.readiness().status).toBe('degraded');
  room.fail(); room.heartbeat(); expect(ops.readiness()).toMatchObject({ status: 'degraded', simulation: { failed: 1 } });
  room.release(); expect(ops.readiness()).toMatchObject({ status: 'ready', rooms: 0 });
});

it('configuration rejects malformed, zero, fractional and unsafe limits', () => {
  for (const key of ['CAMPUS_MAX_ROOMS', 'CAMPUS_CREATE_BURST', 'CAMPUS_CREATE_REFILL_MS', 'CAMPUS_MAX_IPS', 'CAMPUS_IP_IDLE_MS']) {
    for (const value of ['0', '-1', '1.5', 'NaN', '', '9007199254740992']) expect(() => readLimits({ [key]: value })).toThrow(key);
  }
  expect(readLimits({ CAMPUS_MAX_ROOMS: '8', CAMPUS_CREATE_BURST: '3' })).toMatchObject({ maxRooms: 8, createBurst: 3 });
});

it('canonical IPv6 and hex mapped IPv4 cannot acquire a second identity budget', () => {
  const ops = new ServerOperations();
  for (let i = 0; i < 6; i++) ops.admit('::ffff:127.0.0.1');
  expect(() => ops.admit('::ffff:7f00:1')).toThrow();
  for (let i = 0; i < 6; i++) ops.admit('2001:db8::1');
  expect(() => ops.admit('2001:0DB8:0000:0000:0000:0000:0000:0001')).toThrow();
  expect(ops.identityCount).toBe(2);
});

it('default capacity refuses the 33rd initializing room and permits it after a single release', async () => {
  const ops = new ServerOperations(); const leases = [];
  for (let i = 0; i < 32; i++) leases.push(await ops.allocation(`127.0.0.${i + 1}`, async () => ops.reserve()));
  await expect(ops.allocation('127.0.0.1', async () => ops.reserve())).rejects.toThrow();
  leases[0]!.release(); await ops.allocation('127.0.0.1', async () => ops.reserve());
  expect(ops.readiness()).toMatchObject({ rooms: 32, capacity: 32 });
});

it.each([false, true])('dispatch finally revokes retained descendants, including unused grants (throw=%s)', async throws => {
  const ops = new ServerOperations(); let finishChild!: () => void;
  const barrier = new Promise<void>(resolve => { finishChild = resolve; });
  let late!: Promise<boolean>;
  const dispatch = ops.allocation('127.0.0.1', async () => {
    late = (async () => { await barrier; try { ops.reserve().release(); return true; } catch { return false; } })();
    if (throws) throw new Error('dispatch failure');
  });
  if (throws) await expect(dispatch).rejects.toThrow('dispatch failure'); else await dispatch;
  finishChild(); expect(await late).toBe(false); expect(ops.readiness().rooms).toBe(0);
});

it('capacity rejection consumes the grant even if a slot opens during that same dispatch', async () => {
  const ops = new ServerOperations({ ...readLimits({}), maxRooms: 1 });
  const room = await ops.allocation('127.0.0.1', async () => ops.reserve());
  await ops.allocation('127.0.0.1', async () => {
    expect(() => ops.reserve()).toThrow(); room.release(); expect(() => ops.reserve()).toThrow();
  });
});
