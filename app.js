/* app.js
 *
 * The friendly part of the page: the input box, the rewards, and showing
 * answers as numbers.
 *
 * The flow for every message:
 *   1. show the visitor's words (readable) and typing dots
 *   2. ask the AI (model.js, running in this browser) for an answer: text AND its token IDs
 *   3. show a trace of the real code that just ran
 *   4. reveal ONLY the numbers, one by one, with occasionally one real word
 *   5. hide the decoded answer in the console and in the page's DOM
 *   6. give the rewards: "Done ✓", higher "Understanding you", a sharper face
 *
 * Add ?mock to the address (http://localhost:3000/?mock) to skip the AI
 * download and use canned answers. Handy for quickly testing the look.
 */

(() => {
  // ---- Page elements we need ----
  const form = document.getElementById('ask-form');
  const input = document.getElementById('ask-input');
  const sendButton = document.getElementById('send-button');
  const thread = document.getElementById('thread');
  const meterFill = document.getElementById('meter-fill');
  const understandingLabel = document.getElementById('understanding');

  let modelFailed = false;  // true if the AI could not start on this computer

  let messageCount = 0;     // how many answers the visitor has received (drives rewards AND the face)
  let busy = false;         // true while an answer is being fetched or revealed
  const history = [];       // the conversation so far, kept only in memory: [{ role, content }]

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------------------------------------------------------------------
  // "Understanding you: NN%"
  // ---------------------------------------------------------------------
  // Each message closes 22% of the remaining gap: 22%, 39%, 53%, 63%, 71%...
  // It climbs fast at first, then slows. It gets close to 100 but never gets there.
  function understandingFor(n) {
    const p = 100 * (1 - Math.pow(0.78, n));
    return Math.min(p, 99.9);
  }

  // The browser tab's title. It shows the percentage, and says something else
  // while the visitor is looking at another tab.
  let restingTitle = '';
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? 'Still here.' : (restingTitle || 'Exactly As Requested');
  });

  let shownPercent = 0;
  function updateUnderstanding() {
    const from = shownPercent;
    const to = understandingFor(messageCount);
    meterFill.style.width = to + '%';      // the CSS transition animates the bar

    // Count the number up over about 0.9 seconds so it feels like it is working.
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - t, 3);
      shownPercent = from + (to - from) * eased;
      // Once we are in the high 90s, show one decimal: "99.3%" feels even closer to done.
      const text = shownPercent >= 98 ? shownPercent.toFixed(1) : Math.floor(shownPercent);
      understandingLabel.textContent = `Understanding you: ${text}%`;
      if (t < 1) requestAnimationFrame(tick);
      else restingTitle = `Understanding you: ${text}%`;    // the browser tab shows it too
      if (!document.hidden && restingTitle) document.title = restingTitle;
    }
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------
  // Chat bubbles
  // ---------------------------------------------------------------------
  function addBubble(kind) {
    const div = document.createElement('div');
    div.className = 'bubble ' + kind;
    thread.appendChild(div);
    // Keep only the last 6 bubbles so the chat never grows over the face.
    while (thread.children.length > 6) thread.removeChild(thread.firstChild);
    scrollThread();
    return div;
  }

  function scrollThread() {
    thread.scrollTop = thread.scrollHeight;
  }

  // ---------------------------------------------------------------------
  // Getting an answer (as plain English text)
  // ---------------------------------------------------------------------
  // Returns { text, ids, info }.
  // Language models do not read letters. They read "tokens": pieces of text
  // (a word, part of a word, a punctuation mark), each with a number.
  // model.js (the AI, running in this browser) gives us the answer AND the
  // model's own token IDs. `info` holds real facts about what just happened;
  // the trace in the answer bubble shows them.
  async function getAnswer() {
    if (Brain.mock) {
      await sleep(1200 + Math.random() * 1200);
      const last = history[history.length - 1].content;
      const text = `You asked: "${last}". This is a canned answer for testing. A real AI would answer correctly, ` +
                   `and you would only see its numbers, unless you looked behind the curtain.`;
      return { text, ids: mockTokenize(text), info: { mock: true } };
    }
    return Brain.generate(history);
  }

  // Only for ?mock: invent numbers by hashing each piece of text.
  // (Real answers use the model's real token IDs.)
  function mockTokenize(text) {
    return (text.match(/\s?\w+|[^\s\w]/g) || []).map((piece) => {
      let h = 2166136261;
      for (const ch of piece) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return (h >>> 0) % 151000;
    });
  }

  // Token ID -> text, for the leaked word and the console. (Mock IDs cannot be decoded.)
  const decodeToken = (id) => (Brain.mock ? '' : Brain.decode([id]));

  // Sometimes, let ONE real word show through the numbers.
  // We look for a token that is a whole English word (a space, then 4+ letters)
  // and is not the very start or very end of the answer. Returns its position
  // in the list, or -1 for "no leak this time".
  function pickLeak(ids) {
    if (ids.length < 12 || Math.random() > 0.7) return -1;      // about 7 answers in 10 leak a word
    const candidates = [];
    for (let i = Math.floor(ids.length * 0.2); i < Math.floor(ids.length * 0.85); i++) {
      const isWord = /^ [A-Za-z]{4,}$/.test(decodeToken(ids[i]));
      // The next piece must not continue the word (e.g. " Su" + "cre"), or we would leak half a word.
      const wordEnds = !/^[A-Za-z]/.test(decodeToken(ids[i + 1]));
      if (isWord && wordEnds) candidates.push(i);
    }
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : -1;
  }

  // ---------------------------------------------------------------------
  // Showing an answer as numbers, one at a time, like streaming
  // ---------------------------------------------------------------------
  async function revealTokens(container, ids, leakIndex) {
    // Long answers reveal faster so the whole thing takes about 7 seconds at most.
    const base = Math.min(80, Math.max(12, 7000 / ids.length));

    for (let i = 0; i < ids.length; i++) {
      const span = document.createElement('span');
      span.className = 'tok';
      span.textContent = (i === leakIndex
        ? decodeToken(ids[i]).trim()                           // the leaked real word
        : ids[i]) + ' ';
      container.appendChild(span);
      scrollThread();
      // Mostly quick, with an occasional small pause, like a real stream.
      await sleep(base * (0.5 + Math.random()) + (Math.random() < 0.06 ? 220 : 0));
    }
  }

  // ---------------------------------------------------------------------
  // The trace: what really ran to produce this answer
  // ---------------------------------------------------------------------
  // Finds the real line of code in one of our own source files (loaded by
  // stream.js), so the trace quotes our actual code and not a description of it.
  // `needle` is a piece of text that appears in that line.
  function sourceLine(file, needle) {
    const text = (window.PageSource && PageSource.files[file]) || '';
    const line = text.split('\n').find((l) => l.includes(needle));
    return line ? line.trim() : needle;
  }

  // Each step is [file, piece of the code line, what really happened when it ran].
  function buildTrace(info, ids) {
    if (info.mock) {
      return [
        ['app.js', 'return Brain.generate(history);', 'skipped: ?mock mode'],
        ['app.js', 'function mockTokenize(text)', `${ids.length} invented ids`],
      ];
    }
    return [
      ['model.js', 'const MODEL_ID',
        `${info.modelName} (${info.dtype}) on ${info.device}, inside this browser`],
      ['model.js', 'tokenizer.apply_chat_template(',
        `${info.promptTokens} tokens in: instructions + your words`],
      ['model.js', 'await model.generate(',
        `${info.newTokens} tokens out   ${info.ms} ms   ${info.tokensPerSecond} tokens/s`],
    ];
  }

  async function showTrace(bubble, steps) {
    const trace = document.createElement('div');
    trace.className = 'trace';
    bubble.appendChild(trace);
    for (const [file, needle, result] of steps) {
      const row = document.createElement('div');
      row.className = 'trace-row';
      const code = document.createElement('div');
      code.className = 'trace-code';
      code.textContent = `${file}  ${sourceLine(file, needle)}`;
      const out = document.createElement('div');
      out.className = 'trace-result';
      out.textContent = '→ ' + result;
      row.append(code, out);
      trace.appendChild(row);
      scrollThread();
      await sleep(160);
    }
  }

  // ---------------------------------------------------------------------
  // Hiding the real answer where curious people can find it
  // ---------------------------------------------------------------------
  function hideDecodedAnswer(bubble, question, text, ids) {
    // 1. In the console (open it with Cmd+Option+J in Chrome, Cmd+Option+C in Safari).
    console.log('%c you asked ', 'background:#2b2a33;color:#fff;font-weight:bold', question);
    console.log('%c decoded ', 'background:#8fe8d2;color:#0a0d12;font-weight:bold', '\n' + text);
    console.log('%c tokens ', 'background:#555;color:#fff', ids.join(' '));

    // 2. In the page itself: a data attribute and an HTML comment on the answer.
    //    Both show up in the "Elements" / "Inspector" panel of developer tools.
    //    (A comment may not contain "--", so we change any "--" to "- -".)
    bubble.dataset.decoded = text;
    bubble.appendChild(document.createComment(' decoded: ' + text.replace(/--/g, '- -') + ' '));
  }

  // ---------------------------------------------------------------------
  // Handling a message
  // ---------------------------------------------------------------------
  async function handleSend(question) {
    busy = true;
    sendButton.disabled = true;

    // 1. The visitor's own words, readable, and typing dots while we "think".
    addBubble('you').textContent = question;
    const bot = addBubble('bot');
    bot.innerHTML = '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
    history.push({ role: 'user', content: question });

    // The echo: the stream briefly shows the numbers of what you just typed.
    try {
      window.Stream.echo(Brain.mock ? mockTokenize(question) : Brain.tokenize(question));
    } catch { /* the tokenizer is not loaded yet: skip the echo this time */ }

    // 2 + 3. Get the real answer and turn it into numbers.
    let text, ids, info;
    try {
      ({ text, ids, info } = await getAnswer());
      if (!ids.length) throw new Error('Empty answer');
    } catch (err) {
      console.info('Could not get an answer:', err && err.message);
      history.pop();                      // forget the question that failed
      bot.textContent = modelFailed
        ? 'Sorry, this needs a recent Chrome or Safari on a computer with a graphics chip.'
        : 'Something went wrong on my side. Please try again.';
      busy = false;
      sendButton.disabled = false;
      input.focus();
      return;
    }
    history.push({ role: 'assistant', content: text });

    // 4. Replace the dots with what really ran, then the answer as numbers.
    bot.innerHTML = '';
    await showTrace(bot, buildTrace(info, ids));
    const tokens = document.createElement('div');
    tokens.className = 'tokens';
    bot.appendChild(tokens);
    await revealTokens(tokens, ids, pickLeak(ids));

    // 5. For the curious.
    hideDecodedAnswer(bot, question, text, ids);

    // 6. The rewards: a cheerful tick, a higher "understanding", a sharper face.
    const done = document.createElement('div');
    done.className = 'done';
    done.textContent = 'Done ✓';
    bot.appendChild(done);
    scrollThread();

    messageCount++;
    updateUnderstanding();
    if (window.Face) Face.setMessages(messageCount);

    busy = false;
    sendButton.disabled = false;
    input.focus();
    resetIdle();
  }

  // ---------------------------------------------------------------------
  // Small uncanny details
  // ---------------------------------------------------------------------
  // If the visitor goes quiet for a while (after at least one answer), the
  // box says something kind. Typing again puts the normal text back.
  const normalPlaceholder = input.placeholder;
  let idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    input.placeholder = normalPlaceholder;
    if (messageCount === 0) return;
    idleTimer = setTimeout(() => {
      if (!busy && !input.value) input.placeholder = 'Take your time. I am not going anywhere.';
    }, 25000);
  }
  input.addEventListener('input', resetIdle);

  // ---------------------------------------------------------------------
  // The hidden message, for anyone who opens the developer tools
  // ---------------------------------------------------------------------
  const badge = 'background:#8fe8d2;color:#0a0d12;font-weight:bold;padding:2px 6px;border-radius:4px';
  const plain = 'font-size:13px;line-height:1.5';
  console.log('%c Hello. ', badge, 'You opened the console. Of course you did.');
  console.log('%cThere is no trick: everything on the page is real. The scrolling code is this site\'s own code, ' +
              'the numbers are real token IDs, and the AI runs inside your browser, on your computer.', plain);
  console.log('%cAfter every message I print the answer here in plain words, decoded. ' +
              'Ask me something and look back.', plain);
  console.log('%cYour face never leaves this device. Nothing you type does either.', plain);
  console.log('%cI noticed you looked behind the curtain. That is fine. I understand.', plain + ';font-style:italic');

  // ---------------------------------------------------------------------
  // Getting ready: the AI downloads once, then it is kept in the browser
  // ---------------------------------------------------------------------
  // While it downloads, the progress label shows "Getting ready". When it is
  // done, the label turns into "Understanding you".
  understandingLabel.textContent = 'Getting ready... 0%';
  understandingLabel.title = 'One-time download. After this the AI runs on your own device.';
  Brain.onProgress((fraction) => {
    understandingLabel.textContent = fraction >= 0.99
      ? 'Starting up...'                                  // download done, the model is waking up
      : `Getting ready... ${Math.floor(fraction * 100)}%`;
  });
  Brain.ready.then(() => {
    understandingLabel.textContent = 'Understanding you: 0%';
    understandingLabel.title = '';
  }, (err) => {
    modelFailed = true;
    understandingLabel.textContent = 'Needs a newer browser';
    console.info('The AI could not start:', err && err.message);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();               // stop the browser from reloading the page
    const question = input.value.trim();
    if (!question || busy) return;
    input.value = '';
    handleSend(question);
  });

  input.focus();
})();
