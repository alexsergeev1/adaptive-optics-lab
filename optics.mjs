export const SIZE = 256;
const RADIUS = 42;
const TAU = 2 * Math.PI;

// Tip, tilt, focus, two astigmatism terms, then uncorrectable higher orders.
const modes = [
  (x) => 2 * x,
  (_, y) => 2 * y,
  (x, y) => Math.sqrt(3) * (2 * (x * x + y * y) - 1),
  (x, y) => Math.sqrt(6) * (x * x - y * y),
  (x, y) => Math.sqrt(6) * 2 * x * y,
  (x, y) => Math.sqrt(8) * x * (3 * (x * x + y * y) - 2),
  (x, y) => Math.sqrt(8) * y * (3 * (x * x + y * y) - 2),
  (x, y) => Math.sqrt(8) * x * (x * x - 3 * y * y),
  (x, y) => Math.sqrt(5) * (6 * (x * x + y * y) ** 2 - 6 * (x * x + y * y) + 1),
];
const amplitudes = [0.95, 0.85, 1.5, 1.25, 1.08, 0.10, 0.09, 0.08, 0.075];
const frequencies = [1.0, 1.2, 0.48, 0.62, 0.79, 1.41, 1.23, 1.66, 1.82];
const offsets = [0.9, 2.1, 1.3, 1.6, 0.4, 0.8, 2.3, 1.2, 2.2];

export function disturbance(time, strength, profile = "rolling") {
  const gust = profile === "gusts" ? 0.62 + 0.72 * Math.sin(0.77 * time + 0.55) ** 8 : 1;
  const screen = amplitudes.map((amplitude, i) =>
    strength * gust * amplitude * (Math.sin(time * frequencies[i] + offsets[i]) +
      0.18 * Math.sin(time * frequencies[i] * 2.3 + i)));
  if (profile === "vibration") {
    screen[0] += strength * 1.3 * Math.sin(5.4 * time + 0.8);
    screen[1] += strength * 0.8 * Math.sin(4.3 * time + 0.5);
  }
  return screen;
}

export const lenslets = [];
for (let y = -0.72; y <= 0.73; y += 0.24) {
  for (let x = -0.72; x <= 0.73; x += 0.24) {
    if (Math.hypot(x, y) < 0.84) lenslets.push([x, y]);
  }
}

// Calibrate mean local slopes by poking each modal mirror command.
const interaction = lenslets.flatMap(([x, y]) => [0, 1].map((axis) =>
  modes.map((mode) => {
    let sum = 0;
    for (const dx of [-0.06, 0, 0.06]) {
      for (const dy of [-0.06, 0, 0.06]) {
        const sx = x + dx, sy = y + dy;
        sum += axis === 0
          ? (mode(sx + 0.001, sy) - mode(sx - 0.001, sy)) / 0.002
          : (mode(sx, sy + 0.001) - mode(sx, sy - 0.001)) / 0.002;
      }
    }
    return sum / 9;
  })));

function dot(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function calibrate(count) {
  const columns = Array.from({ length: count }, (_, i) => interaction.map((row) => row[i]));
  const matrix = columns.map((column, i) => [
    ...columns.map((other, j) => dot(column, other) + (i === j ? 0.015 : 0)),
    ...column,
  ]);
  for (let i = 0; i < count; i++) {
    const pivot = matrix[i][i];
    matrix[i] = matrix[i].map((value) => value / pivot);
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      const scale = matrix[j][i];
      matrix[j] = matrix[j].map((value, k) => value - scale * matrix[i][k]);
    }
  }
  return matrix.map((row) => row.slice(count));
}

const reconstructors = { 0: [], 2: calibrate(2), 5: calibrate(5) };

export function sense(coefficients) {
  return interaction.map((row) => dot(row, coefficients));
}

export function updateMirror(atmosphere, previous, count) {
  return correctSlopes(sense(residualPhase(atmosphere, previous)), previous, count);
}

function correctSlopes(slopes, previous, count) {
  return reconstructors[count].map((row, i) => {
    const command = (previous[i] ?? 0) + 0.52 * dot(row, slopes);
    return Math.max(-6, Math.min(6, command));
  });
}

