let recognizer;

self.onmessage = async ({ data: sources }) => {
  try {
    if (!recognizer) {
      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      recognizer = await pipeline("image-to-text", "Xenova/trocr-small-handwritten", {
        device: "wasm",
        dtype: "q8",
      });
    }
    for (const [index, src] of sources.entries()) {
      self.postMessage({ type: "status", text: "Reading " + (index + 1) + " of " + sources.length + "…" });
      try {
        const [{ generated_text: output }] = await recognizer(src, { max_new_tokens: 24 });
        self.postMessage({ type: "result", index, output });
      } catch {
        self.postMessage({ type: "result", index, error: "Unread" });
      }
    }
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({ type: "error", text: error.message });
  }
};
