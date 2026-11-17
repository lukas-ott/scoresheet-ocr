import { buildMoveBoxes, findBoxedTable, locateMoveBoxes } from "./box-grid.mjs?v=25";
import { detectGrid } from "./grid.mjs";
import { classifyBoxCells, clubCells, refineClubCells, sheetLayouts, trimBoxCells } from "./club-sheet.mjs?v=23";
import { bestGamePath, detectEnglishNotation } from "./recognition.mjs?v=26";
import { blockProjection, straightenBlock } from "./perspective.mjs";
import { parseEntry, formatPgn, nearbyMoves } from "./notation.mjs";
import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const byId = id => document.getElementById(id);
const canvas = byId("sheet");
const ctx = canvas.getContext("2d");
const source = document.createElement("canvas");
const suggestions = byId("suggestions");
const cropForm = byId("crop-form");
const formatControl = byId("sheet-format");
const rowsInput = byId("rows");
const lastMoveInput = byId("last-move");
const clubLayout = () => sheetLayouts[formatControl.value];
let heicDecoder;
const entries = [];
let photo;
let rotation = 0;
const corners = [];
let cachedBoxes;
let worker;
let activeBatch;
let lastScan;
let firstUnresolved;
let pgn = "";
let reviewRevision = 0;

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
  cachedBoxes = undefined;
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
  cropForm.hidden = !projection;
  const incompletePair = entries.length % 2 !== 0;
  byId("scan").disabled = !projection || !!activeBatch || incompletePair;
  byId("crop-blocked").hidden = !incompletePair;
  byId("crop-blocked").textContent = incompletePair ? "The next move belongs to Black. Use Add moves manually to enter it before starting another block." : "";
  byId("undo-corner").disabled = !corners.length;
  const labels = ["top left", "top right", "bottom right", "bottom left"];
  byId("corner-status").textContent = corners.length < 4
    ? "Tap the " + labels[corners.length] + " corner."
    : projection ? "Four corners marked. Confirm the rows below."
      : "The corners cross or are too close. Undo a corner and try again.";
  const bounds = canvas.getBoundingClientRect();
  const scale = bounds.width ? canvas.width / bounds.width : 1;
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = "#16c681";
  ctx.beginPath();
  corners.forEach(({ x, y }, index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  if (corners.length === 4) ctx.closePath();
  const detected = projection && clubLayout()?.boxed && count && !activeBatch ? fittedBoxes(count) : undefined;
  if (detected) {
    for (const cell of detected.cells) {
      if (!cell) continue;
      const [first, ...others] = cell.corners;
      ctx.moveTo(first.x, first.y);
      for (const point of others) ctx.lineTo(point.x, point.y);
      ctx.closePath();
    }
  } else if (projection) {
    const line = (u1, v1, u2, v2) => {
      const first = projection.project(u1, v1);
      const last = projection.project(u2, v2);
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
    };
    if (clubLayout()) {
      for (const [left, right] of clubLayout().blocks) {
        for (const x of [left, (left + right) / 2, right]) {
          if (x > 0 && x < 1) line(x, 0, x, 1);
        }
      }
    } else {
      line(splitRatio(), 0, splitRatio(), 1);
    }
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
  if (!cropForm.hidden) cropForm.scrollIntoView({ block: "nearest" });
});

function updateFormat() {
  const club = clubLayout();
  byId("crop-help").textContent = club
    ? club.boxed
      ? "Tap the four outer corners of the move table, from the first White column to the last Black column. Leave the narrow number strip on the far left outside."
      : "Mark the outside corners of all move blocks together. Start at the first White column and end at the last Black column. Start just above the first row and end just below the bottom visible row."
    : "Mark one pair of White and Black columns. Leave the move numbers and headers outside the crop.";
  byId("row-help").textContent = club
    ? club.boxed
      ? "Use 30 rows per column on a full sheet. The app detects the last move, or you can enter it below."
      : "Use " + club.rows + " visible rows per block unless the photo cuts off the bottom. Enter the last move number to skip unused rows and signatures."
    : "Count the rows inside the outline, including the last row if it has only a White move.";
  byId("split-label").hidden = club;
  byId("last-move-label").hidden = !club;
  lastMoveInput.disabled = !club;
  lastMoveInput.required = Boolean(club && !club.boxed);
  lastMoveInput.placeholder = club?.boxed ? "Auto-detect" : "e.g. 35";
  rowsInput.max = club ? club.rows : 100;
  rowsInput.value = club ? club.rows : "";
  resetBox();
  if (club && photo) byId("alignment").open = true;
}

formatControl.addEventListener("change", updateFormat);
updateFormat();

async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function openPhoto(file) {
  try {
    return await decodeImage(file);
  } catch (error) {
    if (!/\.hei[cf]$/i.test(file.name) && !/^image\/hei[cf]/i.test(file.type)) throw error;
    if (!heicDecoder) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/iife/heic-to.js";
      heicDecoder = new Promise((resolve, reject) => {
        script.onload = () => resolve(window.HeicTo);
        script.onerror = reject;
        document.head.append(script);
      }).catch(error => {
        heicDecoder = undefined;
        script.remove();
        throw error;
      });
    }
    const convert = await heicDecoder;
    return decodeImage(await convert({ blob: file, type: "image/png" }));
  }
}

