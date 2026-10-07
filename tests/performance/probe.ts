// TEST ONLY. Imported into the Vite page by the standalone runner, never the app.
// No authority/input/position bypass. Ablations are reversible presentation probes.
// Match the app's Vite URLs exactly: /@fs aliases would instantiate separate classes.
// @ts-ignore browser-only Vite root URL
import { CampusScene } from '/src/scene.ts';
// @ts-ignore browser-only Vite root URL
import { UI } from '/src/ui.ts';
import * as THREE from 'three';
import type { CampusScene as SceneType } from '../../apps/client/src/scene.js';

export async function install() {
  const w = window as any;
  if (w.perfProbe) return;
  const original = CampusScene.prototype.render;
  const uiOriginal = Object.fromEntries(['updateHud', 'map', 'showLabels', 'showContext'].map(k => [k, (UI.prototype as any)[k]]));
  const state: any = { mode: 'normal', enabled: false, cpu: [], render: [], gpu: [], calls: [], triangles: [], ui: [], queries: [], queryEvery: 20, index: 0 };
  let instance: SceneType;
  let rt: THREE.WebGLRenderTarget | undefined;
  let lastArgs: any[];
  let rendererRender: any;
  let ext: any;
  const ready = new Promise<void>(resolve => {
    CampusScene.prototype.render = function (this: SceneType, ...args: any[]) {
      if (!instance) {
        instance = this; rendererRender = this.renderer.render.bind(this.renderer);
        const gl = this.renderer.getContext() as WebGL2RenderingContext; ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        this.renderer.render = ((scene: THREE.Scene, camera: THREE.Camera) => {
          if (state.mode === 'no-render') return;
          if (state.mode === 'offscreen') {
            rt ??= new THREE.WebGLRenderTarget(1920, 1080, { samples: gl.getParameter(gl.SAMPLES), depthBuffer: true });
            this.renderer.setRenderTarget(rt);
          }
          if (state.mode === 'frozen-camera') {
            state.camera ??= camera.clone(); camera = state.camera;
          }
          const pending = state.queries[0];
          if (pending && gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && state.enabled) state.gpu.push(gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(state.queries.shift());
          }
          const q = state.enabled && state.timers && ext && ++state.index % state.queryEvery === 0 ? gl.createQuery() : null;
          if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          const t = performance.now();
          rendererRender(scene, camera);
          if (state.mode === 'finish') gl.finish();
          if (state.enabled) { state.render.push(performance.now() - t); state.calls.push(this.renderer.info.render.calls); state.triangles.push(this.renderer.info.render.triangles); }
          if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); state.queries.push(q); }
          if (state.mode === 'offscreen') this.renderer.setRenderTarget(null);
        }) as typeof this.renderer.render;
        resolve();
      }
      lastArgs = args;
      const t = performance.now();
      const result = Reflect.apply(original, this, args);
      if (state.enabled) state.cpu.push(performance.now() - t);
      return result;
    };
  });
  for (const key of Object.keys(uiOriginal)) (UI.prototype as any)[key] = function (...args: any[]) {
    if (state.mode === 'no-ui' || (state.mode === 'no-map' && key === 'map') || (state.mode === 'no-labels' && key === 'showLabels')) return;
    const t = performance.now(); const result = Reflect.apply(uiOriginal[key], this, args);
    if (state.enabled) state.ui.push(performance.now() - t);
    return result;
  };
  const style = document.createElement('style'); document.head.append(style);
  w.perfProbe = {
    ready,
    mode(mode: string) {
      state.mode = mode; state.camera = null;
      instance.renderer.shadowMap.enabled = mode !== 'no-shadows';
      style.textContent = mode === 'hide-dom' ? '#app > :not(#campus){display:none!important}' : mode === 'no-css-effects' ? '*{backdrop-filter:none!important;filter:none!important;box-shadow:none!important;text-shadow:none!important}' : '';
    },
    start(timers = false) { for (const k of ['cpu', 'render', 'gpu', 'calls', 'triangles', 'ui']) state[k] = []; state.timers = timers; state.enabled = true; },
    endWindow() { state.enabled = false; },
    stop() {
      state.enabled = false;
      return { cpu: state.cpu, render: state.render, gpu: state.gpu, calls: state.calls, triangles: state.triangles, ui: state.ui, gpuTimerAvailable: !!ext, camera: instance.camera.position.toArray(), actors: instance.actors.size, mode: state.mode, frameArgs: { mode: lastArgs?.[7], players: lastArgs?.[1]?.length }, context: instance.renderer.getContext().getContextAttributes() };
    },
  };
  await ready;
}
