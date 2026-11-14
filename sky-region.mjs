// Work on unit vectors so RA wraparound and polar regions need no special cases.
const RAD = Math.PI / 180;
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalize = v => { const length = Math.hypot(...v); return v.map(x => x / length); };
const vector = ([ra, dec]) => [Math.cos(dec*RAD)*Math.cos(ra*RAD), Math.cos(dec*RAD)*Math.sin(ra*RAD), Math.sin(dec*RAD)];
const coordinates = v => [(Math.atan2(v[1], v[0])/RAD + 360)%360, Math.asin(Math.max(-1, Math.min(1, v[2])))/RAD];

function contains(polygon, points) {
  const center = normalize(polygon.reduce((sum, v) => sum.map((n, i) => n + v[i]), [0, 0, 0]));
  return polygon.every((a, i) => {
    const edge = cross(a, polygon[(i + 1) % polygon.length]);
    if (Math.hypot(...edge) < 1e-12) return false;
    const normal = normalize(edge);
    const side = Math.sign(dot(normal, center));
    return side !== 0 && points.every(p => dot(normal, p) * side >= -1e-10);
  });
}

export function regionFromCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some(p =>
    !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n)) ||
    p[0] < 0 || p[0] >= 360 || Math.abs(p[1]) > 90)) {
    throw new Error('The rectangle must have four valid ICRS sky coordinates.');
  }
  const vectors = corners.map(vector);
  const center = normalize(vectors.reduce((sum, v) => sum.map((n, i) => n + v[i]), [0, 0, 0]));
  const radius = Math.max(...vectors.map(v => Math.atan2(Math.hypot(...cross(center, v)), dot(center, v)) / RAD));
  // Circumscribed square fits any detector orientation. Padding accounts for
  // the small TAN projection distortion in a sub-degree region.
  const sizeDegrees = Math.max(0.02, 2 * radius * 1.05);
  if (!Number.isFinite(sizeDegrees) || sizeDegrees > 1) {
    throw new Error('Zoom in and draw a smaller rectangle; the region must fit within 1°.');
  }
  if (radius < 1e-5 || !contains(vectors, vectors)) throw new Error('Draw a rectangle with a non-zero area.');
  const [ra, dec] = coordinates(center);
  return { corners, position: { ra, dec }, sizeDegrees };
}

export function regionFromRectangle(rect, pix2world) {
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(Number.isFinite) || w < 5 || h < 5) {
    throw new Error('Drag a rectangle at least 5 pixels wide and high.');
  }
  const corners = [[x,y], [x+w,y], [x+w,y+h], [x,y+h]].map(([px, py]) => {
    const world = pix2world(px, py, 'ICRS');
    return world && [((world[0] % 360) + 360) % 360, world[1]];
  });
  return regionFromCorners(corners);
}

export function footprintContainsRegion(stcs, corners) {
  if (typeof stcs !== 'string') return false;
  const tokens = stcs.trim().split(/\s+/);
  if (tokens.shift()?.toUpperCase() !== 'POLYGON') return false;
  if (/^(ICRS|J2000)$/i.test(tokens[0])) tokens.shift();
  const values = tokens.map(Number);
  if (values.length < 6 || values.length % 2 || values.some(n => !Number.isFinite(n))) return false;
  const polygon = [];
  for (let i = 0; i < values.length; i += 2) {
    if (Math.abs(values[i+1]) > 90) return false;
    polygon.push([values[i], values[i+1]]);
  }
  if (polygon[0][0] === polygon.at(-1)[0] && polygon[0][1] === polygon.at(-1)[1]) polygon.pop();
  // IRSA models image footprints as spherical convex polygons, not RA/Dec boxes.
  return polygon.length >= 3 && contains(polygon.map(vector), corners.map(vector));
}
