import { detectGrid } from "./grid.mjs";
import { blockProjection, straightenBlock } from "./perspective.mjs";
import { parseEntry, formatPgn, nearbyMoves } from "./notation.mjs";
import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const byId = id => document.getElementById(id);
const canvas = byId("sheet");
const ctx = canvas.getContext("2d");
const source = document.createElement("canvas");
const suggestions = byId("suggestions");
const entries = [];
let photo;
let rotation = 0;
const corners = [];
let worker;
let activeBatch;
let lastScan;
let firstUnresolved;
let pgn = "";

function renderPhoto() {
  const side = rotation % 2;
  const scale = Math.min(1, 2200 / Math.max(photo.width, photo.height));
  const width = Math.round(photo.width * scale);
  const height = Math.round(photo.height * scale);
  source.width = canvas.width = side ? height : width;
  source.height = canvas.height = side ? width : height;
  const drawing = source.getContext("2d");
  drawing.translate(source.width / 2, source.height / 2);
  drawing.rotate(rotation * Math.PI / 2);
  drawing.drawImage(photo, -width / 2, -height / 2, width, height);
  resetBox();
}

function resetBox() {
  corners.length = 0;
  drawGrid();
}

function rowCount() {
  const count = byId("rows").valueAsNumber;
  return Number.isInteger(count) && count >= 1 && count <= 100 ? count : 0;
}

function splitRatio() {
  return Number(byId("split").value) / 100;
}

function drawGrid() {
  if (photo) ctx.drawImage(source, 0, 0);
  const count = rowCount();
  const projection = blockProjection(corners);
  byId("scan").disabled = !projection || !count || !!activeBatch || entries.length % 2 !== 0;
  byId("undo-corner").disabled = !corners.length;
  const labels = ["top left", "top right", "bottom right", "bottom left"];
  byId("corner-status").textContent = corners.length < 4
    ? "Tap the " + labels[corners.length] + " corner."
    : projection ? "Check the row count and column divider, then scan this block."
      : "The corners cross or are too close. Undo a corner and try again.";
  const bounds = canvas.getBoundingClientRect();
  const scale = bounds.width ? canvas.width / bounds.width : 1;
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = "#16c681";
  ctx.beginPath();
  corners.forEach(({ x, y }, index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  if (corners.length === 4) ctx.closePath();
  if (projection) {
    const line = (u1, v1, u2, v2) => {
      const first = projection.project(u1, v1);
      const last = projection.project(u2, v2);
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
    };
    line(splitRatio(), 0, splitRatio(), 1);
    for (let row = 1; row < count; row++) line(0, row / count, 1, row / count);
  }
  ctx.stroke();
  corners.forEach(({ x, y }, index) => {
    ctx.beginPath();
    ctx.arc(x, y, 10 * scale, 0, 2 * Math.PI);
    ctx.fillStyle = "#254739";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold " + 12 * scale + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x, y);
  });
}

canvas.addEventListener("click", event => {
  if (!photo || activeBatch || corners.length === 4) return;
  const bounds = canvas.getBoundingClientRect();
  corners.push({
    x: (event.clientX - bounds.left) * canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * canvas.height / bounds.height,
  });
  drawGrid();
});

byId("photo").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file || activeBatch) return;
  byId("scan-status").textContent = "Finding the move grid…";
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (event.target.files[0] !== file) return;
    photo = image;
    rotation = 0;
    byId("image-tools").hidden = false;
    byId("alignment").hidden = false;
    byId("alignment").open = false;
    renderPhoto();
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (event.target.files[0] !== file || activeBatch) return;
    if (entries.length % 2 !== 0) {
      byId("scan-status").textContent = "Add the missing Black move or remove the previous White move before scanning this page.";
      byId("alignment").open = true;
      return;
    }
    const cells = detectGrid(source.getContext("2d").getImageData(0, 0, source.width, source.height));
    if (!cells.length) {
      byId("scan-status").textContent = "Couldn’t find a clear grid. Tap the four corners of a move block below.";
      byId("alignment").open = true;
      return;
    }
    const crops = makeCrops(cells);
    beginScan(crops, cells.map(cell => cell.ink));
  } catch {
    if (event.target.files[0] === file) {
      byId("scan-status").textContent = "Couldn’t open that photo. Try a JPEG or PNG.";
    }
  } finally {
    URL.revokeObjectURL(url);
  }
});
byId("rotate").addEventListener("click", () => {
  rotation = (rotation + 1) % 4;
  renderPhoto();
});
byId("reset-box").addEventListener("click", resetBox);
byId("undo-corner").addEventListener("click", () => {
  corners.pop();
  drawGrid();
});
byId("rows").addEventListener("input", drawGrid);
byId("split").addEventListener("input", drawGrid);

