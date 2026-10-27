/* stream.js
 *
 * The background: dense, constant, unreadable activity. And none of it is made up.
 * Everything that scrolls here comes from this very project:
 *
 *   code columns   the real source code of this site, line by line
 *                  (index.html, style.css and the .js files, including model.js, the AI)
 *   hex columns    the real bytes of that source code, written in hexadecimal
 *   id columns     the real token IDs of that source code: this is literally
 *                  what a language model would "see" if you gave it this website
 *
 * It is drawn with the plain canvas API (no p5.js), because p5 is already
 * busy with the face.
 */

// ---------------------------------------------------------------------------
// Loading our own source (shared with face.js and app.js through window.PageSource)
// ---------------------------------------------------------------------------
(() => {
  // [name shown, address to fetch it from]
  const FILES = [
    ['index.html', 'index.html'],
    ['style.css', 'style.css'],
    ['stream.js', 'stream.js'],
    ['face.js', 'face.js'],
    ['app.js', 'app.js'],
    ['model.js', 'model.js'],       // the AI itself, running in this browser
  ];

  async function load() {
    const files = {};
    await Promise.all(FILES.map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (response.ok) files[name] = await response.text();
      } catch { /* a file that fails to load is simply skipped */ }
    }));
    let text = Object.values(files).join('\n');
    // If nothing loaded (for example the page was opened without a server),
    // fall back to the page as the browser currently sees it.
    if (text.length < 500) {
      text = document.documentElement.outerHTML;
      files['index.html'] = text;
    }
    return { files, text };
  }

  window.PageSource = { files: {}, text: '', ready: null };
  window.PageSource.ready = load().then((result) => {
    Object.assign(window.PageSource, result);
    return window.PageSource;
  });
})();

