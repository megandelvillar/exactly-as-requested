# Exactly As Requested

*A website that understands you better than you understand it.*

A public website that looks alive, full of streams of unreadable code and numbers, with one friendly text box.
Ask it anything. It answers correctly, but shows the answer as **token IDs**, the numbers language models work with.
Meanwhile your face slowly appears, built out of the page's own code, and gets clearer with every message.

**Try it live:** https://megandelvillar.github.io/exactly-as-requested/
(Chrome or Safari on a laptop. The first visit downloads the AI, about 500 MB, so give it a few minutes.)

**Code:** https://github.com/megandelvillar/exactly-as-requested

**There is no server and no API key.** The AI is a small open model that runs inside the visitor's own browser.

## What is in the folder

```
index.html     the page
style.css      the look
stream.js      the background stream of unreadable activity
face.js        the p5.js sketch: the face made of the page's own code
model.js       the AI: loads and runs the model in the browser
app.js         the chat box, rewards, token numbers, hidden decoded answers
dev-server.js  a tiny server for running everything on your own computer
```

No frameworks, no build step, no installs.

## Run it on your computer

You need Node.js (check with `node -v`).

```bash
node dev-server.js
```

Then open http://localhost:3000

(Any static file server works, for example `python3 -m http.server`. The camera only works on `localhost` or on an `https://` address.)

**The first time**, the page downloads the AI model (about 500 MB). The label in the chat card says "Getting ready... NN%".
The browser keeps it afterwards, so later visits start almost instantly.
You can type while it downloads; the answer arrives once it is ready.

Add `?mock` to the address (http://localhost:3000/?mock) to skip the download and see canned answers. Handy for quickly testing the look.

## Deploy for free (static hosting)

Because there is no backend, any free static host works. The folder is the site.

**How this project was deployed:** the folder is a public GitHub repository, and GitHub Pages serves the `main` branch from the root folder (Settings, Pages). The live address is https://megandelvillar.github.io/exactly-as-requested/ and it uses `https`, which the camera needs. To update the site, commit and push to `main`; Pages republishes in a minute or two.

- **GitHub Pages:** push the folder to a GitHub repository, then Settings, Pages, deploy from the `main` branch, root folder. You get an `https://...github.io/...` address, which makes the camera work.
- **Vercel, Netlify or Cloudflare Pages:** also free; import the repository and leave every setting empty (no framework, no build command).

`dev-server.js` and `README.md` will be downloadable on the deployed site. That is fine: there are no secrets anywhere.

## Nothing on screen is made up

- **The background stream** is the site's own source code (index.html, style.css, and the .js files including `model.js`), the real bytes of that source in hex, and the real token IDs of that source text, made by the same tokenizer as the answers.
- **Each answer** starts with a trace of what really ran: the actual lines of `model.js` that executed, plus real values (model name, how many tokens went in and out, milliseconds, tokens per second). Then come the answer's token IDs.

## Privacy

- **Camera:** video frames go into a tiny canvas in memory to pick characters. They are never uploaded, saved or sent anywhere.
- **Messages:** the AI runs on the visitor's own device. What they type never leaves it. There is no server to send it to.
- **The model download** comes from Hugging Face (the model's host) and the code libraries from jsDelivr (a public CDN), like any website that loads files from elsewhere. They see the download, not what visitors type.
- **Conversation memory:** the last few messages are kept in the browser's memory only, so follow-up questions work. Refreshing the page forgets everything.
- No cookies, no analytics, no database.

## Behind the curtain: where the decoded answers are

- **Browser console** (Chrome: Cmd+Option+J, Safari: enable the Develop menu in Settings, then Cmd+Option+C). Every answer is printed decoded.
- **Elements / Inspector panel:** each answer has a `data-decoded="..."` attribute and an HTML comment with the real text.
- **View Source** only shows the original page, before any answer exists, so it only shows the hint comment at the top of `index.html`. Answers are created live, so they appear in the Elements panel instead.

## About the token IDs

The numbers are the model's **own** token IDs. The AI is **Qwen2.5-0.5B-Instruct**, and its tokenizer has about 151,000 tokens. Every number you see is a real token that the model itself produced, then decoded back into text for the console.
(Models behind web APIs, such as Claude, do not expose their token IDs. Running a small open model in the browser is what makes real ones possible.)

## Good to know

- **It is a small model.** It is quick to download and runs on almost any laptop, but it is not as smart as the big AI services. It is good with simple questions, and it can be wrong on hard ones. You can try a bigger one: change `MODEL_ID` in `model.js` to `onnx-community/Qwen2.5-1.5B-Instruct` (about 1.5 GB to download, slower, and better answers).
- **Speed.** It runs on the processor and writes roughly 4 to 12 words per second, depending on the computer. A short answer takes a few seconds.
- **The graphics chip option.** Adding `?gpu` to the address tries the graphics chip (WebGPU), which can be faster. In testing it produced garbled answers on some chips, so it is off by default. If it works well on your computer, you could make it the default in `pickDevices` in `model.js`.
- **Browsers.** Recent Chrome or Safari on a laptop. If the model cannot start, the chat says so, and the stream and the face still work.

## Changing things

| I want to... | Change this |
| --- | --- |
| a different or bigger model | `MODEL_ID` at the top of `model.js` |
| how the AI behaves or how long it answers | `SYSTEM_PROMPT` and `MAX_NEW_TOKENS` in `model.js` |
| how often a real word leaks through | `Math.random() > 0.7` in `pickLeak` in `app.js` |
| how fast the progress bar rises | `0.78` in `understandingFor` in `app.js` |
| how fast the face sharpens | `messagesForDetail` at the top of `face.js` |
| how often the face drifts | `driftEvery` and `driftLength` at the top of `face.js` |
| stream density, speed and colours | the settings at the top of `stream.js` |
