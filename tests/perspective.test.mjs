import assert from "node:assert/strict";
import test from "node:test";
import { blockProjection, straightenBlock } from "../dist/perspective.mjs";

const corners = [
  { x: 22, y: 13 }, { x: 98, y: 25 }, { x: 116, y: 103 }, { x: 9, y: 88 },
];

test("straightens angled rows and preserves their reading order", () => {
  const projection = blockProjection(corners);
  const marked = { width: 130, height: 115, data: new Uint8ClampedArray(130 * 115 * 4).fill(255) };
  // Place a distinct mark at the center of each photographed cell.
  for (const [u, v, color] of [[0.25, 0.25, 30], [0.75, 0.25, 65], [0.25, 0.75, 100], [0.75, 0.75, 135]]) {
    const point = projection.project(u, v);
    for (let y = Math.round(point.y) - 2; y <= Math.round(point.y) + 2; y++) {
      for (let x = Math.round(point.x) - 2; x <= Math.round(point.x) + 2; x++) {
        marked.data[(y * marked.width + x) * 4] = color;
      }
    }
  }
  const straight = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  straightenBlock(marked, straight, projection);
  const red = (x, y) => straight.data[(y * straight.width + x) * 4];
  assert.deepEqual([red(16, 16), red(48, 16), red(16, 48), red(48, 48)], [30, 65, 100, 135]);
  assert.equal(red(32, 32), 255);
});

test("rejects crossed corners and preserves all four corners of a trapezoid", () => {
  const projection = blockProjection(corners);
  const endpoints = [[0, 0], [1, 0], [1, 1], [0, 1]];
  endpoints.forEach(([u, v], index) => {
    const { x, y } = projection.project(u, v);
    assert.ok(Math.hypot(x - corners[index].x, y - corners[index].y) < 1e-7);
  });
  assert.equal(blockProjection([corners[0], corners[2], corners[1], corners[3]]), undefined);
});
