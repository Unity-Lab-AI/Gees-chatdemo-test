const ROLES = new Set(['user', 'assistant', 'system']);

function normalizeContent(content) {
  const raw = String(content ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  return lines.join('\n');
}

export function normalizeMessage(role, content) {
  const trimmedRole = String(role || '').trim().toLowerCase();
  if (!ROLES.has(trimmedRole)) {
    throw new TypeError(`Unsupported role "${role}".`);
  }
  const text = normalizeContent(content);
  if (!text) {
    throw new TypeError('Message content must not be empty.');
  }
  return { role: trimmedRole, content: text };
}

export function pushMessage(history, role, content) {
  const safeHistory = Array.isArray(history) ? history.slice() : [];
  const msg = normalizeMessage(role, content);
  safeHistory.push(msg);
  return safeHistory;
}

export function conversationToDisplay(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry, index) => {
      const normalized = typeof entry === 'object' && entry ? entry : {};
      const role = typeof normalized.role === 'string' ? normalized.role : 'user';
      const content = typeof normalized.content === 'string' ? normalized.content : '';
      return {
        id: index + 1,
        role,
        text: normalizeContent(content),
      };
    })
    .filter(item => item.text.length > 0);
}

export function summariseForSpeech(text, { maxLength = 500 } = {}) {
  const raw = normalizeContent(text);
  if (!raw) return '';
  if (raw.length <= maxLength) return raw;
  const truncated = raw.slice(0, maxLength);
  const lastSentence = truncated.lastIndexOf('.');
  if (lastSentence > maxLength * 0.6) {
    return truncated.slice(0, lastSentence + 1);
  }
  return `${truncated}…`;
}
