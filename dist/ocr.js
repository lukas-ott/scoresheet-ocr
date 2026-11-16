const runtime = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/";
const modelUrl = "https://huggingface.co/GerhardTrippen/chess-ocr-bilstm/resolve/main/chess_ocr.onnx";
const latinModelUrl = "https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx";
const latinDictionaryUrl = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_latin_dict.txt";
const latinSymbols = [..."KQRBNDSLTabcdefghABCDEFGH12345678xsO0-+#=>"];
const alphabet = ["", ..."KQRBNabcdefgh12345678x+#=O-"];
const width = 256;
const height = 64;
let session;
let latinReader;

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
    return gray;
  });
}

function enhancedInk(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[Math.round(value)]++;
  let background = 255;
  let count = 0;
  while (background > 0 && count + histogram[background] < gray.length * 0.1) {
    count += histogram[background--];
  }
  return gray.map(pixel => Math.max(0, Math.min(255, 250 - (background - pixel) * 2.2)));
}

async function readScores(gray) {
  const input = new ort.Tensor("float32", gray.map(pixel => pixel / 127.5 - 1), [1, 1, height, width]);
  const { output } = await session.run({ input });
  const text = decode(output);
  const scores = Float32Array.from(output.data);
  for (let frame = 0; frame < scores.length; frame += alphabet.length) {
    let max = -Infinity;
    for (let i = frame; i < frame + alphabet.length; i++) max = Math.max(max, scores[i]);
    let sum = 0;
    for (let i = frame; i < frame + alphabet.length; i++) sum += Math.exp(scores[i] - max);
    const scale = max + Math.log(sum);
    for (let i = frame; i < frame + alphabet.length; i++) scores[i] -= scale;
  }
  return { text, scores };
}

async function loadLatinReader() {
  const [latinSession, response] = await Promise.all([
    ort.InferenceSession.create(latinModelUrl, { executionProviders: ["wasm"] }),
    fetch(latinDictionaryUrl),
  ]);
  if (!response.ok) throw new Error("Couldn’t load the handwriting alphabet.");
  const labels = ["", ...(await response.text()).trimEnd().split(/\r?\n/), " "];
  return { latinSession, labels, indices: new Map(labels.map((letter, index) => [letter, index])) };
}

async function readLatin(gray, aspect, { latinSession, labels, indices }) {
  const inputHeight = 48;
  const inputWidth = 320;
  const contentWidth = Math.max(1, Math.min(inputWidth, Math.round(aspect * inputHeight)));
  const stride = inputWidth * inputHeight;
  const samples = new Float32Array(3 * stride);
  for (let y = 0; y < inputHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / inputHeight));
    for (let x = 0; x < contentWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / contentWidth));
      const pixel = gray[sy * width + sx] / 127.5 - 1;
      const at = y * inputWidth + x;
      samples[at] = samples[stride + at] = samples[2 * stride + at] = pixel;
    }
  }
  const result = await latinSession.run({
    [latinSession.inputNames[0]]: new ort.Tensor("float32", samples, [1, 3, inputHeight, inputWidth]),
  });
  const output = result[latinSession.outputNames[0]];
  const classes = output.dims.at(-1);
  if (classes !== labels.length) throw new Error("Unexpected Latin OCR alphabet.");
  let last = 0;
  let rawText = "";
  const frames = output.data.length / classes;
  const characters = [];
  for (let frame = 0; frame < frames; frame++) {
    let best = 0;
    const start = frame * classes;
    for (let i = 1; i < classes; i++) {
      if (output.data[start + i] > output.data[start + best]) best = i;
    }
    if (best && best !== last) {
      rawText += labels[best];
      characters.push({ start: frame, text: labels[best] });
    }
    last = best;
  }
  // Read the move separately when the line also has an identifiable clock note.
  const pieces = rawText.match(/^(\S+?)\s*(\((?:\d{1,3}|\d{1,2}(?::[0-5]\d){1,2})\))$/);
  const text = pieces?.[1] ?? rawText;
  const count = pieces ? characters[pieces[1].length]?.start ?? frames : frames;
  const symbols = [...new Set(["", ...latinSymbols, ...text])].filter(letter => indices.has(letter));
  const columns = symbols.map(letter => indices.get(letter));
  const scores = new Float32Array(count * symbols.length);
  for (let frame = 0; frame < count; frame++) {
    for (const [i, column] of columns.entries()) {
      scores[frame * columns.length + i] = Math.log(Math.max(1e-20, output.data[frame * classes + column]));
    }
  }
  return { text, symbols, scores, annotation: pieces?.[2] };
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

self.onmessage = async ({ data: { sources, useContrast, aspects, alternative } }) => {
  try {
    if (!session) {
      importScripts(runtime + "ort.min.js");
      ort.env.wasm.wasmPaths = runtime;
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] });
    }
    let latin;
    if (aspects) {
      latinReader ??= loadLatinReader().catch(error => {
        latinReader = undefined;
        console.warn("Latin OCR unavailable", error);
      });
      latin = await latinReader;
    }
    for (const [index, src] of sources.entries()) {
      self.postMessage({ type: "status", text: "Reading " + (index + 1) + " of " + sources.length + "…" });
      if (!src) {
        self.postMessage({ type: "result", index, blank: true });
        continue;
      }
      try {
        const readings = [];
        const views = [{ src, aspect: aspects?.[index] }];
        if (alternative?.sources[index] && alternative.sources[index] !== src) {
          views.push({ src: alternative.sources[index], aspect: alternative.aspects[index] });
        }
        for (const view of views) {
          const gray = await readCrop(view.src);
          readings.push(await readScores(gray));
          if (useContrast) readings.push(await readScores(enhancedInk(gray)));
          if (latin) {
            try {
              readings.push(await readLatin(gray, view.aspect, latin));
            } catch (error) {
              console.warn("Latin OCR unavailable", error);
              latin = undefined;
            }
          }
        }
        self.postMessage({ type: "result", index, output: readings[0].text, readings },
          readings.map(({ scores }) => scores.buffer));
      } catch (error) {
        self.postMessage({ type: "result", index, error: error.message || "Unread" });
      }
    }
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({ type: "error", text: error.message });
  }
};
