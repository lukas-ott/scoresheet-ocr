import { blockProjection, straightenBlock } from "./perspective.mjs";

const panelEdges = [0, 0.235, 0.47, 0.53, 0.765, 1];
const moveColumns = [[0, 1], [1, 2], [3, 4], [4, 5]];

function grayPixels({ width, height, data }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (2 * data[i * 4] + 5 * data[i * 4 + 1] + data[i * 4 + 2]) / 8;
  }
  return gray;
}

function horizontalEvidence(gray, width, height, left, right, radius) {
  const profile = new Float32Array(height);
  const step = Math.max(1, Math.floor((right - left) / 30));
  for (let y = radius; y < height - radius; y++) {
    let sum = 0;
    let count = 0;
    let support = 0;
    for (let x = left; x < right; x += step) {
      const index = y * width + x;
      const contrast = Math.min(gray[index - width * radius], gray[index + width * radius]) - gray[index];
      sum += Math.max(0, Math.min(28, contrast));
      support += contrast >= 6;
      count++;
    }
    profile[y] = support / count * sum / count;
  }
  return profile;
}

function peaks(profile, center, tolerance) {
  let score = 0;
  let line = center;
  for (let y = Math.max(0, Math.round(center - tolerance)); y <= Math.min(profile.length - 1, Math.round(center + tolerance)); y++) {
    const evidence = profile[y] - 0.12 * Math.abs(center - y);
    if (evidence > score) {
      score = evidence;
      line = y;
    }
  }
  return { line, score };
}

function rowLattice(profiles, height, rows, guess) {
  let best;
  const lowPitch = guess ? guess.pitch * 0.91 : height * 0.36 / rows;
  const highPitch = guess ? guess.pitch * 1.09 : height * 0.98 / rows;
  const step = Math.max(0.30, height / 1750);
  const tolerance = Math.max(2, height / 145);
  for (let pitch = lowPitch; pitch <= highPitch; pitch += step) {
    const lower = guess ? guess.start - guess.pitch * 0.90 : 0;
    const upper = guess ? guess.start + guess.pitch * 0.90 : height - pitch * rows;
    for (let start = Math.max(0, lower); start <= Math.min(height - pitch * rows + tolerance, upper); start += Math.max(1, pitch / 12)) {
      if (guess && Math.abs(start + rows * pitch - guess.start - rows * guess.pitch) > guess.pitch * 0.88) continue;
      let score = 0;
      let supported = 0;
      for (let row = 0; row <= rows; row++) {
        let support = 0;
        for (const profile of profiles) {
          const strength = peaks(profile, start + pitch * row, Math.min(pitch * 0.23, tolerance)).score;
          support += strength >= 2.8;
          score += Math.min(14, strength);
        }
        supported += support >= 2;
      }
      if (!guess && supported < rows * 0.88) continue;
      let earlier = 0;
      let later = 0;
      for (const profile of profiles) {
        earlier += Math.min(12, peaks(profile, start - pitch, pitch * 0.23).score);
        later += Math.min(12, peaks(profile, start + pitch * (rows + 1), pitch * 0.23).score);
      }
      if (!guess && (earlier > 22 || later > 22)) continue;
      if (!guess) score -= 1.8 * earlier + 3.6 * later;
      if (guess && earlier > 28 && later > 28) score -= 65;
      if (guess) {
        const deviation = Math.abs(start - guess.start) + Math.abs(start + rows * pitch - guess.start - rows * guess.pitch);
        score -= 20 * deviation / guess.pitch;
      }
      if (!best || score > best.score) best = { score, start, pitch, supported };
    }
  }
  return best;
}

function ruledProfiles(gray, width, height, edges) {
  return moveColumns.map(([left, right]) => {
    const span = edges[right] - edges[left];
    return horizontalEvidence(gray, width, height, Math.round(edges[left] + span * 0.26),
      Math.round(edges[right] - span * 0.26), Math.max(2, Math.round(height / 410)));
  });
}