// ---------------------------------------------------------------------------
// The scrolling stream
// ---------------------------------------------------------------------------
(() => {
  const canvas = document.getElementById('stream');
  const ctx = canvas.getContext('2d');

  // ---- Settings you can tweak ----
  const LINE_H = 17;                 // pixels between lines
  const FONT_SIZE = 11.5;
  const FONT = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  const COLOR = '143, 232, 210';     // same teal as the CSS --machine colour
  const BG = '10, 13, 18';           // same as --bg
  const GAP = 22;                    // space between columns
  const FPS = 30;
  const MAX_CODE_CHARS = 46;         // longer source lines are cut with "…" to fit their column

  // Visitors who ask for reduced motion get a still picture.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- The hash: (a, b) -> a scrambled whole number, always the same for the same a, b ----
  // Now only used for the random brightness pulses, never for content.
  function hash(a, b) {
    let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;     // >>> 0 makes it a positive number
  }

  // ---- The real content, filled in once the source has loaded ----
  let codeLines = [];     // the lines of our source code
  let sourceBytes = [];   // its bytes
  let sourceIds = [];     // its token IDs

  function prepareContent(text) {
    codeLines = text.split('\n')
      .map((line) => line.replace(/\s+$/, '').replace(/\t/g, '  '))
      .filter((line) => line.trim().length > 1)
      .map((line) => line.length > MAX_CODE_CHARS ? line.slice(0, MAX_CODE_CHARS - 1) + '…' : line);

    sourceBytes = new TextEncoder().encode(text);

    // The number columns use the AI's own tokenizer (see model.js), so they are
    // the real token IDs of this source code. Until it has loaded (a second or
    // so), and in ?mock mode, those columns show hex instead.
    if (window.Brain) {
      Brain.tokenizerReady.then(() => { sourceIds = Brain.tokenize(text); }, () => {});
    }
  }

  // ---- The echo ----
  // After each message, for a few seconds, the number columns stop showing the
  // site's code and show the token IDs of what the visitor just typed instead.
  // app.js calls Stream.echo(ids). The IDs only live in memory, nothing is sent anywhere.
  const ECHO_MS = 5000;
  let echoIds = [];
  let echoStart = -Infinity;
  let echoAge = Infinity;            // milliseconds since the echo began, updated every frame
  window.Stream = {
    echo(ids) { echoIds = ids; echoStart = performance.now(); },
  };

  // Pick item `i` of a list, wrapping around at both ends.
  const wrap = (list, i) => list[((i % list.length) + list.length) % list.length];

  // ---- Three kinds of column. `i` counts up as you go DOWN the screen, so the code reads in order. ----
  const KINDS = {
    ids:  { width: 58,  speed: [14, 40], alpha: [0.10, 0.20],
            line: (i) => echoAge < ECHO_MS && echoIds.length ? String(wrap(echoIds, i))
                       : sourceIds.length ? String(wrap(sourceIds, i)) : KINDS.hex.line(i) },
    hex:  { width: 92,  speed: [8, 24],  alpha: [0.08, 0.16],
            line: (i) => {                                  // 4 real bytes per line
              let out = '';
              for (let b = 0; b < 4; b++) out += wrap(sourceBytes, i * 4 + b).toString(16).padStart(2, '0');
              return out;
            } },
    code: { width: 330, speed: [6, 14],  alpha: [0.10, 0.18],
            line: (i) => wrap(codeLines, i) },
  };

  let columns = [];
  let width = 0, height = 0;

  // Fill the screen width with randomly chosen columns.
  function buildColumns() {
    columns = [];
    let x = GAP;
    let id = 1;
    while (x < width) {
      const r = Math.random();
      const kind = r < 0.45 ? 'ids' : r < 0.65 ? 'hex' : 'code';
      const k = KINDS[kind];
      columns.push({
        id: id++,
        kind,
        x,
        speed: k.speed[0] + Math.random() * (k.speed[1] - k.speed[0]),
        alpha: k.alpha[0] + Math.random() * (k.alpha[1] - k.alpha[0]),
        offset: Math.random() * 100000,   // where in the column we start
        seed: (Math.random() * 1e9) | 0,  // starting point in the source, so columns differ
      });
      x += k.width + GAP;
    }
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS pixels, but at full sharpness
    buildColumns();
    draw(0);
  }

  // Paint a soft dark circle (opaque in the middle, invisible at the edge).
  function dimSpot(cx, cy, radius, strength) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(${BG}, ${strength})`);
    g.addColorStop(1, `rgba(${BG}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // ---- Draw one frame. `t` is the time in seconds. ----
  function draw(t) {
    ctx.clearRect(0, 0, width, height);
    if (codeLines.length === 0) return;         // source not loaded yet
    ctx.font = FONT;
    ctx.textBaseline = 'top';

    const rowsOnScreen = Math.ceil(height / LINE_H) + 1;
    echoAge = performance.now() - echoStart;
    const echoGlow = echoAge < ECHO_MS ? 0.3 * (1 - echoAge / ECHO_MS) : 0;   // fades out as the echo ends

    for (const col of columns) {
      const kind = KINDS[col.kind];
      const firstLine = Math.floor(col.offset / LINE_H);
      const shift = col.offset % LINE_H;          // sub-line scrolling, so motion is smooth

      for (let r = 0; r < rowsOnScreen; r++) {
        // Content moves DOWN the screen, so new lines appear at the top.
        const lineNo = firstLine - r;
        const h = hash(col.seed, lineNo);

        // Now and then a line glows a bit brighter, like activity.
        // (h % 40 === 0 picks about 1 line in 40; the sine makes it pulse.)
        let a = col.alpha;
        if (h % 40 === 0) a += 0.35 * Math.max(0, Math.sin(t * 1.5 + h));
        if (col.kind === 'ids') a += echoGlow;       // the echo is a little brighter than the rest

        ctx.fillStyle = `rgba(${COLOR}, ${a.toFixed(3)})`;
        // `col.seed + r - firstLine` grows as we go down the screen: the source reads top to bottom.
        ctx.fillText(kind.line(col.seed + r - firstLine), col.x, r * LINE_H + shift - LINE_H);
      }
    }

    // A dark glow behind the chat box so it stays the focal point
    // and the stream stays calm around it.
    dimSpot(width / 2, height * 0.8, Math.max(width * 0.45, 420), 0.9);
    // A second, softer one behind the face so the portrait stays readable.
    dimSpot(width / 2, height * 0.34, Math.max(height * 0.42, 260), 0.6);
  }

  // ---- The animation loop ----
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < 1000 / FPS) return;           // skip frames above 30 fps
    const dt = (now - last) / 1000;
    last = now;
    for (const col of columns) col.offset += col.speed * dt;
    draw(now / 1000);
  }

  window.addEventListener('resize', resize);
  // Wait for the font and the source so the first frame is already right.
  Promise.all([document.fonts.load(FONT), PageSource.ready]).then(([, source]) => {
    prepareContent(source.text);
    resize();
    if (!reduceMotion) requestAnimationFrame(frame);
  });
})();
