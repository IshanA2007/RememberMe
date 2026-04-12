// Copies @ricky0123/vad-web + onnxruntime-web runtime assets into public/
// so the Vite dev server can serve them from stable URLs (/vad/, /ort/).
// Needed because Vite's `node_modules/.vite/deps/*.mjs?import` path does
// not resolve ORT's WASM workers reliably.
//
// Runs as `postinstall`. Idempotent; safe to re-run.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const publicDir = join(repo, "public");
const vadDst = join(publicDir, "vad");
const ortDst = join(publicDir, "ort");

const vadSrc = join(repo, "node_modules", "@ricky0123", "vad-web", "dist");
const ortSrc = join(repo, "node_modules", "onnxruntime-web", "dist");

mkdirSync(vadDst, { recursive: true });
mkdirSync(ortDst, { recursive: true });

const vadFiles = [
  "silero_vad_legacy.onnx",
  "silero_vad_v5.onnx",
  "vad.worklet.bundle.min.js",
];
const ortFiles = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

let missing = 0;
for (const [src, dst, files] of [
  [vadSrc, vadDst, vadFiles],
  [ortSrc, ortDst, ortFiles],
]) {
  for (const f of files) {
    const s = join(src, f);
    const d = join(dst, f);
    if (!existsSync(s)) {
      console.warn(`[copy-vad-assets] missing source: ${s}`);
      missing += 1;
      continue;
    }
    cpSync(s, d);
  }
}

if (missing > 0) {
  console.warn(`[copy-vad-assets] ${missing} source file(s) missing — VAD may not work at runtime`);
  process.exitCode = 0; // do not fail install
} else {
  console.log("[copy-vad-assets] VAD + ORT runtime assets copied to public/");
}
