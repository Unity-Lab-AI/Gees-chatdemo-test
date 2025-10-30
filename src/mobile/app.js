import { PolliClient, chatStream, image as generateImage } from '../../Libs/pollilib/index.js';

const APP_TITLE = 'Unity Voice Persona';
export const LISTEN_STATUS = {
  idle: 'Tap resume when you want me listening again.',
  listening: 'I\'m listening—spill your thoughts.',
  thinking: 'Buffering your words…',
  speaking: 'Hold up—let me talk.',
  error: 'Something glitched. Try again.',
};

const state = {
  apiConversation: [],
  speaking: false,
  listening: false,
  paused: false,
  interim: '',
  client: new PolliClient({ timeoutMs: 120_000 }),
  latestImageUrl: null,
  streamInFlight: false,
};

const els = {};
let recognition = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let animationId = 0;
let micStream = null;

function renderShell(root) {
  root.innerHTML = `
    <section class="branding" aria-live="polite" aria-atomic="true">
      <h1>${APP_TITLE}</h1>
      <p>Hands-free Pollinations conversation crafted for mobile.</p>
    </section>
    <section class="conversation" id="conversation" aria-live="polite" aria-label="Conversation feed"></section>
    <section class="speech-center" aria-label="Speech controls">
      <div class="wave-shell"><canvas id="waveCanvas" width="320" height="320"></canvas></div>
      <div id="liveTranscript" role="status" aria-live="polite"></div>
      <div class="status-line" id="statusLine">Requesting microphone access…</div>
      <div class="control-row">
        <button id="toggleListening" type="button" aria-pressed="true">Pause Listening</button>
        <button id="resetSession" type="button">Reset Session</button>
      </div>
    </section>
    <div class="image-display" id="imageDisplay" aria-hidden="true">
      <img id="imageElement" alt="Unity generated visual" />
      <div class="image-actions">
        <button id="closeImage" type="button">Close Visual</button>
        <button id="saveImage" type="button">Open in New Tab</button>
      </div>
    </div>
  `;
  els.conversation = root.querySelector('#conversation');
  els.waveCanvas = root.querySelector('#waveCanvas');
  els.statusLine = root.querySelector('#statusLine');
  els.transcript = root.querySelector('#liveTranscript');
  els.toggleListening = root.querySelector('#toggleListening');
  els.resetSession = root.querySelector('#resetSession');
  els.imageDisplay = root.querySelector('#imageDisplay');
  els.imageElement = root.querySelector('#imageElement');
  els.closeImage = root.querySelector('#closeImage');
  els.saveImage = root.querySelector('#saveImage');
}

function setStatus(message, { alert = false } = {}) {
  if (!els.statusLine) return;
  els.statusLine.textContent = message;
  els.statusLine.classList.toggle('alert', alert);
}

function setTranscript(text) {
  if (!els.transcript) return;
  els.transcript.textContent = text || '';
}

function appendMessage(role, text) {
  if (!els.conversation) return null;
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = role === 'user' ? 'You' : 'Unity';
  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = text || '';
  article.append(meta, body);
  els.conversation.appendChild(article);
  els.conversation.scrollTop = els.conversation.scrollHeight;
  return body;
}

function updateMessageBody(bodyEl, text) {
  if (!bodyEl) return;
  bodyEl.textContent = text || '';
  els.conversation.scrollTop = els.conversation.scrollHeight;
}

function clearConversation() {
  if (els.conversation) els.conversation.innerHTML = '';
  state.apiConversation.length = 0;
}

function detectSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setupRecognition() {
  const SpeechRecognition = detectSpeechRecognition();
  if (!SpeechRecognition) {
    setStatus('Speech recognition is not supported on this device.', { alert: true });
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let finalText = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript?.trim();
      if (!transcript) continue;
      if (result.isFinal) {
        finalText += `${finalText ? ' ' : ''}${transcript}`;
      } else {
        interim += `${interim ? ' ' : ''}${transcript}`;
      }
    }
    state.interim = interim;
    setTranscript(interim);
    if (finalText) {
      setTranscript('');
      void processUserUtterance(finalText);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') {
      return;
    }
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setStatus('Microphone permissions are blocked. Enable mic access in your browser settings.', { alert: true });
      state.paused = true;
      state.listening = false;
      els.toggleListening.textContent = 'Resume Listening';
      els.toggleListening.setAttribute('aria-pressed', 'false');
      return;
    }
    setStatus(`Speech error: ${event.error}`, { alert: true });
  };

  recognition.onend = () => {
    state.listening = false;
    if (state.speaking) return;
    if (!state.paused) {
      try {
        recognition.start();
        state.listening = true;
        setStatus(LISTEN_STATUS.listening);
        els.toggleListening.textContent = 'Pause Listening';
        els.toggleListening.setAttribute('aria-pressed', 'true');
      } catch (err) {
        console.warn('Failed to restart recognition', err);
      }
    }
  };
}

