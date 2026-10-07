import type { Page } from '@playwright/test';

/** Read-only WebGL allocation/source observer. Sets handle null/repeated deletes accurately. */
export async function instrumentResources(page: Page) {
  await page.addInitScript(() => {
    const live = { buffers: new Set<object>(), textures: new Set<object>(), programs: new Set<object>() };
    const owners = new WeakMap<WebGL2RenderingContext, typeof live>();
    const contextLosses: { buffers: number; textures: number; programs: number }[] = [];
    const owned = (gl: WebGL2RenderingContext) => {
      let objects = owners.get(gl);
      if (!objects) {
        objects = { buffers: new Set(), textures: new Set(), programs: new Set() }; owners.set(gl, objects);
        gl.canvas.addEventListener('webglcontextlost', () => {
          const released = { buffers: objects!.buffers.size, textures: objects!.textures.size, programs: objects!.programs.size };
          for (const key of ['buffers', 'textures', 'programs'] as const) { for (const value of objects![key]) live[key].delete(value); objects![key].clear(); }
          contextLosses.push(released);
        });
      }
      return objects;
    };
    const sources = new WeakMap<WebGLShader, string>();
    const attached = new WeakMap<WebGLProgram, WebGLShader[]>();
    const ids = new WeakMap<object, number>(); let next = 0, frames = 0;
    const events: { id: number; kind: string; frame: number; vertex?: string; fragment?: string }[] = [];
    const proto = WebGL2RenderingContext.prototype;
    for (const [create, remove, key] of [['createBuffer', 'deleteBuffer', 'buffers'], ['createTexture', 'deleteTexture', 'textures'], ['createProgram', 'deleteProgram', 'programs']] as const) {
      const make = proto[create], free = proto[remove];
      Object.defineProperty(proto, create, { value: function(this: WebGL2RenderingContext, ...args: unknown[]) {
        const value = Reflect.apply(make, this, args);
        if (value) { live[key].add(value); owned(this)[key].add(value); if (key === 'programs') { ids.set(value, ++next); events.push({ id: next, kind: 'create', frame: frames }); } }
        return value;
      } });
      Object.defineProperty(proto, remove, { value: function(this: WebGL2RenderingContext, value: object | null) {
        if (value && live[key].delete(value) && key === 'programs') events.push({ id: ids.get(value)!, kind: 'delete', frame: frames });
        if (value) owned(this)[key].delete(value);
        return Reflect.apply(free, this, [value]);
      } });
    }
    const shaderSource = proto.shaderSource, attachShader = proto.attachShader, linkProgram = proto.linkProgram;
    proto.shaderSource = function(shader, source) { sources.set(shader, source); return shaderSource.call(this, shader, source); };
    proto.attachShader = function(program, shader) { attached.set(program, [...attached.get(program) ?? [], shader]); return attachShader.call(this, program, shader); };
    proto.linkProgram = function(program) {
      const shaders = attached.get(program) ?? [];
      const vertex = shaders.find(s => this.getShaderParameter(s, this.SHADER_TYPE) === this.VERTEX_SHADER);
      const fragment = shaders.find(s => this.getShaderParameter(s, this.SHADER_TYPE) === this.FRAGMENT_SHADER);
      events.push({ id: ids.get(program)!, kind: 'link', frame: frames, vertex: vertex ? sources.get(vertex) ?? '' : '', fragment: fragment ? sources.get(fragment) ?? '' : '' });
      return linkProgram.call(this, program);
    };
    const frame = () => { frames++; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    Object.assign(window, { resourceMeter: { read: () => ({ frame: frames, counters: Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.size])), programs: [...live.programs].map(p => ids.get(p)), events: [...events], contextLosses: [...contextLosses] }) } });
  });
}
export async function resources(page: Page) {
  return page.evaluate(() => (window as any).resourceMeter.read() as {
    frame: number; counters: Record<string, number>; programs: number[];
    events: { id: number; kind: string; frame: number; vertex?: string; fragment?: string }[];
    contextLosses: { buffers: number; textures: number; programs: number }[];
  });
}
export async function renderedFrames(page: Page, count = 6) {
  await page.evaluate(async count => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); }, count);
}
