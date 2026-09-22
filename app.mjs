import { SIZE, createCamera, disturbance, lenslets, phaseAt, residualPhase, sense, updateMirror } from "./optics.mjs";

const $ = (id) => document.getElementById(id);
const strength = $("strength");
const speed = $("speed");
const pause = $("pause");
const openCamera = $("open-image").getContext("2d");
const closedCamera = $("closed-image").getContext("2d");
const sensor = $("sensor").getContext("2d");
const mirrorPlot = $("mirror").getContext("2d");
const pointSource = $("psf").getContext("2d");
const referencePixels = openCamera.createImageData(SIZE, SIZE);
const correctedPixels = closedCamera.createImageData(SIZE, SIZE);
const modeNames = { 0: "Mirror off", 2: "Tip / tilt", 5: "Full correction" };

function resolutionChart() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "#585858";
  ctx.strokeRect(17.5, 17.5, 221, 221);
  ctx.fillStyle = "#eeeeee";
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center";
  ctx.fillText("RESOLVE", 128, 49);
  ctx.font = "10px monospace";
  ctx.fillText("RESOLUTION TARGET", 128, 66);
  for (const [index, period] of [12, 8, 4].entries()) {
    const y = 79 + index * 39;
    for (let x = 32; x < 104; x += period) ctx.fillRect(x, y, period / 2, 24);
    for (let line = y; line < y + 24; line += period) ctx.fillRect(148, line, 72, period / 2);
  }
  ctx.fillText("0123456789", 128, 214);
  ctx.font = "8px monospace";
  ctx.fillText("ADAPTIVE OPTICS LAB", 128, 229);
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  return Float64Array.from({ length: SIZE * SIZE }, (_, i) => pixels[i * 4] / 255);
}

const expose = createCamera(resolutionChart());
let time = 0;
let paused = false;
let commands = [];
let lastFrame = 0;

function paintImage(ctx, pixels, image) {
  for (let i = 0; i < image.length; i++) {
    const light = 255 * Math.max(0, image[i]);
    pixels.data[i * 4] = light * 0.89;
    pixels.data[i * 4 + 1] = light * 0.96;
    pixels.data[i * 4 + 2] = light;
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
}

function lineContrast(image) {
  let real = 0, imag = 0, total = 0;
  for (let y = 122; y < 137; y++) {
    for (let x = 40; x < 96; x++) {
      const sample = image[y * SIZE + x];
      const angle = Math.PI * x / 4;
      real += sample * Math.cos(angle);
      imag += sample * Math.sin(angle);
      total += sample;
    }
  }
  return 2 * Math.hypot(real, imag) / total;
}

function clearPlot(ctx) {
  ctx.fillStyle = "#080910";
  ctx.fillRect(0, 0, 200, 128);
}

function paintSensor(coefficients) {
  clearPlot(sensor);
  const slopes = sense(coefficients);
  sensor.strokeStyle = "#34394d";
  sensor.beginPath();
  sensor.arc(100, 64, 53, 0, 2 * Math.PI);
  sensor.stroke();
  for (const [i, [x, y]] of lenslets.entries()) {
    const px = 100 + 53 * x, py = 64 + 53 * y;
    const sx = px + Math.max(-8, Math.min(8, slopes[i * 2] * 1.1));
    const sy = py + Math.max(-8, Math.min(8, slopes[i * 2 + 1] * 1.1));
    sensor.fillStyle = "#64718a";
    sensor.fillRect(px - 1, py - 1, 2, 2);
    sensor.strokeStyle = "#446c6c";
    sensor.beginPath();
    sensor.moveTo(px, py);
    sensor.lineTo(sx, sy);
    sensor.stroke();
    sensor.fillStyle = "#a9f2d3";
    sensor.beginPath();
    sensor.arc(sx, sy, 1.65, 0, 2 * Math.PI);
    sensor.fill();
  }
}

function paintMirror() {
  clearPlot(mirrorPlot);
  for (let y = -50; y < 50; y += 2) {
    for (let x = -50; x < 50; x += 2) {
      if (x * x + y * y > 2500) continue;
      const phase = -phaseAt(x / 50, y / 50, commands);
      const color = Math.min(1, Math.abs(phase) / 4);
      const hue = phase < 0 ? 256 : 158;
      mirrorPlot.fillStyle = `hsl(${hue} ${20 + 55 * color}% ${14 + 49 * color}%)`;
      mirrorPlot.fillRect(x + 100, y + 64, 2, 2);
    }
  }
}

function paintPointSource(psf) {
  clearPlot(pointSource);
  for (let y = -26; y < 26; y++) {
    for (let x = -26; x < 26; x++) {
      const intensity = psf[((y + SIZE) % SIZE) * SIZE + (x + SIZE) % SIZE];
      const level = Math.min(1, Math.log1p(20000 * intensity) / 7);
      pointSource.fillStyle = `rgb(${18 + 155 * level}, ${12 + 187 * level}, ${25 + 222 * level})`;
      pointSource.fillRect(100 + 2 * x, 64 + 2 * y, 2, 2);
    }
  }
}

function render(iterations = 1) {
  const mode = Number(document.querySelector('input[name="mirror"]:checked').value);
  const turbulence = disturbance(time, Number(strength.value) / 45);
  for (let i = 0; i < iterations; i++) commands = updateMirror(turbulence, commands, mode);
  const residual = residualPhase(turbulence, commands);

  const open = expose(turbulence);
  const openContrast = lineContrast(open.image);
  paintImage(openCamera, referencePixels, open.image);
  const corrected = mode === 0 ? open : expose(residual);
  paintImage(closedCamera, correctedPixels, corrected.image);
  paintSensor(residual);
  paintMirror();
  paintPointSource(corrected.psf);

  $("contrast").textContent = lineContrast(corrected.image).toFixed(3);
  $("contrast-reference").textContent = `Reference ${openContrast.toFixed(3)}`;
  $("residual").textContent = `${corrected.rms.toFixed(2)} rad`;
  $("residual-reference").textContent = `Reference ${open.rms.toFixed(2)} rad`;
  $("mode-label").textContent = modeNames[mode];
  $("strength-value").textContent = strength.value + "%";
  $("speed-value").textContent = Number(speed.value).toFixed(1) + "×";
}

function setPaused(value) {
  paused = value;
  pause.setAttribute("aria-pressed", String(paused));
  pause.textContent = paused ? "Resume screen" : "Freeze screen";
}

function frame(now) {
  const elapsed = now - lastFrame;
  if (elapsed >= 85) {
    lastFrame = now;
    if (!paused && !document.hidden) {
      time += Math.min(elapsed, 160) * Number(speed.value) / 1000;
      render();
    }
  }
  requestAnimationFrame(frame);
}

const controlsChanged = () => render(paused ? 15 : 1);
for (const input of document.querySelectorAll("input")) {
  input.addEventListener("input", controlsChanged);
}
pause.addEventListener("click", () => {
  setPaused(!paused);
  if (paused) render(15);
});
$("reset").addEventListener("click", () => {
  time = 0;
  strength.value = 70;
  speed.value = 1;
  document.querySelector('input[name="mirror"][value="5"]').checked = true;
  commands = [];
  setPaused(matchMedia("(prefers-reduced-motion: reduce)").matches);
  render(15);
});
setPaused(matchMedia("(prefers-reduced-motion: reduce)").matches);
render(15);
requestAnimationFrame(frame);
