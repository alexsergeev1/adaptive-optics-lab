import { SIZE, createCamera, createMirrorLoop, disturbance, lenslets, phaseAt, residualPhase, sense } from "./optics.mjs";

const $ = (id) => document.getElementById(id);
const strength = $("strength");
const speed = $("speed");
const delay = $("delay");
const target = $("target");
const profile = $("profile");
const pause = $("pause");
const openCamera = $("open-image").getContext("2d");
const closedCamera = $("closed-image").getContext("2d");
const sensor = $("sensor").getContext("2d");
const mirrorPlot = $("mirror").getContext("2d");
const pointSource = $("psf").getContext("2d");
const historyPlot = $("history").getContext("2d");
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

function doubleStar() {
  const pixels = new Float64Array(SIZE * SIZE);
  for (const [x, y, flux] of [[125, 128, 4], [131, 128, 3.1], [77, 78, 0.8], [176, 93, 1.2], [185, 180, 0.65], [92, 172, 0.45]]) {
    pixels[y * SIZE + x] = flux;
  }
  return pixels;
}

const cameras = { chart: createCamera(resolutionChart()), stars: createCamera(doubleStar()) };
const loop = createMirrorLoop();
const history = [];
let time = 0;
let elapsedTime = 0;
let paused = false;
let commands = [];
let lastFrame = 0;

function paintImage(ctx, pixels, image, stars) {
  for (let i = 0; i < image.length; i++) {
    const intensity = Math.max(0, image[i]);
    const light = 255 * (stars ? Math.sqrt(intensity / 0.42) : intensity);
    pixels.data[i * 4] = light * 0.89;
    pixels.data[i * 4 + 1] = light * 0.96;
    pixels.data[i * 4 + 2] = light;
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
}

function paintHistory() {
  const canvas = historyPlot.canvas;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (width < 100 || height < 30) return;
  const scale = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
  }
  const ctx = historyPlot;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "11px Consolas, monospace";
  ctx.fillStyle = "#adb2c4";
  if (history.length < 2) {
    ctx.fillText("Resume the screen to collect samples.", 16, 26);
    return;
  }
  const samples = history.slice(-150);
  const begin = samples[0].seconds, end = samples.at(-1).seconds;
  const peak = Math.max(1, Math.ceil(Math.max(...samples.map((sample) => Math.max(sample.openRms, sample.rms)))));
  const left = 46, right = width - 18, top = 15, bottom = height - 24;
  const x = (seconds) => left + (seconds - begin) / (end - begin) * (right - left);
  const y = (rms) => bottom - rms / peak * (bottom - top);
  for (const value of [0, peak / 2, peak]) {
    ctx.strokeStyle = "#2c3040";
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillText(value + " rad", 7, y(value) + 4);
  }
  ctx.fillText(begin.toFixed(1) + " s", left, height - 7);
  const endLabel = end.toFixed(1) + " s";
  ctx.fillText(endLabel, right - ctx.measureText(endLabel).width, height - 7);
  for (const [key, color] of [["openRms", "#f6b894"], ["rms", "#a9f2d3"]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [i, sample] of samples.entries()) {
      if (i === 0) ctx.moveTo(x(sample.seconds), y(sample[key]));
      else ctx.lineTo(x(sample.seconds), y(sample[key]));
    }
    ctx.stroke();
  }
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

function render(iterations = 1, record = false) {
  const mode = Number(document.querySelector('input[name="mirror"]:checked').value);
  const lag = Number(delay.value);
  const turbulence = disturbance(time, Number(strength.value) / 45, profile.value);
  for (let i = 0; i < iterations; i++) commands = loop.step(turbulence, mode, lag);
  const residual = residualPhase(turbulence, commands);
  const stars = target.value === "stars";
  const expose = cameras[target.value];

  const open = expose(turbulence);
  const openContrast = stars ? null : lineContrast(open.image);
  paintImage(openCamera, referencePixels, open.image, stars);
  const corrected = mode === 0 ? open : expose(residual);
  paintImage(closedCamera, correctedPixels, corrected.image, stars);
  paintSensor(residual);
  paintMirror();
  paintPointSource(corrected.psf);

  $("contrast-panel").hidden = stars;
  if (!stars) {
    $("contrast").textContent = lineContrast(corrected.image).toFixed(3);
    $("contrast-reference").textContent = `Reference ${openContrast.toFixed(3)}`;
  }
  $("residual").textContent = `${corrected.rms.toFixed(2)} rad`;
  $("residual-reference").textContent = `Reference ${open.rms.toFixed(2)} rad`;
  $("strehl").textContent = corrected.peakRatio.toFixed(3);
  $("strehl-reference").textContent = `Reference ${open.peakRatio.toFixed(3)}`;
  $("mode-label").textContent = modeNames[mode];
  $("strength-value").textContent = strength.value + "%";
  $("speed-value").textContent = Number(speed.value).toFixed(1) + "×";
  $("delay-value").textContent = `${lag} ${lag === 1 ? "frame" : "frames"}`;
  if (record) {
    history.push({
      seconds: elapsedTime, profile: profile.value, strength: Number(strength.value),
      speed: Number(speed.value), mode, lag, openRms: open.rms, rms: corrected.rms,
      openStrehl: open.peakRatio, strehl: corrected.peakRatio,
    });
    if (history.length > 600) history.shift();
    $("save-data").disabled = false;
  }
  paintHistory();
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
      const step = Math.min(elapsed, 160) / 1000;
      elapsedTime += step;
      time += step * Number(speed.value);
      render(1, true);
    }
  }
  requestAnimationFrame(frame);
}

