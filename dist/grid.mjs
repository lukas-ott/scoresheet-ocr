function positions(profile, threshold) {
  const peaks = [];
  let start = -1;
  for (let index = 0; index <= profile.length; index++) {
    if (profile[index] >= threshold) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      // Avoid treating large dark regions as ruled lines.
      if (index - start <= 9) peaks.push(Math.floor((start + index - 1) / 2));
      start = -1;
    }
  }
  return peaks;
}

function regularRows(lines) {
  let longest = [];
  for (let start = 0; start + 2 < lines.length; start++) {
    for (let following = start + 1; following < Math.min(lines.length, start + 4); following++) {
      const interval = lines[following] - lines[start];
      if (interval < 8 || interval > 155) continue;
      const selected = [lines[start], lines[following]];
      let gap = interval;
      let previous = lines[following];
      for (let index = following + 1; index < lines.length; index++) {
        const distance = lines[index] - previous;
        const tolerance = Math.max(3, gap * 0.28);
        if (distance < gap - tolerance) continue;
        if (distance > gap + tolerance) break;
        selected.push(lines[index]);
        gap = gap * 0.7 + distance * 0.3;
        previous = lines[index];
      }
      if (selected.length > longest.length) longest = selected;
    }
  }
  return longest.length >= 3 ? longest : [];
}

function identifyColumns(lines) {
  const widths = lines.slice(1).map((edge, index) => edge - lines[index]);
  if (!widths.length) return [];
  const typical = [...widths].sort((a, b) => b - a)[Math.floor(widths.length / 3)];
  const pairs = [];
  for (let index = 0; index < widths.length; index++) {
    const width = widths[index];
    if (width < typical * 0.49) continue;
    const other = widths[index + 1];
    if (width < 25 || !other || Math.abs(width - other) > Math.max(width, other) * 0.26) return [];
    pairs.push([lines[index], lines[index + 1], lines[index + 2]]);
    index++;
    // A separator distinguishes parallel move blocks from extra columns.
    if (index + 1 < widths.length && widths[index + 1] >= typical * 0.49) return [];
  }
  return pairs;
}

function hasInk(gray, stride, left, top, right, bottom) {
  const width = right - left;
  const height = bottom - top;
  const marginX = Math.max(4, Math.round(width * 0.075));
  const marginY = Math.max(3, Math.round(height * 0.19));
  const radius = Math.max(3, Math.round(height * 0.11));
  let strokes = 0;
  for (let y = top + marginY; y < bottom - marginY; y++) {
    let contrast = 0;
    for (let x = left + marginX; x < right - marginX; x++) {
      const at = y * stride + x;
      const background = Math.max(gray[at - radius], gray[at + radius]);
      if (gray[at] < background - 25) contrast++;
    }
    if (contrast < width * 0.45) strokes += contrast;
  }
  return strokes >= Math.max(7, width * height * 0.0022);
}

function profileLines(gray, width, height, from, to, vertical) {
  const sweep = vertical ? width : height;
  const profile = new Uint32Array(sweep);
  for (let line = 0; line < sweep; line++) {
    for (let at = from; at < to; at++) {
      const value = vertical ? gray[at * width + line] : gray[line * width + at];
      if (value < 157) profile[line]++;
    }
  }
  return positions(profile, (to - from) * (vertical ? 0.56 : 0.70));
}

function numberStrip(gray, width, height, start, end) {
  const gap = end - start;
  let best = 8;
  let boundary;
  for (let x = start + Math.round(gap * 0.09); x < start + gap * 0.32; x++) {
    let difference = 0;
    let count = 0;
    for (let y = Math.round(height * 0.16); y < height * 0.88; y += 5) {
      const before = gray[y * width + x - 8];
      const after = gray[y * width + x + 8];
      if (before > 110 && after > 145) {
        difference += Math.max(-50, Math.min(50, after - before));
        count++;
      }
    }
    if (count > height / 14 && difference / count > best) {
      best = difference / count;
      boundary = x;
    }
  }
  return boundary;
}

