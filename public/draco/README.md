# Draco glTF decoder (self-hosted)

`draco_wasm_wrapper.js` and `draco_decoder.wasm` are copied unchanged from
`node_modules/three/examples/jsm/libs/draco/gltf/` (three 0.187.0). They are Google's Draco decoder,
Apache License 2.0 (https://github.com/google/draco).

`DRACOLoader` in `src/features/three-d/glbPipeline.ts` fetches them from `/draco/` only when a dropped
`.glb` uses `KHR_draco_mesh_compression`. The default scene never requests them.
To update: copy the same two files from the installed `three` version.
