const runtime = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/";
const modelUrl = "https://huggingface.co/GerhardTrippen/chess-ocr-bilstm/resolve/main/chess_ocr.onnx";
const alphabet = ["", ..."KQRBNabcdefgh12345678x+#=O-"];
const width = 256;
const height = 64;
let session;

async function readCrop(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Couldn’t download crop.");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  return Float32Array.from({ length: width * height }, (_, index) => {
    const pixel = index * 4;
    const gray = 0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2];
    return gray / 127.5 - 1;
  });
}

function decode({ data, dims }) {
  const classes = dims.at(-1);
  if (classes !== alphabet.length) throw new Error("Unexpected model alphabet.");
  let previous = 0;
  let text = "";
  for (let frame = 0; frame < data.length; frame += classes) {
    let best = 0;
    for (let index = 1; index < classes; index++) {
      if (data[frame + index] > data[frame + best]) best = index;
    }
    if (best !== previous) text += alphabet[best];
    previous = best;
  }
  return text;
}

self.onmessage = async ({ data: sources }) => {
  try {
    if (!session) {
      importScripts(runtime + "ort.min.js");
      ort.env.wasm.wasmPaths = runtime;
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] });
    }
    for (const [index, src] of sources.entries()) {
      self.postMessage({ type: "status", text: "Reading " + (index + 1) + " of " + sources.length + "…" });
      if (!src) {
        self.postMessage({ type: "result", index, blank: true });
        continue;
      }
      try {
        const input = new ort.Tensor("float32", await readCrop(src), [1, 1, height, width]);
        const { output } = await session.run({ input });
        self.postMessage({ type: "result", index, output: decode(output) });
      } catch (error) {
        self.postMessage({ type: "result", index, error: error.message || "Unread" });
      }
    }
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({ type: "error", text: error.message });
  }
};
