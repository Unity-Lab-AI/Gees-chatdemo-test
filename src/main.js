import './style.css';
import { chat } from '../Libs/pollilib/index.js';
import { pushMessage, conversationToDisplay, summariseForSpeech } from './conversation.js';

const hasWindow = typeof window !== 'undefined';
const SpeechRecognition = hasWindow
  ? window.SpeechRecognition || window.webkitSpeechRecognition || null
  : null;
const speechSynth = hasWindow && 'speechSynthesis' in window ? window.speechSynthesis : null;
const SpeechSynthesisUtteranceCtor = hasWindow && typeof window.SpeechSynthesisUtterance === 'function'
  ? window.SpeechSynthesisUtterance
  : (typeof globalThis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function'
    ? globalThis.SpeechSynthesisUtterance
    : null);
const navigatorRef = hasWindow && typeof window.navigator === 'object' ? window.navigator : null;
const hasMediaDevices = Boolean(
  navigatorRef && navigatorRef.mediaDevices && typeof navigatorRef.mediaDevices.getUserMedia === 'function',
);
const voiceInputSupported = Boolean(SpeechRecognition && hasMediaDevices);
const voicePlaybackSupported = Boolean(speechSynth && SpeechSynthesisUtteranceCtor);
const TTS_CHUNK_MAX_CHARS = 250;
const voiceInputUnsupportedMessage = !SpeechRecognition
  ? 'Voice input is not supported in this browser. You can still type messages.'
  : !hasMediaDevices
    ? 'Microphone access is unavailable in this browser. Type messages instead.'
    : '';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('Root #app element not found.');
}

app.innerHTML = `
  <main class="voice-app" role="application" aria-label="Pollinations voice assistant">
    <header class="toolbar">
      <div>
        <h1>Polli Voice Studio</h1>
        <p class="status" id="statusText">Ready to listen.</p>
      </div>
      <div>
        <button class="secondary" id="resetButton" type="button">Clear conversation</button>
      </div>
    </header>
    <section class="conversation" id="conversation" aria-live="polite" aria-label="Conversation transcript"></section>
    <footer class="controls">
      <textarea id="promptInput" placeholder="Type a message or use the microphone" aria-label="Message"></textarea>
      <div class="buttons">
        <button class="mic" id="micButton" type="button">
          <span aria-hidden="true">🎙️</span>
          <span id="micLabel">Start listening</span>
        </button>
        <button class="secondary" id="stopSpeakingButton" type="button">Stop voice</button>
        <button class="primary" id="sendButton" type="button">Send message</button>
      </div>
      <p class="hint" id="supportHint">Tip: The assistant will speak replies aloud when voice playback is supported.</p>
    </footer>
  </main>
`;

const els = {
  conversation: document.getElementById('conversation'),
  status: document.getElementById('statusText'),
  prompt: document.getElementById('promptInput'),
  mic: document.getElementById('micButton'),
  micLabel: document.getElementById('micLabel'),
  send: document.getElementById('sendButton'),
  reset: document.getElementById('resetButton'),
  stopVoice: document.getElementById('stopSpeakingButton'),
  supportHint: document.getElementById('supportHint'),
};

const state = {
  conversation: [],
  listening: false,
  pending: false,
  recognition: null,
  typedBeforeMic: '',
  voiceInputSupported,
  voicePlaybackSupported,
  voiceInputUnsupportedMessage,
};

const voiceState = {
  queue: [],
  current: null,
};

