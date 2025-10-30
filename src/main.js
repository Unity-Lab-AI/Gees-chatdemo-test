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
const SETTINGS_STORAGE_KEY = 'polli-voice-preferences';
const storage = (() => {
  if (!hasWindow) return null;
  try {
    return window.localStorage || null;
  } catch (error) {
    console.warn('Local storage unavailable for voice preferences.', error);
    return null;
  }
})();
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
      <div class="voice-controls" id="voiceControls">
        <label class="select" for="voiceSelect">
          <span>Assistant voice</span>
          <select id="voiceSelect" aria-label="Assistant voice">
            <option value="">System default</option>
          </select>
        </label>
        <label class="toggle" for="autoSpeakToggle">
          <input type="checkbox" id="autoSpeakToggle" checked />
          <span>Speak replies automatically</span>
        </label>
      </div>
      <div class="buttons">
        <button class="mic" id="micButton" type="button">
          <span aria-hidden="true">🎙️</span>
          <span id="micLabel">Start listening</span>
        </button>
        <button class="secondary" id="playSpeakingButton" type="button">Replay last reply</button>
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
  playVoice: document.getElementById('playSpeakingButton'),
  voiceSelect: document.getElementById('voiceSelect'),
  autoSpeakToggle: document.getElementById('autoSpeakToggle'),
  voiceControls: document.getElementById('voiceControls'),
  supportHint: document.getElementById('supportHint'),
};

const state = {
  conversation: [],
  listening: false,
  pending: false,
  recognition: null,
  typedBeforeMic: '',
  autoSpeak: true,
  lastAssistantMessage: '',
  voiceInputSupported,
  voicePlaybackSupported,
  voiceInputUnsupportedMessage,
};

const voiceState = {
  queue: [],
  current: null,
  voices: [],
  selectedVoiceId: null,
};

function computeVoiceId(voice) {
  if (!voice) return '';
  return voice.voiceURI || `${voice.name || 'voice'}::${voice.lang || 'unknown'}`;
}

function loadSettings() {
  if (!storage) return;
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.autoSpeak === 'boolean') {
      state.autoSpeak = data.autoSpeak;
    }
    if (typeof data.selectedVoiceId === 'string' && data.selectedVoiceId) {
      voiceState.selectedVoiceId = data.selectedVoiceId;
    }
  } catch (error) {
    console.warn('Unable to load saved voice preferences.', error);
  }
}

function persistSettings() {
  if (!storage) return;
  try {
    const payload = {
      autoSpeak: !!state.autoSpeak,
      selectedVoiceId: voiceState.selectedVoiceId || '',
    };
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to store voice preferences.', error);
  }
}

function refreshPlayButton() {
  if (!els.playVoice) return;
  const hasMessage = typeof state.lastAssistantMessage === 'string' && state.lastAssistantMessage.trim().length > 0;
  const enabled = state.voicePlaybackSupported && hasMessage;
  els.playVoice.disabled = !enabled;
  if (state.voicePlaybackSupported) {
    els.playVoice.title = enabled
      ? 'Replay the latest assistant reply.'
      : 'Replay is available once the assistant responds.';
  }
}

function populateVoiceOptions() {
  if (!els.voiceSelect) return;
  if (!state.voicePlaybackSupported) {
    els.voiceSelect.innerHTML = '<option value="">Voice playback unavailable</option>';
    els.voiceSelect.disabled = true;
    return;
  }
  els.voiceSelect.disabled = false;
  const voices = speechSynth.getVoices();
  voiceState.voices = Array.isArray(voices) ? voices.slice() : [];
  const hadVoices = voiceState.voices.length > 0;
  const options = [
    '<option value="">System default</option>',
    ...voiceState.voices.map((voice) => {
      const id = computeVoiceId(voice);
      const label = `${escapeHtml(voice.name)} (${escapeHtml(voice.lang || 'unknown')}${voice.default ? ' • default' : ''})`;
      const selected = voiceState.selectedVoiceId === id ? ' selected' : '';
      return `<option value="${escapeHtml(id)}"${selected}>${label}</option>`;
    }),
  ];
  els.voiceSelect.innerHTML = options.join('');
  if (voiceState.selectedVoiceId && hadVoices && !voiceState.voices.some(v => computeVoiceId(v) === voiceState.selectedVoiceId)) {
    voiceState.selectedVoiceId = null;
    persistSettings();
  }
  if (voiceState.selectedVoiceId && voiceState.voices.some(v => computeVoiceId(v) === voiceState.selectedVoiceId)) {
    els.voiceSelect.value = voiceState.selectedVoiceId;
  } else {
    els.voiceSelect.value = '';
  }
}