function addEntry(crop = "") {
  const index = entries.length;
  const white = index % 2 === 0;
  const name = "Move " + (Math.floor(index / 2) + 1) + (white ? " White" : " Black");
  const node = document.createElement("li");
  node.className = "ply";
  const number = document.createElement("span");
  number.textContent = (Math.floor(index / 2) + 1) + (white ? "." : "…");
  const thumbnail = crop ? new Image() : document.createElement("span");
  if (crop) {
    thumbnail.src = crop;
    thumbnail.alt = name + " crop";
  }
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = white ? "White" : "Black";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("aria-label", name);
  const status = document.createElement("small");
  const entry = { node, input, status, crop, pending: !!crop, edited: false };
  input.addEventListener("input", () => {
    entry.edited = true;
    entry.canonical = false;
    validate();
  });
  node.append(number, thumbnail, input, status);
  byId("moves").append(node);
  entries.push(entry);
  return entry;
}

function removeEntry() {
  if (lastScan?.end === entries.length) lastScan.end--;
  if (lastScan?.start === lastScan?.end) lastScan = undefined;
  const entry = entries.pop();
  entry.node.remove();
}

function manualCells({ width, height }) {
  const count = rowCount();
  const rowHeight = height / count;
  const whiteWidth = width * splitRatio();
  const total = count * 2 - Number(byId("white-last").checked);
  return Array.from({ length: total }, (_, index) => {
    const black = index % 2 !== 0;
    const left = black ? whiteWidth : 0;
    const top = Math.floor(index / 2) * rowHeight;
    return { left, top, right: black ? width : whiteWidth, bottom: top + rowHeight };
  });
}

function makeCrops(cells, image = source) {
  const crop = document.createElement("canvas");
  crop.width = 256;
  crop.height = 64;
  const drawing = crop.getContext("2d");
  return cells.map(({ left, top, right, bottom }) => {
    const width = right - left;
    const height = bottom - top;
    const insetX = Math.min(5, width * 0.035);
    const insetY = Math.min(4, height * 0.1);
    drawing.fillStyle = "#fff";
    drawing.fillRect(0, 0, crop.width, crop.height);
    drawing.drawImage(image, left + insetX, top + insetY, width - insetX * 2, height - insetY * 2,
      0, 0, crop.width, crop.height);
    return crop.toDataURL("image/png");
  });
}

function beginScan(crops, ink = crops.map(() => true)) {
  const startIndex = entries.length;
  activeBatch = crops.map(crop => addEntry(crop));
  lastScan = { start: startIndex, end: entries.length };
  const progress = byId("scan-progress");
  progress.removeAttribute("value");
  progress.max = crops.length;
  progress.hidden = false;
  byId("scan-status").textContent = "Preparing recognition for " + crops.length + " move cells…";
  drawGrid();
  validate();
  getWorker().postMessage(crops.map((crop, index) => ink[index] ? crop : null));
}

function finishBatch(message) {
  activeBatch.forEach(entry => { entry.pending = false; });
  activeBatch = undefined;
  byId("scan-progress").hidden = true;
  byId("scan-status").textContent = message;
  resetBox();
  validate();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("ocr.js?v=3", import.meta.url));
  worker.onmessage = ({ data }) => {
    if (!activeBatch) return;
    if (data.type === "status") byId("scan-status").textContent = data.text;
    if (data.type === "result") {
      const entry = activeBatch[data.index];
      entry.pending = false;
      byId("scan-progress").value = data.index + 1;
      if (!entry.edited && typeof data.output === "string") entry.input.value = data.output;
      entry.ocrError = data.error;
      entry.blank = data.blank;
      validate();
    }
    if (data.type === "done") finishBatch("Scan finished. Review the moves, or choose another page.");
    if (data.type === "error") finishBatch("Recognition failed. You can still type the moves from the crops. " + data.text);
  };
  worker.onerror = () => {
    worker.terminate();
    worker = undefined;
    if (activeBatch) finishBatch("Couldn’t start recognition. You can still type the moves from the crops.");
  };
  return worker;
}

