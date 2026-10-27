/* model.js
 *
 * The AI. It runs INSIDE the visitor's browser, on their own computer.
 * No server, no API key, nothing is sent anywhere: the model file is
 * downloaded once (then kept in the browser's cache) and runs locally.
 *
 * We use transformers.js, a library that runs Hugging Face models in the
 * browser, and Qwen2.5-0.5B-Instruct, a small open chat model.
 *
 * Bonus for this piece: because we run the model ourselves, we get its OWN
 * token IDs, the real numbers it reads and writes. Nothing is borrowed from
 * another model.
 *
 * This file offers one global object, window.Brain:
 *   Brain.onProgress(fn)    fn(fraction 0..1) while the model downloads
 *   Brain.tokenizerReady    promise: the tokenizer is loaded (fast, ~7 MB)
 *   Brain.ready             promise: the whole model is loaded
 *   Brain.tokenize(text)    text -> token IDs        (after tokenizerReady)
 *   Brain.decode(ids)       token IDs -> text        (after tokenizerReady)
 *   Brain.generate(history) the answer: { ids, text, info }
 */

(() => {
  // ---- Settings you can tweak ----
  // Version pinned so the library never changes under us.
  const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  // A bigger model answers better but downloads more. Try 'onnx-community/Qwen2.5-1.5B-Instruct' (about 1 GB).
  const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
  const MAX_NEW_TOKENS = 200;      // longest answer, in tokens
  const MAX_HISTORY = 6;           // how many recent messages the model sees

  // Our instructions to the AI. The visitor never sees these.
  const SYSTEM_PROMPT =
    'You are a helpful assistant. Do exactly what the user asks, accurately and clearly. ' +
    'Reply in plain text only: no markdown, no bullet symbols, no headings. ' +
    'Keep answers under about 80 words unless the user asks for more.';

  // With ?mock in the address, skip the download completely (for quick tests of the look).
  if (new URLSearchParams(location.search).has('mock')) {
    window.Brain = {
      mock: true,
      onProgress() {},
      tokenizerReady: new Promise(() => {}),   // never finishes, so nothing waits on it
      ready: Promise.resolve(),
    };
    return;
  }

  let tokenizer = null;
  let model = null;
  let deviceUsed = '';
  let dtypeUsed = '';
  const progressListeners = [];

  // ---------------------------------------------------------------------
  // Download progress
  // ---------------------------------------------------------------------
  // The library reports progress per file. We add the files up into one number.
  // Files are only reported once they start, so small files (config.json) would
  // make the bar hit 100% long before the big model file begins. To avoid that,
  // we divide by the size we EXPECT in total (about 520 MB for this model).
  const EXPECTED_BYTES = 520e6;
  const files = {};
  let highest = 0;
  function reportProgress(info) {
    if (info.status === 'progress' && info.total) {
      files[info.file] = { loaded: info.loaded, total: info.total };
      let loaded = 0, total = 0;
      for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
      // Stop at 99%: the last step (starting the model) happens after the download.
      highest = Math.max(highest, Math.min(0.99, loaded / Math.max(total, EXPECTED_BYTES)));
      progressListeners.forEach((fn) => fn(highest));
    }
  }

  // ---------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------
  let libraryPromise = null;
  function loadLibrary() {
    // A dynamic import() loads a module from a URL while the page is running,
    // so we need no build step.
    libraryPromise = libraryPromise || import(LIBRARY_URL);
    return libraryPromise;
  }

  const tokenizerReady = (async () => {
    const { AutoTokenizer, env } = await loadLibrary();
    env.allowLocalModels = false;       // always fetch from Hugging Face, never from this site
    // Run the model in a background worker, so the face and the stream keep
    // moving smoothly while the AI is thinking.
    env.backends.onnx.wasm.proxy = true;
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  })();

  // Which way can this computer run the model?
  //   wasm   = on the processor. About 12 words per second, and correct everywhere.
  //   webgpu = on the graphics chip. Can be much faster, but in testing it gave
  //            garbled answers on some graphics chips, so it is OFF unless you
  //            add ?gpu to the address (http://localhost:3000/?gpu) to try it.
  async function pickDevices() {
    const options = [];
    if (new URLSearchParams(location.search).has('gpu')) {
      try {
        const adapter = navigator.gpu && await navigator.gpu.requestAdapter();
        if (adapter) {
          options.push({ device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4' });
        }
      } catch { /* no WebGPU */ }
    }
    options.push({ device: 'wasm', dtype: 'q8' });
    return options;
  }

  const ready = (async () => {
    const { AutoModelForCausalLM } = await loadLibrary();
    await tokenizerReady;
    let lastError;
    for (const { device, dtype } of await pickDevices()) {
      try {
        model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
          device, dtype, progress_callback: reportProgress,
        });
        deviceUsed = device;
        dtypeUsed = dtype;
        return;
      } catch (err) {
        lastError = err;
        console.info(`Model could not start on ${device}:`, err && err.message);
      }
    }
    throw lastError;
  })();
  // If loading fails, the page keeps working; app.js shows a friendly message.
  ready.catch(() => {});
  tokenizerReady.catch(() => {});

  // ---------------------------------------------------------------------
  // Using the model
  // ---------------------------------------------------------------------
  // The tokenizer turns text into token IDs (and back).
  const tokenize = (text) => Array.from(tokenizer.encode(text), Number);
  const decode = (ids) => tokenizer.decode(ids, { skip_special_tokens: false });

  async function generate(history) {
    await ready;
    const startedAt = performance.now();

    // 1. Build the full prompt: our instructions + the recent conversation,
    //    wrapped in the special markers this model was trained on.
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.slice(-MAX_HISTORY)];
    const inputs = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
    });
    const promptTokens = inputs.input_ids.dims[1];

    // 2. Let the model write the answer, one token at a time.
    //    do_sample: false means "always take the most likely next token",
    //    which gives the most accurate answers.
    const output = await model.generate({
      ...inputs,
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
      repetition_penalty: 1.1,
    });

    // 3. The output holds the prompt AND the answer. Keep only the answer's IDs,
    //    and stop at the model's "I am finished" marker.
    const all = output.tolist()[0].map(Number);
    let ids = all.slice(promptTokens);
    const stops = [].concat(model.generation_config?.eos_token_id ?? []);
    const stopAt = ids.findIndex((id) => stops.includes(id));
    if (stopAt !== -1) ids = ids.slice(0, stopAt);

    const text = tokenizer.decode(ids, { skip_special_tokens: true }).trim();
    const ms = Math.round(performance.now() - startedAt);

    return {
      ids,
      text,
      info: {
        device: deviceUsed,
        dtype: dtypeUsed,
        modelName: MODEL_ID.split('/')[1],
        promptTokens,
        newTokens: ids.length,
        ms,
        tokensPerSecond: Math.round((ids.length / ms) * 1000),
      },
    };
  }

  window.Brain = {
    onProgress(fn) { progressListeners.push(fn); },
    tokenizerReady,
    ready,
    tokenize,
    decode,
    generate,
  };
})();
