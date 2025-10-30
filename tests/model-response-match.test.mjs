import assert from 'node:assert/strict';
import { createFallbackModel } from '../demo2/src/model-catalog.js';
import { doesResponseMatchModel, isMatchingModelName } from '../demo2/src/model-matching.js';

export const name = 'Model response metadata allows alias matching';

export async function run() {
  const model = createFallbackModel('unity', 'Unity Seed Model', ['seed', 'openai']);

  assert(isMatchingModelName('unity', model), 'Model should match its own identifier');

  assert(
    doesResponseMatchModel({ model: 'unity' }, model),
    'Exact model name should match',
  );

  assert(
    doesResponseMatchModel(
      { model: 'mistral-small', requested_model: 'unity' },
      model,
    ),
    'requested_model should allow alias matching',
  );

  assert(
    doesResponseMatchModel(
      { model: 'mistral-small', metadata: { alias: 'Pollinations/Unity' } },
      model,
    ),
    'metadata alias should allow alias matching',
  );

  assert(
    !doesResponseMatchModel({ model: 'mistral-small' }, model),
    'Unknown model identifiers should not match',
  );
}