byId("scan").addEventListener("click", () => {
  const projection = blockProjection(corners);
  if (!projection || !rowCount()) return;
  const rectified = document.createElement("canvas");
  rectified.width = projection.width;
  rectified.height = projection.height;
  const context = rectified.getContext("2d");
  const input = source.getContext("2d").getImageData(0, 0, source.width, source.height);
  const output = context.createImageData(rectified.width, rectified.height);
  straightenBlock(input, output, projection);
  context.putImageData(output, 0, 0);
  beginScan(makeCrops(manualCells(rectified), rectified));
});
byId("undo-page").addEventListener("click", () => {
  const { start } = lastScan;
  while (entries.length > start) removeEntry();
  lastScan = undefined;
  byId("photo").value = "";
  byId("scan-status").textContent = "Last scan removed. Select the photo again or adjust the grid manually.";
  byId("alignment").open = true;
  drawGrid();
  validate();
});
byId("jump-review").addEventListener("click", () => firstUnresolved?.focus());

byId("manual").addEventListener("click", () => {
  const incompletePair = entries.length % 2 !== 0;
  const first = addEntry();
  if (!incompletePair) addEntry();
  drawGrid();
  validate();
  first.input.focus();
});
byId("remove").addEventListener("click", () => {
  removeEntry();
  drawGrid();
  validate();
});
byId("clear").addEventListener("click", () => {
  if (!window.confirm("Clear all moves from this session?")) return;
  while (entries.length) removeEntry();
  drawGrid();
  validate();
});

for (const control of ["clock", "language", "result"]) {
  byId(control).addEventListener("change", validate);
}

function validate() {
  const chess = new Chess();
  const moves = [];
  const language = byId("language").value;
  const clock = byId("clock").value;
  let firstIssue;
  let choices = [];
  for (const [index, entry] of entries.entries()) {
    entry.node.dataset.state = entry.pending ? "pending" : "";
    if (firstIssue) {
      entry.status.textContent = entry.pending ? "Reading…" : entry.ocrError ? "OCR unread" : "Check earlier move";
      continue;
    }
    const { move, comment } = parseEntry(entry.input.value, (entry.canonical || (entry.crop && !entry.edited)) ? "en" : language, clock);
    if (!move) {
      firstIssue = { index, reason: entry.pending ? "Reading…" : entry.ocrError && !entry.edited ? "OCR failed. Type move." : entry.blank && !entry.edited ? "Blank cell. Check crop." : "Enter move" };
    } else {
      try {
        const legal = chess.move(move);
        moves.push({ san: legal.san, comment });
        entry.node.dataset.state = "valid";
        entry.status.textContent = legal.san;
      } catch {
        firstIssue = { index, reason: "Illegal move" };
        choices = nearbyMoves(move, chess.moves());
      }
    }
    if (firstIssue) {
      entry.node.dataset.state = entry.pending ? "pending" : "error";
      entry.status.textContent = firstIssue.reason;
    }
  }
  pgn = !activeBatch && entries.length > 0 && !firstIssue ? formatPgn(moves, byId("result").value) : "";
  byId("pgn").textContent = pgn;
  byId("preview").hidden = !pgn;
  byId("copy").disabled = byId("download").disabled = !pgn;
  byId("clear").disabled = byId("remove").disabled = !entries.length || !!activeBatch;
  byId("manual").disabled = !!activeBatch;
  byId("photo").disabled = !!activeBatch;
  byId("upload-label").textContent = entries.length ? "Choose another page" : "Choose scoresheet photo";
  byId("scan-options").hidden = !!activeBatch || !lastScan || lastScan.end !== entries.length;
  firstUnresolved = !activeBatch && firstIssue ? entries[firstIssue.index].input : undefined;
  byId("jump-review").hidden = !firstUnresolved;
  suggestions.hidden = !!activeBatch || choices.length === 0;
  suggestions.replaceChildren(...choices.map(move => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = move;
    button.addEventListener("click", () => {
      const entry = entries[firstIssue.index];
      entry.input.value = entry.input.value.trim().replace(/^\S+?(?=\s|\(|\[|$)/, move);
      entry.edited = entry.canonical = true;
      validate();
      (firstUnresolved ?? entry.input).focus();
    });
    return button;
  }));
  byId("review-status").textContent = activeBatch ? "Recognition is running." : firstIssue
    ? "Review move " + (Math.floor(firstIssue.index / 2) + 1) + (firstIssue.index % 2 === 0 ? " White." : " Black.")
    : moves.length ? moves.length + " legal half-moves. PGN ready." : "Add moves to begin.";
}

byId("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(pgn);
    byId("review-status").textContent = "PGN copied.";
  } catch {
    byId("preview").open = true;
    byId("review-status").textContent = "Clipboard unavailable. You can select the PGN or download it.";
  }
});
byId("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([pgn], { type: "application/x-chess-pgn" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "scoresheet.pgn";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