function startRecognition() {
  if (!recognition || state.speaking) return;
  try {
    recognition.start();
    state.listening = true;
    state.paused = false;
    setStatus(LISTEN_STATUS.listening);
    els.toggleListening.textContent = 'Pause Listening';
    els.toggleListening.setAttribute('aria-pressed', 'true');
  } catch (err) {
    console.warn('Recognition start failed', err);
  }
}

function stopRecognition({ pause = false } = {}) {
  if (!recognition) return;
  try {
    recognition.stop();
  } catch (err) {
    console.warn('Recognition stop failed', err);
  }
  state.listening = false;
  state.paused = pause;
  els.toggleListening.textContent = 'Resume Listening';
  els.toggleListening.setAttribute('aria-pressed', 'false');
  setStatus(pause ? LISTEN_STATUS.idle : LISTEN_STATUS.thinking);
}

function initCanvas() {
  if (!els.waveCanvas) return;
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext('2d');
  let cssWidth = 0;
  let cssHeight = 0;
  let currentDpr = window.devicePixelRatio || 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    currentDpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * currentDpr;
    canvas.height = cssHeight * currentDpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(currentDpr, currentDpr);
  }

  resize();
  window.addEventListener('resize', resize);

  function render(timestamp) {
    animationId = window.requestAnimationFrame(render);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(currentDpr, currentDpr);
    const width = cssWidth || canvas.width / currentDpr;
    const height = cssHeight || canvas.height / currentDpr;

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(124,77,255,0.8)');
    gradient.addColorStop(1, 'rgba(124,77,255,0.2)');
    ctx.strokeStyle = gradient;

    ctx.beginPath();
    if (analyser && dataArray) {
      analyser.getByteTimeDomainData(dataArray);
      const sliceWidth = width / dataArray.length;
      let x = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
    } else {
      const amplitude = Math.sin(timestamp / 400) * 0.08;
      const centerY = height / 2;
      const segments = 48;
      const step = width / segments;
      for (let i = 0; i <= segments; i += 1) {
        const progress = i / segments;
        const offset = Math.sin(progress * Math.PI * 2 + timestamp / 500) * amplitude;
        const y = centerY + offset * height;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
      }
    }
    ctx.stroke();
  }

  animationId = window.requestAnimationFrame(render);
}

async function initAudio() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Microphone access is not available in this browser.', { alert: true });
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);
    setStatus('Microphone connected.');
    startRecognition();
  } catch (error) {
    console.warn('Audio init failed', error);
    setStatus('Microphone permission denied. Allow mic access to continue.', { alert: true });
  }
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) {
    if (!state.paused && !state.listening) startRecognition();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 1;
  utterance.lang = 'en-US';
  utterance.onstart = () => {
    state.speaking = true;
    stopRecognition();
    setStatus(LISTEN_STATUS.speaking);
  };
  const resumeListening = () => {
    state.speaking = false;
    if (!state.paused) {
      startRecognition();
    } else {
      setStatus(LISTEN_STATUS.idle);
    }
  };
  utterance.onend = resumeListening;
  utterance.onerror = resumeListening;
  window.speechSynthesis.speak(utterance);
}

async function processUserUtterance(text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  const displayBody = appendMessage('user', cleaned);
  updateMessageBody(displayBody, cleaned);
  setStatus(LISTEN_STATUS.thinking);
  state.apiConversation.push({ role: 'user', content: cleaned });
  await streamAssistantReply();
}

async function streamAssistantReply() {
  if (state.streamInFlight) return;
  state.streamInFlight = true;
  const assistantBody = appendMessage('assistant', '');
  let aggregated = '';
  try {
    for await (const chunk of chatStream({ model: 'unity', messages: state.apiConversation }, state.client)) {
      if (typeof chunk !== 'string') continue;
      aggregated += chunk;
      updateMessageBody(assistantBody, aggregated);
      setStatus('Answering in real time…');
    }
  } catch (error) {
    console.error('Streaming error', error);
    updateMessageBody(assistantBody, 'I hit a snag reaching the model. Try again in a moment.');
    setStatus(LISTEN_STATUS.error, { alert: true });
    state.streamInFlight = false;
    return;
  }
  aggregated = aggregated.trim();
  if (aggregated) {
    state.apiConversation.push({ role: 'assistant', content: aggregated });
    await maybeRenderImages(aggregated, assistantBody);
    speak(aggregated);
  } else {
    updateMessageBody(assistantBody, 'No response received. Let\'s try again.');
    setStatus(LISTEN_STATUS.error, { alert: true });
  }
  if (!state.speaking) {
    if (!state.paused) {
      setStatus(LISTEN_STATUS.listening);
    } else {
      setStatus(LISTEN_STATUS.idle);
    }
  }
  state.streamInFlight = false;
}

