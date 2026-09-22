import assert from "node:assert/strict";
import test from "node:test";
import { SIZE, createCamera, disturbance, residualPhase, updateMirror } from "./optics.mjs";

test("the Fourier camera conserves flux and the unaberrated point peaks on axis", () => {
  const target = new Float64Array(SIZE * SIZE);
  target[0] = 1;
  const expose = createCamera(target);
  const ideal = expose(Array(9).fill(0));
  assert.ok(Math.abs(ideal.image.reduce((sum, sample) => sum + sample, 0) - 1) < 1e-10);
  assert.ok(Math.abs(ideal.image[0] - ideal.psf[0]) < 1e-12);
  assert.ok(Math.abs(ideal.peakRatio - 1) < 1e-12);
  assert.equal(ideal.rms, 0);
});

test("the calibrated slope reconstructor removes the five controllable modes", () => {
  const atmosphere = [0.7, -1.2, 0.6, 0.3, -0.5, 0, 0, 0, 0];
  let command = [];
  for (let i = 0; i < 20; i++) command = updateMirror(atmosphere, command, 5);
  for (const error of residualPhase(atmosphere, command)) assert.ok(Math.abs(error) < 1e-5);
});

test("full correction recovers a sharper point source across frozen screens", () => {
  const expose = createCamera(new Float64Array(SIZE * SIZE));
  for (const time of [0, 1.1, 2.7, 4.2]) {
    const atmosphere = disturbance(time, 70 / 45);
    let tip = [], full = [];
    for (let i = 0; i < 20; i++) {
      tip = updateMirror(atmosphere, tip, 2);
      full = updateMirror(atmosphere, full, 5);
    }
    const open = expose(atmosphere);
    const tilted = expose(residualPhase(atmosphere, tip));
    const corrected = expose(residualPhase(atmosphere, full));
    assert.ok(corrected.rms < open.rms * 0.3);
    assert.ok(corrected.peakRatio > tilted.peakRatio * 1.8);
    assert.ok(corrected.peakRatio > 0.72);
  }
});
