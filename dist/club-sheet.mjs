export const sheetLayouts = {
  club20: { rows: 20, blocks: [[0, 0.26], [0.37, 0.63], [0.74, 1]] },
  club30: { boxed: true, rows: 30, blocks: [[0, 0.47], [0.53, 1]] },
};

export function clubCells({ rows, blocks }, width, height, visibleRows, lastMove, whiteLast) {
  const cells = [];
  for (let block = 0; block < blocks.length; block++) {
    const [start, end] = blocks[block];
    for (let row = 0; row < rows; row++) {
      const move = block * rows + row + 1;
      if (move > lastMove) return cells;
      for (let side = 0; side < 2; side++) {
        if (move === lastMove && side === 1 && whiteLast) return cells;
        if (row >= visibleRows) {
          cells.push(null);
          continue;
        }
        const half = (end - start) / 2;
        cells.push({
          left: (start + side * half) * width,
          right: (start + (side + 1) * half) * width,
          top: row / visibleRows * height,
          bottom: (row + 1) / visibleRows * height,
        });
      }
    }
  }
  return cells;
}

export function refineClubCells(layout, image, visibleRows, lastMove, whiteLast) {
  const { width, height, data } = image;
  const cells = clubCells(layout, width, height, visibleRows, lastMove, whiteLast);
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (2 * data[i * 4] + 5 * data[i * 4 + 1] + data[i * 4 + 2]) / 8;
  }
  const boundaries = new Map();
  const rails = new Map();
  const aligned = cells.map(cell => {
    if (!cell) return cell;
    const { left, right, top } = cell;
    if (layout.boxed) {
      for (const x of [left, right]) {
        if (!rails.has(x)) rails.set(x, traceRail(gray, width, height, x, visibleRows));
      }
    }
    if (!boundaries.has(left)) {
      boundaries.set(left, alignRows(gray, width, height, left, right, visibleRows, layout.boxed));
    }
    const rows = boundaries.get(left);
    const row = Math.round(top * visibleRows / height);
    if (!layout.boxed) return { ...cell, top: rows[row], bottom: rows[row + 1] };
    return {
      left: rails.get(left)[row],
      right: rails.get(right)[row],
      top: rows[row],
      bottom: rows[row + 1],
    };
  });
  if (!layout.boxed || lastMove !== undefined) return aligned;

  // Stop before the blank rows at the end of a game, including any signature below them.
  const occupied = aligned.map(cell => Boolean(cell && hasBoxInk(gray, width, cell)));
  const blankAt = index => Boolean(aligned[index] && !occupied[index]);
  const emptyTail = occupied.findIndex((ink, index) => {
    if (index < 8 || ink || !blankAt(index) || !blankAt(index + 1) || !blankAt(index + 2)) return false;
    if (blankAt(index + 3)) return true;
    return !occupied.slice(index + 3).some((later, offset, rest) => later && rest[offset + 1] && rest[offset + 2]);
  });
  let end = emptyTail < 0 ? aligned.length : emptyTail;
  while (end > 0 && !occupied[end - 1]) end--;
  // A mark in an otherwise empty final row is often a result or a pen stroke
  // from the neighboring cell. Keep clipped slots if that row is off camera.
  if (emptyTail >= 0 && end % 2 === 0 && aligned[end - 2] && !occupied[end - 2]) {
    end -= 2;
    while (end > 0 && !occupied[end - 1]) end--;
  }
  return aligned.slice(0, end);
}

function hasBoxInk(gray, stride, cell) {
  const { left, right, top, bottom } = cell;
  const width = right - left;
  const height = bottom - top;
  const x0 = Math.ceil(left + width * 0.12);
  const x1 = Math.floor(right - width * 0.12);
  const y0 = Math.ceil(top + height * 0.20);
  const y1 = Math.floor(bottom - height * 0.18);
  const radius = Math.max(2, Math.round(height * 0.13));
  if (x1 <= x0 || y1 <= y0) return false;
  const columns = new Uint16Array(x1 - x0);
  let total = 0;
  let usedRows = 0;
  for (let y = y0; y < y1; y++) {
    let row = 0;
    for (let x = x0; x < x1; x++) {
      const index = y * stride + x;
      const across = Math.max(gray[index - radius], gray[index + radius]);
      const verticalRadius = radius * stride;
      const along = Math.max(gray[index - verticalRadius], gray[index + verticalRadius]);
      if (Math.min(across, along) - gray[index] >= 23) {
        row++;
        columns[x - x0]++;
      }
    }
    usedRows += row >= 2;
    total += row;
  }
  const usedColumns = columns.reduce((sum, count) => sum + Number(count >= 2), 0);
  return usedRows >= Math.max(3, height * 0.13)
    && usedColumns >= Math.max(3, width * 0.032)
    && total >= Math.max(9, width * height * 0.0022);
}

