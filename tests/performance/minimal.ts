// TEST ONLY: same 1080p hardware context, one rotating cube, optional multisampling.
import * as THREE from 'three';
export function install(antialias = true) {
  window.dispatchEvent(new Event('pagehide'));
  document.querySelector('#app')!.innerHTML = '<canvas id="campus"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#campus')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(1920, 1080, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#b9d3ce');
  const camera = new THREE.PerspectiveCamera(52, 1920 / 1080, .08, 140); camera.position.z = 5;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()); scene.add(cube);
  let mode = 'normal'; let cpu: number[] = [], enabled = false;
  const rt = new THREE.WebGLRenderTarget(1920, 1080, { samples: renderer.getContext().getParameter(renderer.getContext().SAMPLES) });
  let raf: number;
  function frame(t: number) {
    const start = performance.now(); cube.rotation.set(t / 2000, t / 1300, 0);
    if (mode !== 'no-render') { renderer.setRenderTarget(mode === 'offscreen' ? rt : null); renderer.render(scene, camera); }
    if (enabled) cpu.push(performance.now() - start);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  (window as any).perfProbe = { mode(value: string) { mode = value; }, start() { enabled = true; cpu = []; }, endWindow() { enabled = false; }, stop() { enabled = false; return { cpu, render: cpu, ui: [], gpu: [], calls: [1], triangles: [12], minimal: true, mode, context: renderer.getContext().getContextAttributes() }; } };
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); renderer.dispose(); rt.dispose(); cube.geometry.dispose(); cube.material.dispose(); }, { once: true });
}