function verticalCandidates(gray, width, height) {
  const candidates = [];
  const from = Math.round(height * 0.27);
  const to = Math.round(height * 0.73);
  const middle = (from + to) / 2;
  const radius = Math.max(2, Math.round(width / 145));
  for (let slope = -0.32; slope <= 0.321; slope += 0.02) {
    const profile = new Float32Array(width);
    for (let center = radius; center < width - radius; center++) {
      let count = 0;
      let support = 0;
      for (let y = from; y <= to; y += 3) {
        const x = center + Math.round((y - middle) * slope);
        if (x < radius || x >= width - radius) continue;
        const index = y * width + x;
        const contrast = Math.min(gray[index - radius], gray[index + radius]) - gray[index];
        support += Math.max(0, Math.min(22, contrast));
        count++;
      }
      if (count * 3 > (to - from) * 0.85) profile[center] = support / count;
    }
    for (let x = radius + 1; x < width - radius - 1; x++) {
      if (profile[x] >= 4 && profile[x] >= profile[x - 1] && profile[x] > profile[x + 1]) {
        candidates.push({ x, slope, score: profile[x] });
      }
    }
  }
  const unique = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (unique.some(line => Math.abs(line.x - candidate.x) < width * 0.013)) continue;
    unique.push(candidate);
    if (unique.length === 32) break;
  }
  return { unique, middle };
}

function tableRails(gray, width, height) {
  const { unique, middle } = verticalCandidates(gray, width, height);
  const fits = [];
  for (const left of unique) {
    for (const right of unique) {
      const span = right.x - left.x;
      if (span < width * 0.25 || span > width * 0.98 || Math.abs(right.slope - left.slope) > 0.26) continue;
      const rails = panelEdges.map(fraction => {
        const x = left.x + fraction * span;
        const slope = left.slope + fraction * (right.slope - left.slope);
        let best;
        for (const candidate of unique) {
          if (Math.abs(candidate.x - x) > span * 0.034 || Math.abs(candidate.slope - slope) > 0.095) continue;
          const score = candidate.score - 110 * Math.abs(candidate.x - x) / span;
          if (!best || score > best.score) best = { score, line: candidate };
        }
        return best;
      });
      if (rails.filter(Boolean).length < 5 || !rails[1] || !rails[4]) continue;
      const score = rails.reduce((sum, rail) => sum + (rail?.score ?? -4), 0);
      fits.push({ left, right, middle, score });
    }
  }
  return fits.sort((a, b) => b.score - a.score).slice(0, 6);
}

// Search the entire photo at a smaller scale, then return coordinates in the original image.
export function findBoxedTable(image) {
  const factor = Math.min(1, 460 / Math.max(image.width, image.height));
  const width = Math.round(image.width * factor);
  const height = Math.round(image.height * factor);
  if (width < 90 || height < 170) return;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = Math.round(x * (image.width - 1) / (width - 1));
      const sourceY = Math.round(y * (image.height - 1) / (height - 1));
      const source = (sourceY * image.width + sourceX) * 4;
      gray[y * width + x] = (2 * image.data[source] + 5 * image.data[source + 1] + image.data[source + 2]) / 8;
    }
  }
  let best;
  for (const { left, right, middle, score } of tableRails(gray, width, height)) {
    const xAt = (line, y) => line.x + (y - middle) * line.slope;
    const stripWidth = right.x - left.x;
    if (stripWidth < width * 0.70) continue;
    const topSpan = xAt(right, 0) - xAt(left, 0);
    const bottomSpan = xAt(right, height) - xAt(left, height);
    if (Math.min(topSpan, bottomSpan) < stripWidth * 0.70) continue;
    const projectY = z => {
      const ratio = z / height;
      return height * ratio * topSpan / (bottomSpan + (topSpan - bottomSpan) * ratio);
    };
    const strip = new Uint8Array(stripWidth * height);
    for (let y = 0; y < height; y++) {
      const sourceY = Math.min(height - 1, Math.round(projectY(y)));
      const startX = xAt(left, sourceY);
      const endX = xAt(right, sourceY);
      for (let x = 0; x < stripWidth; x++) {
        const sourceX = Math.round(startX + x * (endX - startX) / stripWidth);
        strip[y * stripWidth + x] = sourceX >= 0 && sourceX < width ? gray[sourceY * width + sourceX] : 255;
      }
    }
    const lattice = rowLattice(ruledProfiles(strip, stripWidth, height, panelEdges.map(x => x * stripWidth)), height, 30);
    if (!lattice || lattice.pitch * 30 < height * 0.78) continue;
    const start = projectY(lattice.start);
    const end = projectY(lattice.start + 30 * lattice.pitch);
    if (start > height * 0.13 || end < height * 0.87) continue;
    const fit = lattice.score + score * 7;
    if (best && fit <= best.score) continue;
    best = {
      score: fit,
      corners: [[left, start], [right, start], [right, end], [left, end]]
        .map(([line, y]) => ({ x: xAt(line, y) / factor, y: y / factor })),
    };
  }
  return best?.corners;
}