function findColumns(gray, width, height) {
  // Short projection windows tolerate a small amount of skew in photographed pages.
  for (const center of [0.5, 0.25, 0.75]) {
    const lines = profileLines(gray, width, height, Math.round(height * (center - 0.075)),
      Math.round(height * (center + 0.075)), true);
    const columns = identifyColumns(lines);
    if (columns.length) return columns.map(([left, middle, right]) => [[left, middle], [middle, right]]);
    if (lines.length !== 5) continue;
    const widths = lines.slice(1).map((edge, index) => edge - lines[index]);
    if (Math.min(...widths) < Math.max(...widths) * 0.85) continue;
    const firstStrip = numberStrip(gray, width, height, lines[0], lines[1]);
    const secondStrip = numberStrip(gray, width, height, lines[2], lines[3]);
    if (firstStrip && secondStrip) {
      return [[[firstStrip, lines[1]], [lines[1], lines[2]]],
        [[secondStrip, lines[3]], [lines[3], lines[4]]]];
    }
  }
  return [];
}

function findRows(gray, width, height, left, right) {
  const span = right - left;
  const radius = Math.max(0.077, Math.min(0.25, 14 / span));
  let best = [];
  for (const position of [0.48, 0.62, 0.35]) {
    const lines = profileLines(gray, width, height, Math.round(left + span * (position - radius)),
      Math.round(left + span * (position + radius)), false);
    const rows = regularRows(lines);
    if (rows.length > best.length) best = rows;
  }
  return best;
}

function syncRows(first, second) {
  if (Math.min(first.length, second.length) < 3 || Math.abs(first.length - second.length) > 1) return [];
  const count = Math.max(first.length, second.length);
  const offsetA = count - first.length;
  const offsetB = count - second.length;
  const tail = Array.from({ length: count - 1 }, (_, index) => [
    first[index + 1 - offsetA], second[index + 1 - offsetB],
  ]);
  const interval = (tail.at(-1)[0] - tail[0][0]) / (tail.length - 1);
  if (tail.some(([a, b]) => Math.abs(a - b) > interval * 0.40)) return [];
  const drift = tail[0][1] - tail[0][0];
  let topA = offsetA ? Math.max(0, second[0] - drift) : first[0];
  let topB = offsetB ? Math.max(0, topA + drift) : second[0];
  if (Math.abs(topA - topB) > interval * 0.37) {
    // Headers can obscure the top border in one side of the first move.
    const [nextA, nextB] = tail[0];
    if (Math.abs(nextA - topA - interval) < Math.abs(nextB - topB - interval)) {
      topB = Math.max(0, topA + drift);
    } else {
      topA = Math.max(0, topB - drift);
    }
  }
  if (tail[0][0] - topA < interval * 0.55 || tail[0][1] - topB < interval * 0.55) return [];
  return [[topA, topB], ...tail];
}

export function detectGrid({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index++) {
    const pixel = index * 4;
    gray[index] = (data[pixel] * 2 + data[pixel + 1] * 5 + data[pixel + 2]) / 8;
  }
  const panels = findColumns(gray, width, height);
  const cells = [];
  for (const panel of panels) {
    const rows = panel.map(([left, right]) => findRows(gray, width, height, left, right));
    const boundaries = syncRows(...rows);
    if (boundaries.length < 3) return [];
    for (let row = 0; row < boundaries.length - 1; row++) {
      panel.forEach(([left, right], column) => {
        const top = boundaries[row][column];
        const bottom = boundaries[row + 1][column];
        cells.push({ left, top, right, bottom, ink: hasInk(gray, width, left, top, right, bottom) });
      });
    }
  }
  return trimEmptyEnd(cells);
}

function trimEmptyEnd(cells) {
  let end = cells.length;
  while (end > 0 && !cells[end - 1].ink) end--;
  // A gap followed by isolated marks is common where results are scribbled
  // in the unused cells. Keep interior gaps when a move sequence resumes.
  let lastSequenceEnd = 0;
  let streak = 0;
  for (let index = 0; index < end; index++) {
    streak = cells[index].ink ? streak + 1 : 0;
    if (streak >= 4) lastSequenceEnd = index + 1;
  }
  for (let index = lastSequenceEnd; lastSequenceEnd && index + 4 <= end; index++) {
    if (cells.slice(index, index + 4).every(cell => !cell.ink)) {
      end = index;
      while (end > 0 && !cells[end - 1].ink) end--;
      break;
    }
  }
  return cells.slice(0, end);
}
