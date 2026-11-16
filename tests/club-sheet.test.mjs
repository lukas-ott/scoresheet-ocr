import assert from "node:assert/strict";
import test from "node:test";
import { clubCells, sheetLayouts } from "../dist/club-sheet.mjs";

test("three-block sheets read down each block, then across to the next", () => {
  const cells = clubCells(sheetLayouts.club20, 1000, 800, 20, 43, true);
  assert.equal(cells.length, 85);
  assert.equal(cells[40].left, 370);
  assert.equal(cells[80].left, 740);
  assert.equal(cells[84].top, 80);
});

test("two-block sheets retain slots for clipped rows before entering block two", () => {
  const cells = clubCells(sheetLayouts.club30, 1000, 580, 29, 32, false);
  assert.equal(cells.length, 64);
  assert.deepEqual(cells.slice(58, 60), [null, null]);
  assert.equal(cells[60].left, 530);
  assert.equal(cells[60].top, 0);
  assert.equal(cells[62].top, 20);
});

test("row alignment follows photographed rules that drift inside the crop", async () => {
  const { refineClubCells } = await import("../dist/club-sheet.mjs");
  const width = 300;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const y of [26, 57, 89, 119]) {
    for (let x = 25; x < 275; x++) data.fill(55, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  const cells = refineClubCells({ rows: 4, blocks: [[0, 1]] }, { width, height, data }, 4, 4, false);
  assert.deepEqual(cells.filter((_, i) => i % 2 === 0).slice(0, 3).map(cell => cell.bottom), [26, 57, 89]);
});

test("Two-panel alignment follows curved dividers and skips isolated marks after the game", async () => {
  const { refineClubCells } = await import("../dist/club-sheet.mjs");
  const width = 400;
  const height = 600;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const mark = (x, y) => data.fill(45, (y * width + x) * 4, (y * width + x) * 4 + 3);
  for (let y = 0; y < height; y++) {
    const divider = 94 + Math.round(8 * Math.sin(Math.PI * y / height));
    mark(divider, y);
    mark(306, y);
    if (y % 20 === 0) for (let x = 0; x < width; x++) mark(x, y);
  }
  const moveStroke = (x, y) => {
    for (let dy = 0; dy < 9; dy++) {
      const bend = Math.floor(dy / 3);
      mark(x + bend, y + dy);
      mark(x + bend + 1, y + dy);
    }
  };
  for (let row = 0; row < 30; row++) {
    moveStroke(38, row * 20 + 6);
    moveStroke(132, row * 20 + 6);
  }
  moveStroke(249, 6);
  moveStroke(342, 6);
  moveStroke(249, 26);
  for (let row = 6; row < 11; row++) {
    moveStroke(249, row * 20 + 6);
    moveStroke(342, row * 20 + 6);
  }

  const image = { width, height, data };
  const cells = refineClubCells(sheetLayouts.club30, image, 30);
  assert.equal(cells.length, 63);
  assert.equal(cells[30].right, 102);
  assert.equal(cells[60].top, 0);
  assert.equal(refineClubCells(sheetLayouts.club30, image, 30, 33, false).length, 66);
});
