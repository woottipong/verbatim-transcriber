// VAD configuration - must set BEFORE loading @ricky0123/vad-react
window.ort = window.ort || {};
window.ort.env = window.ort.env || {};
window.ort.env.wasm = window.ort.env.wasm || {};
window.ort.env.wasm.wasmPaths = '/';

// Point to v5 model
window._vad_model_url = '/silero_vad_v5.onnx';
window._vad_worklet_url = '/vad.worklet.bundle.min.js';
