# Campus Together / original art source

Task 2 pipeline: custom profile/loft geometry → deterministic skinned student →
analytically solved baked gestures and locomotion → GLB → import validation →
render evidence. All distances are metres. Blender +Z up / -Y forward becomes
glTF +Y up / +Z forward. Feet midpoint is the root origin.

Approved design: warm collegiate festival, tailored cream varsity sleeves,
teal/terracotta/marigold/indigo jacket identities, embroidered-style numeric
badges on chest and backpack, swept sculpted hair, soft facial planes, eyebrows,
eyes, nose, smile, articulated trousers and detailed sneakers. No downloaded
models, motion, textures or fonts; the numeric badge uses custom segment geometry.

## Task checklist
- [x] Read spec/plan/contracts; inspect live Blender 5.2.1 and original scene.
- [x] Author original character, skin, four identities and carry sockets.
- [x] Author required animation clips and campus prop kit.
- [x] Export, validate and re-import GLB.
- [x] Produce render/contact evidence; local vision critique and review limits documented.
- [x] Write integration docs and Task 2 report.
- [ ] Human aesthetic/1x temporal acceptance in the integrated client (Tasks 3/4).

The existing live file is not used as source. Scripts must be run with a separate
`blender --background --factory-startup --python assets/source/build.py` process.
The build checks `bpy.app.background` before changing anything. Source modules
remain small and focused; `build.py` is the reproducible entry point.
