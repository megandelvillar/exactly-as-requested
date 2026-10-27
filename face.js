/* face.js  (Stage 1)
 *
 * Draws the visitor's face live, using only characters taken from this
 * page's own source code, picked by brightness.
 *
 * How it works, in five steps:
 *   1. Ask for the camera (getUserMedia) and play it in a hidden <video>.
 *   2. Every frame, shrink the video to a tiny grid (e.g. 60 x 34 pixels).
 *      Each tiny pixel becomes one character cell.
 *   3. Turn each pixel into a brightness number from 0 (dark) to 1 (bright).
 *   4. Pick a character for that brightness. The characters come from our
 *      own HTML/CSS/JS, sorted by how much "ink" each one has, so bright
 *      areas get dense characters (M, W, @) and dim areas get light ones (. ,).
 *   5. Draw the characters on the p5.js canvas.
 *
 * Privacy: the video frames only ever go into a tiny canvas in memory.
 * Nothing is uploaded, saved or sent anywhere.
 */

// ---------------------------------------------------------------------------
// Settings you can tweak
// ---------------------------------------------------------------------------
const FACE = {
  minCols: 28,            // grid width when the visitor has sent 0 messages (blurry)
  maxCols: 112,           // grid width when fully "understood" (sharp)
  minLevels: 4,           // number of brightness steps when blurry
  maxLevels: 12,          // ...and when sharp
  glyphAspect: 0.6,       // a monospace character is ~0.6 times as wide as it is tall
  fps: 30,                // 30 is smooth enough and easy on laptops
  messagesForDetail: 7,   // how quickly detail grows: bigger = slower

  // The "wrongness" (see updateShown):
  followSmooth: 0.35,     // normal: the portrait follows you, a hair behind (~0.15s)
  driftSmooth: 0.03,      // during a drift: the portrait barely moves at all
  driftEvery: [9000, 20000],   // ms between drifts (random in this range)
  driftLength: [1200, 2200],   // ms a drift lasts

  font: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  rgb: [143, 232, 210],   // same teal-green as the CSS --machine colour
};

// ---------------------------------------------------------------------------
// State (all the variables the sketch remembers between frames)
// ---------------------------------------------------------------------------
let sourceChars = [];     // every visible character of our own code, in reading order
let rankOf = new Map();   // character -> its rank by "ink" (0 = lightest)
let uniqueCount = 0;
let ready = false;        // true once fonts + source text are loaded

let video = null;         // the hidden <video> element
let cameraOn = false;
let reservedBottom = 260; // pixels at the bottom taken by the chat card (measured in setup)

let messageCount = 0;     // how many messages the visitor has sent
let detailTarget = 0;     // 0..1, where the detail is heading
let detailNow = 0;        // 0..1, where it is now (eases toward the target)

// The sampling canvas: a tiny canvas the video is shrunk onto
const sampler = document.createElement('canvas');
const sctx = sampler.getContext('2d', { willReadFrequently: true });

// Per-grid arrays, rebuilt only when the grid size changes
let cols = 0, rows = 0, levelCount = 0;
let shown, target, edge, levelOf, phase, buckets;
let meanSmooth = 128, stdSmooth = 40;   // auto-contrast memory

// Drift timing
let nextDriftAt = 0, driftUntil = 0;

// ---------------------------------------------------------------------------
// Loading our own source code
// ---------------------------------------------------------------------------
async function loadSourceText() {
  // stream.js already fetches all our files (the page, styles, scripts and
  // the backend). We reuse its result instead of downloading everything twice.
  const source = await PageSource.ready;
  return source.text;
}

// Measure how much "ink" a character has by drawing it on a scratch canvas
// and adding up the pixel alpha values.
function measureInk(ch, ctx) {
  ctx.clearRect(0, 0, 24, 24);
  ctx.fillText(ch, 12, 12);
  const data = ctx.getImageData(0, 0, 24, 24).data;
  let sum = 0;
  for (let i = 3; i < data.length; i += 4) sum += data[i];   // every 4th value is alpha
  return sum;
}

