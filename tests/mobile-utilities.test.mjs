import assert from 'node:assert/strict';
import {
  parseImageDirectives,
  primeUserContent,
  resetPrimingStateForTests,
} from '../demo2/src/mobile/app.js';

export const name = 'mobile text utilities behave predictably';

export async function run() {
  resetPrimingStateForTests();
  const sampleUtterance = 'Show me how Unity is styling things today.';
  const primed = primeUserContent(sampleUtterance);
  assert.ok(
    primed.startsWith('You are Unity'),
    'the first utterance should include the system primer'
  );
  assert.ok(
    primed.endsWith(sampleUtterance),
    'the original utterance should be preserved at the end of the primer'
  );

  const second = primeUserContent(sampleUtterance);
  assert.equal(
    second,
    sampleUtterance,
    'subsequent utterances should not be re-primed'
  );

  resetPrimingStateForTests();
  
  const blockPayload = `Unity responds with art.\n\n\n\`\`\`polli-image\n{\n  "prompt": "A neon skyline dripping with attitude",\n  "width": 768,\n  "images": [\n    { "prompt": "Alternate view", "height": 1024 }\n  ]\n}\n\`\`\``;
  const directives = parseImageDirectives(blockPayload);
  assert.equal(directives.length, 2, 'code block directives should include nested images without duplication');
  assert.equal(directives[0].prompt, 'A neon skyline dripping with attitude');
  assert.equal(directives[0].width, 768);
  assert.equal(directives[1].prompt, 'Alternate view');
  assert.equal(directives[1].height, 1024);
  assert.equal(
    new Set(directives.map(directive => directive.prompt)).size,
    directives.length,
    'each directive prompt should be unique'
  );

  const inlineJson = '{"images": [{ "prompt": "Galaxy horizon", "model": "flux" }] }';
  const inlineDirectives = parseImageDirectives(inlineJson);
  assert.equal(inlineDirectives.length, 1, 'inline JSON should also be parsed for directives');
  assert.equal(inlineDirectives[0].prompt, 'Galaxy horizon');
  assert.equal(inlineDirectives[0].model, 'flux');
}
