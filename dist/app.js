const size = 12;
const total = 13731;
const dataset = new URL("https://datasets-server.huggingface.co/rows");
const status = document.querySelector("#status");
const run = document.querySelector("#run");
const next = document.querySelector("#next");
const cards = document.querySelector("#samples");
let rows = [];
let offset = 0;
let worker;
let matched = 0;
let recognized = 0;

async function loadBatch(start) {
  run.disabled = next.disabled = true;
  status.textContent = "Loading samples…";
  dataset.search = new URLSearchParams({
    dataset: "BenjaminKost/processed_hcs", config: "default", split: "train",
    offset: String(start), length: String(size),
  });
  try {
    const response = await fetch(dataset);
    if (!response.ok) throw new Error("Dataset returned HTTP " + response.status);
    const data = await response.json();
    const batch = data.rows.filter(({ row }) => row.image?.src && typeof row.label === "string");
    if (!batch.length) throw new Error("No labeled crops in this response.");
    offset = start;
    rows = batch.map(({ row, row_idx }) => renderCard(row, row_idx));
    cards.replaceChildren(...rows.map(row => row.card));
    status.textContent = "Showing samples " + (offset + 1) + "–" + (offset + rows.length) + ".";
  } catch (error) {
    status.textContent = "Couldn’t load the Hugging Face samples. " + error.message;
  } finally {
    run.disabled = !rows.length;
    next.disabled = false;
    next.textContent = rows.length ? "Next 12 samples" : "Retry loading samples";
  }
}

function renderCard(row, index) {
  const card = document.createElement("article");
  const image = new Image();
  image.src = row.image.src;
  image.alt = "Handwritten move crop " + (index + 1);
  const labels = document.createElement("dl");
  const result = document.createElement("dd");
  const expected = document.createElement("dd");
  const expectedTitle = document.createElement("dt");
  const resultTitle = document.createElement("dt");
  expectedTitle.textContent = "Expected";
  expected.textContent = row.label;
  resultTitle.textContent = "Read";
  result.textContent = "—";
  labels.append(expectedTitle, expected, resultTitle, result);
  card.append(image, labels);
  return { card, result, src: row.image.src, label: row.label };
}

function finish(message) {
  status.textContent = message;
  run.disabled = next.disabled = false;
}

function acceptResult({ index, output, error }) {
  const row = rows[index];
  if (error) {
    row.result.textContent = error;
    return;
  }
  const exact = output.trim() === row.label.trim();
  row.result.textContent = output.trim() || "(empty)";
  row.result.dataset.match = exact ? "yes" : "no";
  recognized += 1;
  matched += Number(exact);
}

run.addEventListener("click", () => {
  run.disabled = next.disabled = true;
  matched = recognized = 0;
  rows.forEach(({ result }) => {
    result.textContent = "—";
    delete result.dataset.match;
  });
  status.textContent = "Loading the handwriting model…";
  if (!worker) {
    worker = new Worker(new URL("ocr.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "result") acceptResult(data);
      if (data.type === "status") status.textContent = data.text;
      if (data.type === "error") finish("Recognition failed. " + data.text);
      if (data.type === "done") {
        finish(matched + "/" + rows.length + " exact matches · " + (rows.length - recognized) + " unread samples");
      }
    };
    worker.onerror = () => {
      worker.terminate();
      worker = undefined;
      finish("Couldn’t start the recognition worker. Check your connection and retry.");
    };
  }
  worker.postMessage(rows.map(({ src }) => src));
});

next.addEventListener("click", () => loadBatch(rows.length ? (offset + size) % total : 0));
loadBatch(0);
