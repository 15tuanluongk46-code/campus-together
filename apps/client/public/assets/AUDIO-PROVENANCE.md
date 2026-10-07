# Original audio and frontend art provenance

Created in this repository for Campus Together, 2026-10-05.

- `apps/client/src/audio.ts`: original procedural pentatonic 16-step melody,
  four-root accompaniment and bell overtones. WebAudio sine/triangle oscillators,
  local gain envelopes and stereo panning. No samples, borrowed melody, remote
  synthesis service, recordings or third-party audio assets.
- Original short UI, pickup, placement, drop, ping, error, phase and success
  motifs use separately authored pitch sequences. Footsteps are brief low
  triangle-oscillator transients triggered by actual rendered motion cadence.
- Music/effects buses activate after user gesture, volumes persist; hidden tab
  suspends the audio context; teardown stops oscillators and closes the context.
- Procedural architectural surface graphics/signs, festival inlays, favicon,
  illustration-free ticket UI: original, authored for this project.
- Original code-generated audio and graphic artwork: **CC0-1.0**.
- Be Vietnam Pro and Baloo 2 are bundled through Fontsource, **SIL Open Font
  License 1.1**, not original project fonts. Their package LICENSE files are
  retained in `node_modules/@fontsource/{be-vietnam-pro,baloo-2}/LICENSE` and
  reproduced alongside the assets in `FONT-LICENSES.txt`.
- Human and prop GLBs remain the original Task 2 assets described in
  `PROVENANCE.md` / `manifest.json`; no modifications to their meshes/rigs.

Browser functional activation has been exercised. Human listening acceptance
is distinct from automated WebAudio operation and has not been claimed.