function prepareCharacters(text) {
  // Keep only visible ASCII characters (codes 33..126). This drops spaces,
  // tabs and newlines, which would be invisible anyway.
  sourceChars = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 33 && code <= 126) sourceChars.push(ch);
  }

  // Rank every distinct character by ink.
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 24;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.font = `20px ${FACE.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';

  const unique = [...new Set(sourceChars)];
  const ink = new Map(unique.map(ch => [ch, measureInk(ch, ctx)]));
  unique.sort((a, b) => ink.get(a) - ink.get(b));

  rankOf = new Map(unique.map((ch, i) => [ch, i]));
  uniqueCount = unique.length;
}

// Split the source characters into `levelCount` groups by ink rank.
// buckets[0] holds the lightest characters, buckets[last] the densest.
// Each bucket keeps characters in reading order and keeps repeats, so common
// characters from the code show up more often, like in the real file.
function buildBuckets(levels) {
  buckets = Array.from({ length: levels }, () => []);
  for (const ch of sourceChars) {
    const lvl = Math.min(levels - 1, Math.floor((rankOf.get(ch) / uniqueCount) * levels));
    buckets[lvl].push(ch);
  }
  // Safety: if a bucket ended up empty, borrow from its nearest neighbour.
  for (let l = 0; l < levels; l++) {
    for (let d = 1; buckets[l].length === 0 && d < levels; d++) {
      buckets[l] = (buckets[l - d] || buckets[l + d] || []).slice();
    }
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
async function startCamera() {
  const note = document.getElementById('camera-note');
  const button = document.getElementById('camera-button');
  button.disabled = true;
  note.textContent = 'Waiting for your permission...';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    video = document.createElement('video');
    video.muted = true;               // required for autoplay in Safari/Chrome
    video.playsInline = true;         // required for Safari
    video.srcObject = stream;
    // Safari can stop updating a video that is not on the page, so we attach
    // it, but make it invisible (it is never shown; only its pixels are read).
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(video);
    await video.play();

    cameraOn = true;
    document.getElementById('camera-box').classList.add('hidden');
  } catch (err) {
    // Denied, no camera, or an insecure page: the rest of the piece must still work.
    cameraOn = false;
    button.disabled = false;
    note.textContent = 'No problem, I will manage without.';
    console.info('Camera unavailable:', err && err.name);
  }
}

// ---------------------------------------------------------------------------
// Public controls (app.js calls Face.setMessages after every answer)
// ---------------------------------------------------------------------------
window.Face = {
  // Tell the face how many messages the visitor has sent.
  setMessages(n) {
    messageCount = n;
    // 1 - e^(-n/k): fast early progress that slows down and never fully ends.
    detailTarget = 1 - Math.exp(-n / FACE.messagesForDetail);
  },
  // Start a drift right now (for testing).
  forceDrift() {
    driftUntil = millis() + rand(FACE.driftLength);
  },
};

function rand([lo, hi]) { return lo + Math.random() * (hi - lo); }

// ---------------------------------------------------------------------------
// p5.js: setup runs once, draw runs every frame
// ---------------------------------------------------------------------------
function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent('face-stage');
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  frameRate(FACE.fps);

  // Load fonts and our own source, then switch on drawing.
  Promise.all([
    document.fonts.load(`20px ${FACE.font}`),
    loadSourceText(),
  ]).then(([, text]) => {
    prepareCharacters(text);
    nextDriftAt = millis() + rand(FACE.driftEvery);
    ready = true;
  });

  document.getElementById('camera-button').addEventListener('click', startCamera);

  // The chat card sits at the bottom. Keep track of its height so the face
  // can be drawn in the space ABOVE it and never hide behind it.
  // The card grows as the conversation grows, but we do NOT want the face to
  // keep resizing, so we reserve the card's fixed parts (header, meter, input)
  // plus room for part of the conversation. Long chats may overlap the chin.
  const chat = document.getElementById('chat');
  const thread = document.getElementById('thread');
  new ResizeObserver(() => {
    const fixedPart = chat.offsetHeight - thread.offsetHeight;
    reservedBottom = fixedPart + 28 + 12 + height * 0.26 * 0.6;
  }).observe(chat);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  clear();   // the canvas is transparent; the dark page colour shows through
  if (!ready || !cameraOn || video.readyState < 2 || !video.videoWidth) return;

  // Ease the detail toward its target so sharpening is gradual, not a jump.
  detailNow += (detailTarget - detailNow) * 0.04;

  // --- Layout: fit the video's shape into the window, leaving a margin ---
  const aspect = video.videoWidth / video.videoHeight;
  // The face lives in the area above the chat card (and below the top edge).
  const availH = Math.max(160, height - reservedBottom - 8);
  let drawH = availH * 0.96;
  let drawW = drawH * aspect;
  if (drawW > width * 0.96) { drawW = width * 0.96; drawH = drawW / aspect; }
  const faceTop = 8 + (availH - drawH) / 2;

  // --- Grid size from detail (cols is kept even so it does not flicker) ---
  const wantCols = 2 * Math.round(lerp(FACE.minCols, FACE.maxCols, detailNow) / 2);
  const cellW = drawW / wantCols;
  const cellH = cellW / FACE.glyphAspect;
  const wantRows = Math.max(1, Math.round(drawH / cellH));
  const wantLevels = Math.round(lerp(FACE.minLevels, FACE.maxLevels, detailNow));
  if (wantCols !== cols || wantRows !== rows) resizeGrid(wantCols, wantRows);
  if (wantLevels !== levelCount) { levelCount = wantLevels; buildBuckets(levelCount); }

  sampleVideo();
  updateShown();
  renderGrid((width - drawW) / 2, faceTop, drawW / cols, drawH / rows);
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------
function resizeGrid(c, r) {
  cols = c; rows = r;
  sampler.width = cols; sampler.height = rows;
  const n = cols * rows;
  shown = new Float32Array(n);     // brightness currently displayed
  target = new Float32Array(n);    // brightness of the live video
  levelOf = new Int8Array(n);
  phase = new Uint16Array(n);      // per-cell offset, makes characters shimmer
  edge = new Float32Array(n);      // vignette: fades the portrait out at the edges
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = (x + 0.5) / cols - 0.5, dy = (y + 0.5) / rows - 0.5;
      const d = Math.sqrt(dx * dx * 1.2 + dy * dy) / 0.5;      // 0 centre .. ~1 edge
      edge[y * cols + x] = 1 - smoothstep(0.55, 1.0, d);
    }
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Steps 2 and 3: shrink the video to the grid and convert pixels to brightness.
function sampleVideo() {
  // Draw the video flipped left-right, like a mirror. Letting the browser
  // shrink the image is much faster than looping over every video pixel.
  sctx.save();
  sctx.scale(-1, 1);
  sctx.drawImage(video, -cols, 0, cols, rows);
  sctx.restore();

  const px = sctx.getImageData(0, 0, cols, rows).data;
  const n = cols * rows;

  // Brightness of each cell (standard luma formula: green counts most).
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    target[i] = lum;
    sum += lum; sumSq += lum * lum;
  }

  // Auto-contrast: rooms are lit differently, so we measure the average and
  // spread of brightness (smoothed over time) and stretch to use the full range.
  const mean = sum / n;
  const std = Math.sqrt(Math.max(1, sumSq / n - mean * mean));
  meanSmooth += (mean - meanSmooth) * 0.1;
  stdSmooth += (std - stdSmooth) * 0.1;

  // Early on the portrait is flatter and noisier; later it is crisp.
  const contrast = lerp(0.8, 1.25, detailNow);
  const noise = (1 - detailNow) * 0.12;
  for (let i = 0; i < n; i++) {
    let b = 0.5 + ((target[i] - meanSmooth) / (stdSmooth * 3.5)) * contrast;
    b += (Math.random() - 0.5) * noise;
    target[i] = Math.min(1, Math.max(0, b)) * edge[i];
  }
}

// The subtle wrongness lives here.
// Normally the portrait follows you with a tiny trailing delay.
// Every so often it "drifts": it stops following and holds its old expression
// for a moment, then catches up. Nothing is slow on the computer; the
// reflection is just not quite you.
function updateShown() {
  const now = millis();
  if (now > nextDriftAt) {
    driftUntil = now + rand(FACE.driftLength);
    nextDriftAt = driftUntil + rand(FACE.driftEvery);
  }
  const k = now < driftUntil ? FACE.driftSmooth : FACE.followSmooth;
  for (let i = 0; i < shown.length; i++) shown[i] += (target[i] - shown[i]) * k;
}

// Steps 4 and 5: choose a character per cell and draw it.
function renderGrid(ox, oy, cellW, cellH) {
  const n = cols * rows;

  // A few random cells change character each frame so the portrait shimmers.
  for (let s = 0; s < n * 0.01; s++) phase[(Math.random() * n) | 0]++;

  // Which brightness level is each cell? -1 means "too dark, draw nothing".
  for (let i = 0; i < n; i++) {
    const b = shown[i];
    levelOf[i] = b < 0.08 ? -1 : Math.min(levelCount - 1, Math.floor(b * levelCount));
  }

  const ctx = drawingContext;
  ctx.font = `${cellH * 0.95}px ${FACE.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // One pass per level means we change the fill colour only ~12 times a frame
  // instead of thousands of times.
  const [r, g, b] = FACE.rgb;
  for (let lvl = 0; lvl < levelCount; lvl++) {
    const alpha = 0.2 + 0.8 * (lvl / Math.max(1, levelCount - 1));
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    const bucket = buckets[lvl];
    for (let i = 0; i < n; i++) {
      if (levelOf[i] !== lvl) continue;
      const ch = bucket[(i * 31 + phase[i]) % bucket.length];
      const x = ox + ((i % cols) + 0.5) * cellW;
      const y = oy + (((i / cols) | 0) + 0.5) * cellH;
      ctx.fillText(ch, x, y);
    }
  }
}