function traceRail(gray, width, height, expected, rows) {
  const step = height / rows;
  const radius = Math.max(2, Math.round(width / 210));
  const range = Math.max(3, Math.round(width * 0.027));
  const shiftLimit = Math.max(2, Math.round(width * 0.014));
  let previous = [];
  for (let row = 0; row < rows; row++) {
    const next = [];
    const startY = Math.round(row * step);
    const endY = Math.round((row + 1) * step);
    for (let x = Math.max(radius, Math.round(expected) - range);
      x <= Math.min(width - 1 - radius, Math.round(expected) + range); x++) {
      let support = 0;
      let samples = 0;
      for (let y = startY; y < endY; y += 2) {
        const index = y * width + x;
        const contrast = Math.min(gray[index - radius], gray[index + radius]) - gray[index];
        support += Math.max(0, Math.min(22, contrast));
        samples++;
      }
      const evidence = support / samples - 2 * ((x - expected) / range) ** 2;
      let best = row === 0 ? { x, score: evidence, path: [x] } : undefined;
      for (const entry of previous) {
        const change = x - entry.x;
        if (Math.abs(change) > shiftLimit) continue;
        const score = entry.score + evidence - 3 * (change / shiftLimit) ** 2;
        if (!best || score > best.score) best = { x, score, path: [...entry.path, x] };
      }
      if (best) next.push(best);
    }
    previous = next;
  }
  const best = previous.reduce((best, entry) => !best || entry.score > best.score ? entry : best, null);
  return best?.path ?? Array(rows).fill(expected);
}

function alignRows(gray, width, height, left, right, rows, boxed) {
  const pitch = height / rows;
  const original = Array.from({ length: rows + 1 }, (_, row) => row * pitch);
  if (pitch < 9 || right - left < 15) return original;
  const x0 = Math.round(left + (right - left) * 0.12);
  const x1 = Math.round(right - (right - left) * 0.12);
  const radius = Math.max(2, Math.round(pitch * 0.09));
  const maxShift = Math.round(pitch * (boxed ? 0.46 : 0.72));
  const slope = Math.max(1, Math.round(pitch * 0.12));
  const likelihood = new Map();
  const evidenceAt = y => {
    if (likelihood.has(y)) return likelihood.get(y);
    if (y < radius + slope || y >= height - radius - slope) return 0;
    let best = 0;
    for (const delta of [-slope, 0, slope]) {
      let support = 0;
      let contrast = 0;
      let pixels = 0;
      for (let x = x0; x <= x1; x += 2) {
        const lineY = y + Math.round(delta * (2 * (x - x0) / (x1 - x0) - 1));
        const index = lineY * width + x;
        const darkness = Math.min(gray[index - radius * width], gray[index + radius * width]) - gray[index];
        support += darkness >= 7;
        contrast += Math.max(0, Math.min(28, darkness));
        pixels++;
      }
      best = Math.max(best, (support / pixels) ** 2 * (contrast / pixels));
    }
    likelihood.set(y, best);
    return best;
  };

  let candidates = [{ y: 0, score: 0, path: [0] }];
  for (let row = 1; row <= rows; row++) {
    const target = original[row];
    const next = [];
    for (let y = Math.max(1, Math.round(target) - maxShift); y <= Math.min(height, Math.round(target) + maxShift); y++) {
      let best;
      const evidence = evidenceAt(y) - 1.25 * ((y - target) / pitch) ** 2;
      for (const previous of candidates) {
        const spacing = (y - previous.y) / pitch;
        if (spacing < 0.54 || spacing > 1.45) continue;
        const score = previous.score + evidence - 13 * (spacing - 1) ** 2;
        if (!best || score > best.score) best = { y, score, path: [...previous.path, y] };
      }
      if (best) next.push(best);
    }
    if (!next.length) return original;
    candidates = next;
  }
  return candidates.reduce((best, current) => current.score > best.score ? current : best).path;
}
