import assert from "node:assert/strict";
import test from "node:test";
import { buildMoveBoxes, findBoxedTable, locateMoveBoxes } from "../dist/box-grid.mjs";
import { classifyBoxCells, trimBoxCells } from "../dist/club-sheet.mjs";

function ruledImage() {
  const width = 480;
  const height = 710;
  const data = new Uint8ClampedArray(width * height * 4).fill(245);
  const paint = (x, y, value = 45) => {
    const index = (y * width + x) * 4;
    data.fill(value, index, index + 3);
    data[index + 3] = 255;
  };
  const edges = [40, 134, 228, 252, 346, 440];
  const top = 55;
  const pitch = 20;
  for (let row = 0; row <= 30; row++) {
    for (let x = edges[0]; x <= edges.at(-1); x++) {
      paint(x, top + row * pitch + Number(x > 235));
      paint(x, top + row * pitch + Number(x > 235) + 1);
    }
  }
  for (const x of edges) {
    for (let y = top; y < top + 30 * pitch + 2; y++) {
      paint(x, y);
      paint(x + 1, y);
    }
  }
  return { width, height, data, paint, top, pitch, edges };
}

test("finds a two-panel table in the full image and rejects a blank photo", () => {
  const image = ruledImage();
  const corners = findBoxedTable(image);
  assert.equal(corners?.length, 4);
  assert.ok(Math.abs(corners[0].y - image.top) < 5);
  assert.ok(Math.abs(corners[2].y - (image.top + 30 * image.pitch)) < 5);
  assert.equal(findBoxedTable({ ...image, data: new Uint8ClampedArray(image.data.length).fill(255) }), undefined);
});

test("recovers individual boxes from imprecise taps and keeps White/Black ordering", () => {
  const image = ruledImage();
  const outline = [[49, 41], [433, 43], [433, 664], [49, 665]]
    .map(([x, y]) => ({ x, y }));
  const fit = locateMoveBoxes(image, outline, 30);
  assert.ok(fit);
  const boxes = buildMoveBoxes(fit, 30);
  const tolerances = [0, 1, 58, 60, 61, 118];
  for (const index of tolerances) {
    const { x, y } = boxes[index].corners[0];
    const rail = [0, 1, 3, 4][Math.floor(index / 60) * 2 + index % 2];
    const expectedY = image.top + Math.floor(index % 60 / 2) * image.pitch;
    assert.ok(Math.abs(x - image.edges[rail]) < 7, `cell ${index} x=${x}`);
    assert.ok(Math.abs(y - expectedY) < 5, `cell ${index} y=${y}`);
  }
  assert.equal(boxes.length, 120);
});

test("keeps a blank gap between moves and distinguishes faint ink", () => {
  const width = 60;
  const gray = new Uint8Array(width * 300).fill(240);
  const cells = Array.from({ length: 12 }, (_, row) => ({ left: 0, right: width, top: row * 24, bottom: (row + 1) * 24 }));
  for (const row of [0, 1, 3, 4, 5]) {
    for (let i = 0; i < 10; i++) {
      const index = (row * 24 + 6 + i) * width + 9 + Math.floor(i / 2);
      gray.fill(80, index, index + 3);
    }
  }
  gray.fill(115, 152 * width + 12, 152 * width + 16);
  const classified = classifyBoxCells(cells, gray, width);
  assert.equal(classified[2].ink, "blank");
  assert.equal(classified[5].ink, "written");
  assert.equal(classified[6].ink, "uncertain");
  assert.equal(trimBoxCells(classified).length, 6);
});

test("preserves missing rows before moving to the second panel on a clipped photo", () => {
  const image = ruledImage();
  const outline = [[40, 55], [440, 56], [440, 636], [40, 635]]
    .map(([x, y]) => ({ x, y }));
  const fit = locateMoveBoxes(image, outline, 29);
  assert.ok(fit);
  const cells = buildMoveBoxes(fit, 29);
  assert.deepEqual(cells.slice(58, 60), [null, null]);
  assert.ok(Math.abs(cells[60].corners[0].y - image.top) < 5);
});