// Pad the marked outline so a line a little outside the taps can still be found.
export function locateMoveBoxes(input, corners, rows) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 30) return;
  const rough = blockProjection(corners);
  if (!rough) return;
  const paddingX = 0.035;
  const paddingY = 1.9 / rows;
  const paddedCorners = [[-paddingX, -paddingY], [1 + paddingX, -paddingY],
    [1 + paddingX, 1 + paddingY], [-paddingX, 1 + paddingY]].map(([x, y]) => rough.project(x, y));
  const warp = blockProjection(paddedCorners);
  if (!warp) return;
  const { width, height } = warp;
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  straightenBlock(input, image, warp);
  const gray = grayPixels(image);
  const edges = panelEdges.map(x => (x + paddingX) / (1 + 2 * paddingX) * width);
  const start = paddingY / (1 + 2 * paddingY) * height;
  const pitch = (height - 2 * start) / rows;
  const lattice = rowLattice(ruledProfiles(gray, width, height, edges), height, rows, { start, pitch });
  if (!lattice || lattice.supported < rows * 0.80) return;
  return { gray, warp, edges, lattice };
}

function traceVertical(gray, width, height, expected, pitch, center, tolerance) {
  const radius = Math.max(2, Math.round(width / 205));
  let best = { x: expected, score: 0 };
  for (let x = Math.max(radius, Math.round(expected - tolerance)); x <= Math.min(width - radius - 1, Math.round(expected + tolerance)); x++) {
    let evidence = 0;
    let support = 0;
    let count = 0;
    for (let y = Math.max(0, Math.round(center - 2 * pitch)); y <= Math.min(height - 1, center + 2 * pitch); y += 2) {
      const index = y * width + x;
      const contrast = Math.min(gray[index - radius], gray[index + radius]) - gray[index];
      evidence += Math.max(0, Math.min(26, contrast));
      support += contrast >= 8;
      count++;
    }
    if (support < count * 0.34) continue;
    const score = evidence / count - 4 * ((x - expected) / tolerance) ** 2;
    if (score > best.score) best = { x, score };
  }
  return best.x;
}

function traceRowCenters(profile, rows, { start, pitch }, followEdges = false) {
  // Follow a run of rules together. An isolated pen stroke must not move a
  // boundary by a whole row, or the two neighboring move crops overlap.
  let previous = [{ line: start - pitch, cost: 0, path: [] }];
  for (let row = 0; row <= rows; row++) {
    const search = Math.round(pitch * (followEdges && row > 0 ? 0.90 : 0.59));
    const expected = start + row * pitch;
    const next = [];
    const minimum = Math.max(0, Math.round(expected) - search);
    const maximum = Math.min(profile.length - 1, Math.round(expected) + search);
    for (let line = minimum; line <= maximum; line++) {
      let best;
      const offset = (line - expected) / pitch;
      const evidence = Math.min(18, profile[line]) - 3 * offset ** 2;
      for (const parent of previous) {
        const gap = (line - parent.line) / pitch;
        if (gap < 0.58 || gap > 1.42) continue;
        const cost = parent.cost + evidence - (followEdges ? 48 : 24) * (gap - 1) ** 2;
        if (!best || cost > best.cost) best = { line, cost, path: [...parent.path, line] };
      }
      if (best) next.push(best);
    }
    if (!next.length) return Array.from({ length: rows + 1 }, (_, index) => start + index * pitch);
    previous = next;
  }
  return previous.reduce((best, candidate) => candidate.cost > best.cost ? candidate : best).path;
}

