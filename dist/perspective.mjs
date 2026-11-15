export function blockProjection(corners) {
  if (corners.length !== 4) return;
  for (let index = 0; index < 4; index++) {
    const a = corners[index];
    const b = corners[(index + 1) % 4];
    const c = corners[(index + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 16) return;
  }
  const [a, b, c, d] = corners;
  const x1 = b.x - c.x;
  const x2 = d.x - c.x;
  const y1 = b.y - c.y;
  const y2 = d.y - c.y;
  const dx = a.x - b.x + c.x - d.x;
  const dy = a.y - b.y + c.y - d.y;
  const det = x1 * y2 - x2 * y1;
  const g = (dx * y2 - x2 * dy) / det;
  const h = (x1 * dy - dx * y1) / det;
  const distance = (first, second) => Math.hypot(second.x - first.x, second.y - first.y);
  const width = Math.round(Math.max(distance(a, b), distance(d, c)));
  const height = Math.round(Math.max(distance(a, d), distance(b, c)));
  if (width < 12 || height < 12) return;
  return {
    width, height,
    project(u, v) {
      const scale = 1 + g * u + h * v;
      return {
        x: (a.x + u * (b.x * (1 + g) - a.x) + v * (d.x * (1 + h) - a.x)) / scale,
        y: (a.y + u * (b.y * (1 + g) - a.y) + v * (d.y * (1 + h) - a.y)) / scale,
      };
    },
  };
}

export function straightenBlock(input, output, projection) {
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const point = projection.project((x + 0.5) / output.width, (y + 0.5) / output.height);
      const sourceX = Math.min(input.width - 1, Math.max(0, point.x - 0.5));
      const sourceY = Math.min(input.height - 1, Math.max(0, point.y - 0.5));
      const left = Math.floor(sourceX);
      const top = Math.floor(sourceY);
      const right = Math.min(left + 1, input.width - 1);
      const bottom = Math.min(top + 1, input.height - 1);
      const fx = sourceX - left;
      const fy = sourceY - top;
      const offset = (y * output.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const above = input.data[(top * input.width + left) * 4 + channel] * (1 - fx)
          + input.data[(top * input.width + right) * 4 + channel] * fx;
        const below = input.data[(bottom * input.width + left) * 4 + channel] * (1 - fx)
          + input.data[(bottom * input.width + right) * 4 + channel] * fx;
        output.data[offset + channel] = above * (1 - fy) + below * fy;
      }
    }
  }
}