loadSettings();

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
  if (voiceState.selectedVoiceId) {
    const target = voiceState.voices.find(v => computeVoiceId(v) === voiceState.selectedVoiceId);
    if (target) {
      utterance.voice = target;
      if (target.lang) {
        utterance.lang = target.lang;
      }
    }
  }
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
      state.lastAssistantMessage = reply;
      renderConversation();
      refreshPlayButton();
      if (state.voicePlaybackSupported && state.autoSpeak) {
        startVoicePlaybackForMessage(reply);
        setStatus('Assistant reply ready. Speaking response.');
      } else {
        setStatus('Assistant reply ready. Replay it when you are ready.');
      }
    } else {
      setStatus('The assistant returned an empty response.');
    }
  } catch (error) {
    console.error('Voice app error', error);
    setStatus(`Something went wrong: ${error?.message || error}`);
  } finally {
    els.prompt.value = '';
    refreshPlayButton();
    setPending(false);
  }
}

function handleSendClick() {
  sendMessage(els.prompt.value);
}

function handleReset() {
  stopSpeaking();
  state.conversation = [];
  state.lastAssistantMessage = '';
  renderConversation();
  refreshPlayButton();
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

function setupVoiceControls() {
  if (els.autoSpeakToggle) {
    els.autoSpeakToggle.checked = !!state.autoSpeak;
    els.autoSpeakToggle.title = 'Toggle automatic speech for replies.';
    els.autoSpeakToggle.addEventListener('change', () => {
      state.autoSpeak = els.autoSpeakToggle.checked;
      persistSettings();
    });
  }

  if (!state.voicePlaybackSupported) {
    if (els.voiceSelect) {
      els.voiceSelect.innerHTML = '<option value="">Voice playback unavailable</option>';
      els.voiceSelect.disabled = true;
    }
    if (els.autoSpeakToggle) {
      els.autoSpeakToggle.disabled = true;
    }
    if (els.playVoice) {
      els.playVoice.disabled = true;
    }
    refreshPlayButton();
    return;
  }

  const updateVoices = () => {
    populateVoiceOptions();
    refreshPlayButton();
  };
  updateVoices();

  if (speechSynth) {
    if (typeof speechSynth.addEventListener === 'function') {
      speechSynth.addEventListener('voiceschanged', updateVoices);
    } else {
      speechSynth.onvoiceschanged = updateVoices;
    }
  }

  if (els.voiceSelect) {
    els.voiceSelect.title = 'Choose the voice the assistant uses for playback.';
    els.voiceSelect.addEventListener('change', () => {
      voiceState.selectedVoiceId = els.voiceSelect.value || null;
      persistSettings();
    });
    if (voiceState.selectedVoiceId) {
      els.voiceSelect.value = voiceState.selectedVoiceId;
    }
  }

  if (els.playVoice) {
    els.playVoice.title = 'Replay is available once the assistant responds.';
    els.playVoice.addEventListener('click', () => {
      if (!state.lastAssistantMessage) return;
      startVoicePlaybackForMessage(state.lastAssistantMessage);
    });
  }

  refreshPlayButton();
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
  setupVoiceControls();
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
  if (els.playVoice) {
    els.playVoice.disabled = true;
    els.playVoice.title = 'Voice playback is not available in this browser.';
  }
  if (els.voiceSelect) {
    els.voiceSelect.title = 'Voice playback is not available in this browser.';
  }
}

if (els.supportHint) {
  if (state.voiceInputSupported && state.voicePlaybackSupported) {
    els.supportHint.textContent = 'Tip: Use the microphone button or type a message—adjust the assistant voice or turn speech on/off below.';
  } else if (!state.voiceInputSupported && !state.voicePlaybackSupported) {
    els.supportHint.textContent = 'Voice features are unavailable in this browser. Type to chat with the assistant.';
  } else if (!state.voiceInputSupported) {
    els.supportHint.textContent = state.voiceInputUnsupportedMessage || 'Microphone access is not supported on this browser. Use the replay button to hear responses after typing.';
  } else {
    els.supportHint.textContent = 'You can speak to the assistant, but this browser cannot play audio replies yet.';
  }
}
