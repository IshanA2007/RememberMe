// Copies @ricky0123/vad-web runtime assets into public/vad/ so the Vite
// dev server can fetch silero_vad_legacy.onnx + vad.worklet.bundle.min.js
// from stable URLs. ORT WASM workers are loaded from jsdelivr at runtime
// (see services/conversation_capture.ts) because Vite's dev server refuses
// dynamic imports of files under /public/.
//
// Runs as `postinstall`. Idempotent; safe to re-run.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const publicDir = join(repo, "public");
const vadDst = join(publicDir, "vad");
const legacyOrtDst = join(publicDir, "ort");

const vadSrc = join(repo, "node_modules", "@ricky0123", "vad-web", "dist");

mkdirSync(vadDst, { recursive: true });

// Clean up legacy public/ort/ left by older setups — ORT now loads from CDN.
if (existsSync(legacyOrtDst)) {
  rmSync(legacyOrtDst, { recursive: true, force: true });
}

const vadFiles = [
  "silero_vad_legacy.onnx",
  "silero_vad_v5.onnx",
  "vad.worklet.bundle.min.js",
];

let missing = 0;
for (const f of vadFiles) {
  const s = join(vadSrc, f);
  const d = join(vadDst, f);
  if (!existsSync(s)) {
    console.warn(`[copy-vad-assets] missing source: ${s}`);
    missing += 1;
    continue;
  }
  cpSync(s, d);
}

if (missing > 0) {
  console.warn(`[copy-vad-assets] ${missing} source file(s) missing — VAD may not work at runtime`);
  process.exitCode = 0; // do not fail install
} else {
  console.log("[copy-vad-assets] VAD runtime assets copied to public/vad/");
}
