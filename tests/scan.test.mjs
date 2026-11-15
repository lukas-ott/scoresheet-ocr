import assert from "node:assert/strict";
import test from "node:test";
import { detectGrid } from "../dist/grid.mjs";
import { parseEntry, nearbyMoves, formatPgn } from "../dist/notation.mjs";

function sheet(lines, borders, ink, { width = 380, height = 205 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x, y, w, h) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        const at = (row * width + col) * 4;
        data[at] = data[at + 1] = data[at + 2] = 20;
      }
    }
  };
  if (lines.length) {
    for (const y of lines) rect(borders[0], y, borders.at(-1) - borders[0], 2);
    for (const x of borders) rect(x, lines[0], 2, lines.at(-1) - lines[0]);
  }
  for (const [x, y] of ink) rect(x, y, 16, 7);
  return { data, width, height };
}

test("detects two move columns and retains an unreadable cell in the middle", () => {
  const cells = detectGrid(sheet([20, 60, 100, 140, 180], [20, 190, 360], [
    [45, 35], [212, 35], [218, 75], [54, 115],
  ]));
  assert.deepEqual(cells.map(cell => cell.ink), [true, true, false, true, true]);
  assert.ok(cells[0].left < cells[1].left);
  assert.ok(cells[2].top > cells[1].top);
});

test("processes numbered panels left to right and omits their numbering columns", () => {
  const cells = detectGrid(sheet([20, 60, 100, 140], [15, 32, 105, 174, 194, 267, 337], [
    [46, 35], [125, 35], [46, 75], [125, 75], [46, 115], [125, 115], [214, 35], [280, 35],
  ]));
  assert.equal(cells.length, 8);
  assert.equal(cells[0].left, 32);
  assert.equal(cells[6].left, 194);
});

test("rejects photos without a suitable grid or with ambiguous equal columns", () => {
  assert.deepEqual(detectGrid(sheet([], [], [[45, 35]])), []);
  assert.deepEqual(detectGrid(sheet([20, 60, 100, 140], [20, 100, 180, 260, 340], [[45, 35]])), []);
});

test("exports canonical moves and clocks while preserving draw annotations", () => {
  const parsed = parseEntry("Sf3 (1:27) (=)", "de", "clk");
  assert.deepEqual(parsed, { move: "Nf3", comment: "[%clk 0:01:27] Draw offered" });
  assert.deepEqual(parseEntry("Sc6 87", "de", "emt"), { move: "Nc6", comment: "[%emt 0:01:27]" });
  assert.equal(parseEntry("e8=D+", "de", "literal").move, "e8=Q+");
  assert.match(formatPgn([{ san: "Nf3", comment: parsed.comment }, { san: "Nc6" }], "*"),
    /1\. Nf3 \{\[%clk 0:01:27\] Draw offered\} 1\.\.\. Nc6 \*/);
  assert.deepEqual(nearbyMoves("Nf5", ["Nf3", "c4", "Nc3", "Nf7"]), ["Nf3", "Nf7"]);
});