byId("photo").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file || activeBatch) return;
  byId("scan-status").textContent = "Finding the move grid…";
  try {
    const image = await openPhoto(file);
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
    if (clubLayout()) {
      if (clubLayout().boxed) {
        const detected = findBoxedTable(sourcePixels());
        if (detected) {
          corners.push(...detected);
          byId("alignment").open = true;
          drawGrid();
          byId("scan-status").textContent = "Grid detected. Check that the outline starts at move 1 and ends at move 30. Use Reset to mark it yourself.";
          return;
        }
      }
      byId("scan-status").textContent = "Mark the four corners around all move blocks.";
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
      photo = undefined;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      resetBox();
      byId("alignment").hidden = true;
      byId("scan-status").textContent = "Couldn’t open that photo. Try a JPEG or PNG.";
    }
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
  const thumbnail = document.createElement(crop ? "button" : "span");
  if (crop) {
    thumbnail.type = "button";
    thumbnail.className = "crop-thumbnail";
    thumbnail.setAttribute("aria-label", "Enlarge " + name.toLowerCase() + " crop");
    const image = new Image();
    image.src = crop;
    image.alt = name + " crop";
    thumbnail.append(image);
    thumbnail.addEventListener("click", () => {
      byId("crop-preview-title").textContent = name;
      byId("crop-preview-image").src = crop;
      byId("crop-preview").showModal();
    });
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
    reviewRevision++;
    entry.edited = true;
    entry.checkReading = false;
    entry.canonical = false;
    validate();
  });
  input.addEventListener("change", () => { void recheckAfter(entry); });
  node.append(number, thumbnail, input, status);
  byId("moves").append(node);
  entries.push(entry);
  reviewRevision++;
  return entry;
}

function removeEntry() {
  reviewRevision++;
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

function fittedBoxes(rows, input) {
  const key = JSON.stringify([rows, corners]);
  if (cachedBoxes?.key === key) return cachedBoxes.value;
  const fit = locateMoveBoxes(input ?? sourcePixels(), corners, rows);
  const value = fit ? { fit, cells: buildMoveBoxes(fit, rows) } : undefined;
  cachedBoxes = { key, value };
  return value;
}

function sourcePixels() {
  return source.getContext("2d").getImageData(0, 0, source.width, source.height);
}

function makeBoxCrops(cells, input) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const drawing = canvas.getContext("2d");
  const pixels = drawing.createImageData(canvas.width, canvas.height);
  const aspects = [];
  const crops = cells.map((cell, index) => {
    const box = cell && blockProjection(cell.corners);
    if (!box) {
      aspects[index] = 1;
      return "";
    }
    const insetX = Math.min(0.035, 5 / box.width);
    const insetY = Math.min(0.10, 4 / box.height);
    const project = (x, y) => box.project(insetX + (1 - 2 * insetX) * x, insetY + (1 - 2 * insetY) * y);
    straightenBlock(input, pixels, { project });
    drawing.putImageData(pixels, 0, 0);
    aspects[index] = (box.width * (1 - 2 * insetX)) / (box.height * (1 - 2 * insetY));
    return canvas.toDataURL("image/png");
  });
  return { crops, aspects };
}