const controlsChanged = () => render(paused && Number(delay.value) === 0 ? 15 : 1);
for (const control of document.querySelectorAll("input, select")) {
  control.addEventListener("input", controlsChanged);
}
pause.addEventListener("click", () => {
  setPaused(!paused);
});
$("reset").addEventListener("click", () => {
  time = 0;
  elapsedTime = 0;
  history.length = 0;
  strength.value = 70;
  speed.value = 1;
  delay.value = 0;
  target.value = "chart";
  profile.value = "rolling";
  document.querySelector('input[name="mirror"][value="5"]').checked = true;
  loop.reset();
  $("save-data").disabled = true;
  setPaused(matchMedia("(prefers-reduced-motion: reduce)").matches);
  render(15);
});

function download(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

$("save-data").addEventListener("click", () => {
  const heading = "time_s,disturbance,turbulence_pct,screen_speed,mirror_modes,delay_frames,reference_rms_rad,corrected_rms_rad,reference_strehl,corrected_strehl";
  const csv = [heading, ...history.map((sample) => Object.values(sample).join(","))].join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  download(url, "adaptive-optics-telemetry.csv");
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("save-frame").addEventListener("click", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 2 * SIZE + 24;
  canvas.height = SIZE + 66;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#121520";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(openCamera.canvas, 8, 32);
  ctx.drawImage(closedCamera.canvas, SIZE + 16, 32);
  ctx.fillStyle = "#f1f0f6";
  ctx.font = "13px monospace";
  ctx.fillText("Reference camera", 8, 21);
  ctx.fillText($("mode-label").textContent, SIZE + 16, 21);
  ctx.fillText(`Strehl ${$("strehl-reference").textContent.split(" ").at(-1)}`, 8, SIZE + 53);
  ctx.fillText(`Strehl ${$("strehl").textContent}`, SIZE + 16, SIZE + 53);
  download(canvas.toDataURL(), "adaptive-optics-comparison.png");
});

window.addEventListener("resize", paintHistory);
setPaused(matchMedia("(prefers-reduced-motion: reduce)").matches);
render(15);
requestAnimationFrame(frame);
