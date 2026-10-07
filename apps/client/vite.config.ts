import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: Number(process.env.CAMPUS_CLIENT_PORT ?? 5173), strictPort: true, proxy: {
    '/matchmake': { target: `http://127.0.0.1:${process.env.PORT ?? 2567}`, changeOrigin: true },
    '/health': { target: `http://127.0.0.1:${process.env.PORT ?? 2567}` },
    '^/[a-zA-Z0-9_-]+/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}': { target: `ws://127.0.0.1:${process.env.PORT ?? 2567}`, ws: true },
  } },
  build: { target: 'es2022', rolldownOptions: { output: { codeSplitting: { groups: [
    { name: 'physics-wasm', test: /@dimforge/ },
    { name: 'three', test: /node_modules\/three/ },
    { name: 'network', test: /node_modules\/(?:@colyseus|msgpackr|@colyseus\/schema)/ },
  ] } } } },
});