function parseImageDirectives(text) {
  const directives = [];
  const seen = new Set();
  const pushDirective = (directive) => {
    if (!directive || typeof directive.prompt !== 'string') return;
    const orderedEntries = Object.entries(directive)
      .filter(([, value]) => typeof value !== 'function')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const canonical = JSON.stringify(orderedEntries);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    directives.push(directive);
  };
  const blockRegex = /```polli-image\s*([\s\S]*?)```/gi;
  let match;
  while ((match = blockRegex.exec(text))) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      pushDirective(parsed);
      if (Array.isArray(parsed.images)) {
        for (const img of parsed.images) {
          pushDirective(img);
        }
      }
    } catch (err) {
      console.warn('Failed to parse polli-image block', err);
    }
  }
  const jsonRegex = /\{[\s\S]*?"images"\s*:\s*\[[\s\S]*?\}[\s\S]*?}/g;
  while ((match = jsonRegex.exec(text))) {
    try {
      const candidate = JSON.parse(match[0]);
      if (Array.isArray(candidate.images)) {
        for (const img of candidate.images) {
          pushDirective(img);
        }
      }
    } catch (err) {
      // ignore
    }
  }
  return directives;
}

async function maybeRenderImages(text, assistantBody) {
  const directives = parseImageDirectives(text);
  if (!directives.length) return;
  const directive = directives[0];
  const prompt = directive.prompt || '';
  if (!prompt) return;
  try {
    updateMessageBody(assistantBody, `${text}\n\nGiving that vision Unity's signature flair…`);
    const img = await generateImage(prompt, {
      width: directive.width,
      height: directive.height,
      model: directive.model,
      size: directive.size,
      aspect_ratio: directive.aspect_ratio,
      seed: directive.seed,
    }, state.client);
    const dataUrl = img?.toDataUrl?.();
    if (dataUrl) {
      state.latestImageUrl = dataUrl;
      showImageOverlay(dataUrl, directive.caption || 'Unity visual');
      updateMessageBody(assistantBody, text);
    }
  } catch (error) {
    console.warn('Image generation failed', error);
    setStatus('Visual rendering failed. We can try again.', { alert: true });
  }
}

function showImageOverlay(dataUrl, caption) {
  if (!els.imageDisplay || !els.imageElement) return;
  els.imageElement.src = dataUrl;
  els.imageElement.alt = caption || 'Generated image';
  els.imageDisplay.classList.add('visible');
  els.imageDisplay.setAttribute('aria-hidden', 'false');
}

function hideImageOverlay() {
  if (!els.imageDisplay || !els.imageElement) return;
  els.imageDisplay.classList.remove('visible');
  els.imageDisplay.setAttribute('aria-hidden', 'true');
}

function setupControls() {
  if (!els.toggleListening || !els.resetSession) return;
  els.toggleListening.addEventListener('click', () => {
    if (state.listening && !state.paused) {
      stopRecognition({ pause: true });
    } else {
      startRecognition();
    }
  });
  els.resetSession.addEventListener('click', () => {
    window.speechSynthesis?.cancel();
    clearConversation();
    setTranscript('');
    state.paused = false;
    state.speaking = false;
    state.streamInFlight = false;
    setStatus('Session cleared. Listening again.');
    startRecognition();
  });
  if (els.closeImage) {
    els.closeImage.addEventListener('click', hideImageOverlay);
  }
  if (els.saveImage) {
    els.saveImage.addEventListener('click', () => {
      if (!state.latestImageUrl) return;
      window.open(state.latestImageUrl, '_blank');
    });
  }
  if (els.imageDisplay) {
    els.imageDisplay.addEventListener('click', (event) => {
      if (event.target === els.imageDisplay) {
        hideImageOverlay();
      }
    });
  }
}

function boot() {
  const root = document.getElementById('mobile-app');
  if (!root) return;
  renderShell(root);
  initCanvas();
  setupControls();
  setupRecognition();
  void initAudio();
}

export { boot, parseImageDirectives };