function buildTtsChunks(text, { maxChars = TTS_CHUNK_MAX_CHARS } = {}) {
  if (!text) return [];
  const sanitized = String(text).replace(/\s+/g, ' ').trim();
  if (!sanitized) return [];
  const chunks = [];
  let current = '';
  const words = sanitized.split(' ');
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
      if (current.length > maxChars) {
        for (let i = 0; i < current.length; i += maxChars) {
          const slice = current.slice(i, i + maxChars);
          if (slice) chunks.push(slice);
        }
        current = '';
      }
    } else if (candidate.length > maxChars) {
      for (let i = 0; i < candidate.length; i += maxChars) {
        const slice = candidate.slice(i, i + maxChars);
        if (slice) chunks.push(slice);
      }
      current = '';
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderConversation() {
  const items = conversationToDisplay(state.conversation);
  if (!items.length) {
    els.conversation.innerHTML = '<p class="hint">No messages yet. Ask a question or try the microphone.</p>';
    return;
  }
  const parts = items
    .map(item => `
      <article class="message ${item.role}">
        <h2>${item.role === 'assistant' ? 'Assistant' : item.role === 'system' ? 'System' : 'You'}</h2>
        <p>${escapeHtml(item.text).replace(/\n/g, '<br />')}</p>
      </article>
    `)
    .join('');
  els.conversation.innerHTML = parts;
  els.conversation.scrollTop = els.conversation.scrollHeight;
}

function setStatus(message) {
  if (els.status) {
    els.status.textContent = message;
  }
}

function setPending(pending) {
  state.pending = pending;
  els.send.disabled = pending;
  els.mic.disabled = !state.voiceInputSupported || (pending && !state.listening);
  els.reset.disabled = pending;
}

function speakChunk(chunk) {
  if (!chunk) return;
  const utterance = new SpeechSynthesisUtteranceCtor(chunk);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => {
    if (!voiceState.queue.length) {
      voiceState.current = null;
      return;
    }
    const next = voiceState.queue.shift();
    voiceState.current = next;
    speakChunk(next);
  };
  speechSynth.speak(utterance);
}

function startVoicePlaybackForMessage(raw) {
  if (!state.voicePlaybackSupported || !raw) return;
  speechSynth.cancel();
  voiceState.queue = [];
  voiceState.current = null;
  const summary = summariseForSpeech(raw, { maxLength: 600 });
  if (!summary) return;
  const rawChunks = buildTtsChunks(raw, { maxChars: TTS_CHUNK_MAX_CHARS });
  const chunks = rawChunks.length ? rawChunks : buildTtsChunks(summary, { maxChars: TTS_CHUNK_MAX_CHARS });
  if (!chunks.length) return;
  voiceState.queue = chunks.slice(1);
  voiceState.current = chunks[0];
  speakChunk(chunks[0]);
}

function stopSpeaking() {
  if (state.voicePlaybackSupported) {
    speechSynth.cancel();
  }
  voiceState.queue = [];
  voiceState.current = null;
}

async function sendMessage(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    setStatus('Please provide something to send.');
    return;
  }

  setStatus('Sending to Pollinations…');
  stopSpeaking();
  setPending(true);

  try {
    state.conversation = pushMessage(state.conversation, 'user', text);
    renderConversation();

    const response = await chat({
      model: 'openai',
      messages: state.conversation,
    });

    const reply = response?.choices?.[0]?.message?.content;
    if (reply) {
      state.conversation = pushMessage(state.conversation, 'assistant', reply);
      renderConversation();
      startVoicePlaybackForMessage(reply);
      setStatus('Assistant reply ready.');
    } else {
      setStatus('The assistant returned an empty response.');
    }
  } catch (error) {
    console.error('Voice app error', error);
    setStatus(`Something went wrong: ${error?.message || error}`);
  } finally {
    els.prompt.value = '';
    setPending(false);
  }
}

function handleSendClick() {
  sendMessage(els.prompt.value);
}

function handleReset() {
  stopSpeaking();
  state.conversation = [];
  renderConversation();
  setStatus('Conversation cleared. Ready to listen.');
}

function updateMicButton() {
  if (!state.voiceInputSupported) {
    els.mic.classList.remove('listening');
    els.micLabel.textContent = 'Voice unavailable';
    return;
  }
  const { listening } = state;
  els.mic.classList.toggle('listening', listening);
  els.micLabel.textContent = listening ? 'Listening… tap to stop' : 'Start listening';
}

function setupVoice() {
  if (!state.voiceInputSupported) {
    els.mic.disabled = true;
    els.micLabel.textContent = 'Voice unavailable';
    els.mic.title = state.voiceInputUnsupportedMessage;
    setStatus(state.voiceInputUnsupportedMessage);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.listening = true;
    state.typedBeforeMic = els.prompt.value;
    els.prompt.value = '';
    updateMicButton();
    setStatus('Listening… speak now.');
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error', event);
    setStatus(`Microphone error: ${event.error || 'unknown error'}`);
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) {
        recognition.stop();
        const finalText = transcript.trim();
        if (finalText) {
          sendMessage(finalText);
        }
        return;
      }
      interim += transcript;
    }
    els.prompt.value = interim;
  };

  recognition.onend = () => {
    state.listening = false;
    if (!els.prompt.value) {
      els.prompt.value = state.typedBeforeMic;
    }
    state.typedBeforeMic = '';
    updateMicButton();
    if (!state.pending) {
      setStatus('Ready to listen.');
    }
  };

  state.recognition = recognition;
  els.mic.addEventListener('click', () => {
    if (state.listening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        setStatus(`Unable to start microphone: ${err?.message || err}`);
      }
    }
  });
}

function wireEvents() {
  els.send.addEventListener('click', handleSendClick);
  els.reset.addEventListener('click', handleReset);
  els.stopVoice.addEventListener('click', stopSpeaking);
  els.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSendClick();
    }
  });
  setupVoice();
}

renderConversation();
wireEvents();
if (state.voiceInputSupported) {
  setStatus('Ready to listen.');
} else if (state.voiceInputUnsupportedMessage) {
  setStatus(state.voiceInputUnsupportedMessage);
}
updateMicButton();

if (!state.voicePlaybackSupported) {
  els.stopVoice.disabled = true;
  els.stopVoice.title = 'Voice playback is not available in this browser.';
}

if (els.supportHint) {
  if (state.voiceInputSupported && state.voicePlaybackSupported) {
    els.supportHint.textContent = 'Tip: Use the microphone button or type a message—the assistant will speak replies aloud.';
  } else if (!state.voiceInputSupported && !state.voicePlaybackSupported) {
    els.supportHint.textContent = 'Voice features are unavailable in this browser. Type to chat with the assistant.';
  } else if (!state.voiceInputSupported) {
    els.supportHint.textContent = state.voiceInputUnsupportedMessage || 'Microphone access is not supported on this browser. Type messages instead.';
  } else {
    els.supportHint.textContent = 'You can speak to the assistant, but this browser cannot play audio replies yet.';
  }
}