function makeCrops(cells, image = source) {
  const crop = document.createElement("canvas");
  crop.width = 256;
  crop.height = 64;
  const drawing = crop.getContext("2d");
  return cells.map(cell => {
    if (!cell) return "";
    const { left, top, right, bottom } = cell;
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

function beginScan(crops, ink = crops.map(() => true), aspects, alternative) {
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
  getWorker().postMessage({ sources: crops.map((crop, index) => ink[index] ? crop : null), useContrast: !!clubLayout(), aspects, alternative });
}

function finishBatch(message) {
  activeBatch.forEach(entry => { entry.pending = false; });
  activeBatch = undefined;
  byId("scan-progress").hidden = true;
  byId("scan-status").textContent = message;
  resetBox();
  validate();
}

async function checkReadings(batch, start, progress, isCurrent = () => true) {
  const chess = new Chess();
  const language = byId("language").value;
  for (const entry of entries.slice(0, start)) {
    const { move } = parseEntry(entry.input.value, entryLanguage(entry, language), "literal");
    try { chess.move(move); } catch { return; }
  }
  const readings = [];
  for (const entry of batch) {
    if (!entry.readings?.some(view => view.text) || entry.edited) break;
    readings.push(entry.readings);
  }
  const twoPanel = batch[0]?.twoPanelCrop;
  const english = twoPanel && (batch[0].englishReading ?? detectEnglishNotation(readings));
  if (twoPanel) batch.forEach(entry => { entry.englishReading = english; });
  const german = language === "de" || (batch[0]?.tournamentCrop && !english);
  const moves = await bestGamePath(Chess, chess.fen(), readings, german, progress, twoPanel);
  if (!isCurrent()) return;
  for (const [index, move] of moves.entries()) {
    const entry = batch[index];
    if (entry.edited) break;
    const note = entry.readings.find(view => view.annotation)?.annotation;
    entry.input.value = move.san + (note ? " " + note : "");
    entry.checkReading = move.check || !!note;
    entry.alternatives = move.options;
  }
}

async function recheckAfter(editedEntry) {
  if (activeBatch) return;
  const start = entries.indexOf(editedEntry) + 1;
  if (!entries[start]?.readings) return;
  const revision = reviewRevision;
  try {
    await checkReadings(entries.slice(start), start, () => new Promise(resolve => setTimeout(resolve, 0)),
      () => revision === reviewRevision && !activeBatch);
  } catch (error) {
    console.warn("Could not recheck later readings", error);
  }
  if (revision === reviewRevision && !activeBatch) validate();
}

function entryLanguage(entry, language) {
  return entry.canonical || (entry.crop && !entry.edited) ? "en" : language;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("ocr.js?v=7", import.meta.url));
  worker.onmessage = async ({ data }) => {
    if (!activeBatch) return;
    if (data.type === "status") byId("scan-status").textContent = data.text;
    if (data.type === "result") {
      const entry = activeBatch[data.index];
      entry.pending = false;
      byId("scan-progress").value = data.index + 1;
      if (!entry.edited && typeof data.output === "string") entry.input.value = data.output;
      entry.readings = data.readings;
      entry.tournamentCrop = !!clubLayout();
      entry.twoPanelCrop = Boolean(clubLayout()?.boxed);
      entry.ocrError = data.error;
      entry.blank = data.blank;
      validate();
    }
    if (data.type === "done") {
      const batch = activeBatch;
      try {
        const start = entries.length - batch.length;
        await checkReadings(batch, start, async index => {
          byId("scan-status").textContent = "Checking possible readings for move " + (Math.floor((start + index) / 2) + 1) + "…";
          await new Promise(resolve => setTimeout(resolve, 0));
        });
      } catch (error) {
        console.warn("Could not check OCR readings against the game", error);
      }
      if (activeBatch === batch) finishBatch("Scan finished. Check the marked readings against their photos.");
    }
    if (data.type === "error") finishBatch("Recognition failed. You can still type the moves from the crops. " + data.text);
  };
  worker.onerror = () => {
    worker.terminate();
    worker = undefined;
    if (activeBatch) finishBatch("Couldn’t start recognition. You can still type the moves from the crops.");
  };
  return worker;
}

cropForm.addEventListener("submit", event => {
  event.preventDefault();
  const projection = blockProjection(corners);
  if (!projection || !rowCount() || activeBatch || entries.length % 2 !== 0) return;
  const input = sourcePixels();
  const layout = clubLayout();
  const rows = rowCount();
  const lastMove = Number.isFinite(lastMoveInput.valueAsNumber) ? lastMoveInput.valueAsNumber : undefined;
  const whiteLast = lastMove !== undefined && byId("white-last").checked;
  const detected = layout?.boxed && fittedBoxes(rows, input);
  if (detected) {
    const { fit } = detected;
    const classified = classifyBoxCells(detected.cells, fit.gray, fit.warp.width);
    const cells = lastMove === undefined ? trimBoxCells(classified) : classified.slice(0, lastMove * 2 - Number(whiteLast));
    if (!cells.some(Boolean)) {
      byId("scan-status").textContent = "No written moves found. Adjust the outline or enter the last move.";
      return;
    }
    const { crops, aspects } = makeBoxCrops(cells, input);
    beginScan(crops, cells.map(cell => Boolean(cell && (lastMove !== undefined || cell.ink !== "blank"))), aspects);
    byId("review-heading").focus();
    return;
  }
  const rectified = document.createElement("canvas");
  rectified.width = projection.width;
  rectified.height = projection.height;
  const context = rectified.getContext("2d");
  const output = context.createImageData(rectified.width, rectified.height);
  straightenBlock(input, output, projection);
  context.putImageData(output, 0, 0);
  const cells = layout
    ? refineClubCells(layout, output, rowCount(), lastMove, whiteLast)
    : manualCells(rectified);
  if (!cells.some(Boolean)) {
    byId("scan-status").textContent = "Couldn’t find written moves inside the outline. Adjust the corners or enter the last move.";
    return;
  }
  const crops = makeCrops(cells, rectified);
  const aspect = cell => cell ? (cell.right - cell.left) / (cell.bottom - cell.top) : 1;
  const aspects = clubLayout() ? cells.map(aspect) : undefined;
  let alternative;
  if (layout) {
    const original = clubCells(layout, rectified.width, rectified.height, rowCount(),
      Math.ceil(cells.length / 2), cells.length % 2 !== 0);
    alternative = { sources: makeCrops(original, rectified), aspects: original.map(aspect) };
  }
  beginScan(crops, crops.map(Boolean), aspects, alternative);
  byId("review-heading").focus();
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
  let firstQuestion;
  let questions = 0;
  let choices = [];
  for (const [index, entry] of entries.entries()) {
    entry.node.dataset.state = entry.pending ? "pending" : "";
    if (firstIssue) {
      entry.status.textContent = entry.pending ? "Reading…" : entry.ocrError ? "OCR unread" : "Check earlier move";
      continue;
    }
    const { move, comment } = parseEntry(entry.input.value, entryLanguage(entry, language), clock);
    if (!move) {
      firstIssue = { index, reason: entry.pending ? "Reading…" : entry.ocrError && !entry.edited ? "OCR failed. Type move." : entry.blank && !entry.edited ? "Blank cell. Check crop." : "Enter move" };
    } else {
      try {
        const legal = chess.move(move);
        moves.push({ san: legal.san, comment });
        entry.node.dataset.state = entry.checkReading ? "check" : "valid";
        entry.status.textContent = entry.checkReading ? "Check " + legal.san : legal.san;
        if (entry.checkReading) {
          questions++;
          firstQuestion ??= { index, choices: entry.alternatives };
        }
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
  byId("manual").hidden = !entries.length;
  byId("photo").disabled = formatControl.disabled = !!activeBatch;
  const hasMoves = entries.length > 0;
  byId("upload-label").textContent = hasMoves ? "Choose another page" : "Choose a photo";
  byId("review-empty").hidden = hasMoves;
  byId("review-settings").hidden = !hasMoves;
  byId("export-controls").hidden = !hasMoves;
  byId("remove").hidden = byId("clear").hidden = !hasMoves;
  byId("scan-options").hidden = !!activeBatch || !lastScan || lastScan.end !== entries.length;
  const target = firstIssue ?? firstQuestion;
  if (!firstIssue && firstQuestion) choices = firstQuestion.choices ?? [];
  firstUnresolved = !activeBatch && target ? entries[target.index].input : undefined;
  byId("jump-review").hidden = !firstUnresolved;
  byId("jump-review").textContent = firstIssue ? "First issue" : "Check a reading";
  suggestions.hidden = !!activeBatch || choices.length === 0;
  suggestions.replaceChildren(...choices.map(move => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = move;
    button.addEventListener("click", () => {
      const entry = entries[target.index];
      entry.input.value = entry.input.value.trim().replace(/^\S+?(?=\s|\(|\[|$)/, move);
      reviewRevision++;
      entry.edited = entry.canonical = true;
      entry.checkReading = false;
      validate();
      (firstUnresolved ?? entry.input).focus();
      void recheckAfter(entry);
    });
    return button;
  }));
  byId("review-status").textContent = activeBatch ? "Recognition is running." : firstIssue
    ? "Review move " + (Math.floor(firstIssue.index / 2) + 1) + (firstIssue.index % 2 === 0 ? " White." : " Black.")
    : questions ? "Check " + questions + " marked " + (questions === 1 ? "reading" : "readings") + " before export."
      : moves.length ? moves.length + " legal half-moves. PGN ready." : "";
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

validate();