export function createMirrorLoop() {
  const pending = [];
  let commands = [];
  let previousMode = 0;
  let previousDelay = 0;
  return {
    reset() {
      commands = [];
      pending.length = 0;
    },
    step(atmosphere, mode, delay) {
      if (mode !== previousMode || delay !== previousDelay) {
        pending.length = 0;
        commands = commands.slice(0, mode);
        previousMode = mode;
        previousDelay = delay;
      }
      const slopes = sense(residualPhase(atmosphere, commands));
      pending.push(slopes);
      if (pending.length > delay) commands = correctSlopes(pending.shift(), commands, mode);
      return commands;
    },
  };
}

export function residualPhase(atmosphere, mirror) {
  return atmosphere.map((value, i) => value - (mirror[i] ?? 0));
}

const bitReversed = new Uint16Array(SIZE);
for (let i = 1; i < SIZE; i++) bitReversed[i] = (bitReversed[i >> 1] >> 1) | ((i & 1) * (SIZE / 2));
const cos = Float64Array.from({ length: SIZE / 2 }, (_, i) => Math.cos(TAU * i / SIZE));
const sin = Float64Array.from({ length: SIZE / 2 }, (_, i) => Math.sin(TAU * i / SIZE));

function fftLine(real, imag, offset, stride, inverse) {
  for (let i = 0; i < SIZE; i++) {
    const j = bitReversed[i];
    if (i >= j) continue;
    const a = offset + i * stride, b = offset + j * stride;
    [real[a], real[b]] = [real[b], real[a]];
    [imag[a], imag[b]] = [imag[b], imag[a]];
  }
  for (let span = 2; span <= SIZE; span *= 2) {
    const half = span / 2, increment = SIZE / span;
    for (let base = 0; base < SIZE; base += span) {
      for (let j = 0; j < half; j++) {
        const a = offset + (base + j) * stride, b = a + half * stride;
        const c = cos[j * increment], s = (inverse ? 1 : -1) * sin[j * increment];
        const r = real[b] * c - imag[b] * s, v = real[b] * s + imag[b] * c;
        real[b] = real[a] - r;
        imag[b] = imag[a] - v;
        real[a] += r;
        imag[a] += v;
      }
    }
  }
}

function fft(real, imag, inverse = false) {
  for (let i = 0; i < SIZE; i++) fftLine(real, imag, i * SIZE, 1, inverse);
  for (let i = 0; i < SIZE; i++) fftLine(real, imag, i, SIZE, inverse);
}

const area = SIZE * SIZE;
const pupil = [];
for (let dy = -RADIUS; dy <= RADIUS; dy++) {
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    const x = dx / RADIUS, y = dy / RADIUS;
    if (x * x + y * y > 1) continue;
    const index = (dy + SIZE / 2) * SIZE + dx + SIZE / 2;
    pupil.push({ index, basis: modes.map((mode) => mode(x, y)) });
  }
}

export function phaseAt(x, y, coefficients) {
  return coefficients.reduce((phase, value, i) => phase + value * modes[i](x, y), 0);
}

export function createCamera(target) {
  const objectReal = Float64Array.from(target), objectImag = new Float64Array(area);
  const real = new Float64Array(area), imag = new Float64Array(area);
  const psf = new Float64Array(area);
  fft(objectReal, objectImag);
  const idealPeak = pupil.length / area;

  return function expose(coefficients) {
    real.fill(0);
    imag.fill(0);
    let phaseSum = 0, phaseSquares = 0;
    for (const { index, basis } of pupil) {
      const phase = dot(basis, coefficients);
      real[index] = Math.cos(phase);
      imag[index] = Math.sin(phase);
      phaseSum += phase;
      phaseSquares += phase * phase;
    }
    fft(real, imag);
    let peak = 0;
    const energy = area * pupil.length;
    for (let i = 0; i < area; i++) {
      const intensity = (real[i] ** 2 + imag[i] ** 2) / energy;
      psf[i] = intensity;
      peak = Math.max(peak, intensity);
    }
    real.set(psf);
    imag.fill(0);
    fft(real, imag);
    for (let i = 0; i < area; i++) {
      const r = real[i], v = imag[i];
      real[i] = r * objectReal[i] - v * objectImag[i];
      imag[i] = r * objectImag[i] + v * objectReal[i];
    }
    fft(real, imag, true);
    for (let i = 0; i < area; i++) real[i] /= area;
    const variance = phaseSquares / pupil.length - (phaseSum / pupil.length) ** 2;
    return { image: real, psf, peakRatio: peak / idealPeak, rms: Math.sqrt(Math.max(0, variance)) };
  };
}