function refineRowSpacing(profile, rows, lattice) {
  const centers = traceRowCenters(profile, rows, lattice);
  const first = Math.ceil(rows * 0.12);
  const last = Math.floor(rows * 0.78);
  const anchors = centers.map((line, row) => ({ line, row }))
    .filter(({ line, row }) => row >= first && row <= last && profile[line] >= 4);
  if (anchors.length < rows * 0.35) return lattice;

  const slopes = [];
  for (const [index, a] of anchors.entries()) {
    for (const b of anchors.slice(index + 1)) {
      if (b.row - a.row >= rows * 0.25) slopes.push((b.line - a.line) / (b.row - a.row));
    }
  }
  if (!slopes.length) return lattice;
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const pitch = median(slopes);
  const start = median(anchors.map(({ line, row }) => line - row * pitch));
  if (Math.abs(start - lattice.start) > lattice.pitch * 0.65 || Math.abs(pitch / lattice.pitch - 1) > 0.06) return lattice;
  return { start, pitch };
}

function traceColumnRows(gray, width, height, left, right, rows, { start, pitch }) {
  const span = right - left;
  const radius = Math.max(2, Math.round(pitch * 0.12));
  const first = horizontalEvidence(gray, width, height, Math.round(left + span * 0.14),
    Math.round(left + span * 0.46), radius);
  const last = horizontalEvidence(gray, width, height, Math.round(left + span * 0.54),
    Math.round(left + span * 0.86), radius);
  const middle = horizontalEvidence(gray, width, height, Math.round(left + span * 0.19),
    Math.round(left + span * 0.81), radius);
  return traceRowCenters(middle, rows, refineRowSpacing(middle, rows, { start, pitch }), true).map(center => {
    const leftLine = peaks(first, center, pitch * 0.20);
    const rightLine = peaks(last, center, pitch * 0.20);
    const leftY = leftLine.score >= 2.5 ? leftLine.line : center;
    const rightY = rightLine.score >= 2.5 ? rightLine.line : center;
    const skew = Math.max(-pitch * 0.16, Math.min(pitch * 0.16, (rightY - leftY) * 0.75));
    const average = (leftY + rightY) / 2;
    return [average - skew, average + skew];
  });
}

// Return one quadrilateral per cell, ordered White/Black down each panel.
export function buildMoveBoxes({ gray, warp, edges, lattice }, rows) {
  const { width, height } = warp;
  const railOffsets = edges.map((edge, index) => {
    const gap = Math.min(edge - (edges[index - 1] ?? -Infinity), (edges[index + 1] ?? Infinity) - edge);
    return Array.from({ length: rows + 1 }, (_, row) => traceVertical(gray, width, height, edge, lattice.pitch,
      lattice.start + row * lattice.pitch, Math.min(width * 0.037, gap * 0.43)));
  });
  const columnRows = moveColumns.map(([left, right]) => traceColumnRows(gray, width, height,
    edges[left], edges[right], rows, lattice));
  return Array.from({ length: 120 }, (_, index) => {
    const panel = Math.floor(index / 60);
    const row = Math.floor(index % 60 / 2);
    if (row >= rows) return null;
    const column = panel * 2 + index % 2;
    const [left, right] = moveColumns[column];
    const horizontal = columnRows[column];
    const [topLeft, topRight] = horizontal[row];
    const [bottomLeft, bottomRight] = horizontal[row + 1];
    const top = lattice.start + row * lattice.pitch;
    const bottom = top + lattice.pitch;
    const y = bottomLeft - topLeft > lattice.pitch * 0.50 && bottomRight - topRight > lattice.pitch * 0.50
      ? [topLeft, topRight, bottomRight, bottomLeft]
      : [top, top, bottom, bottom];
    const box = [railOffsets[left][row], railOffsets[right][row], railOffsets[right][row + 1],
      railOffsets[left][row + 1]].map((x, corner) => ({ x, y: y[corner] }));
    const exterior = box.map(point => warp.project(point.x / width, point.y / height));
    return {
      left: Math.min(box[0].x, box[3].x),
      right: Math.max(box[1].x, box[2].x),
      top: Math.min(y[0], y[1]),
      bottom: Math.max(y[2], y[3]),
      corners: exterior,
    };
  });
}
