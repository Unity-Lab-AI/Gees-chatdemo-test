import assert from 'node:assert/strict';
import {
  normalizeMessage,
  pushMessage,
  conversationToDisplay,
  summariseForSpeech,
} from '../src/conversation.js';

export async function run() {
  const result = normalizeMessage('user', '  Hello\n  World  ');
  assert.deepEqual(result, { role: 'user', content: 'Hello\nWorld' });

  assert.throws(() => normalizeMessage('assistant', '   \n  '), /must not be empty/i);

  const history = [normalizeMessage('user', 'Hi')];
  const next = pushMessage(history, 'assistant', 'Hello back');
  assert.equal(history.length, 1);
  assert.equal(next.length, 2);
  assert.deepEqual(next[1], { role: 'assistant', content: 'Hello back' });

  const display = conversationToDisplay([
    { role: 'user', content: ' First message ' },
    { role: 'assistant', content: '   ' },
    { role: 'assistant', content: 'Second message' },
  ]);
  assert.equal(display.length, 2);
  assert.deepEqual(display[0], { id: 1, role: 'user', text: 'First message' });
  assert.deepEqual(display[1], { id: 3, role: 'assistant', text: 'Second message' });

  const long = 'Sentence one. '.repeat(80);
  const summary = summariseForSpeech(long, { maxLength: 120 });
  assert(summary.length <= 121);
  assert(summary.endsWith('.') || summary.endsWith('…'));
}
