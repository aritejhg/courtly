import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_REPAIR_MODEL, resolveLlmRepairConfig } from '../scripts/lib/llm-repair-config.mjs';

const config = (env = {}, argv = []) => resolveLlmRepairConfig({ env, argv });

test('LLM repair is off unless explicitly enabled', () => {
  assert.equal(config().enabled, false);
  for (const value of ['0', 'true', 'yes', '']) {
    assert.equal(config({ COURTLY_ENABLE_LLM_REPAIR: value }).enabled, false);
  }
  assert.equal(config({ COURTLY_ENABLE_LLM_REPAIR: '1' }).enabled, true);
});

test('existing kill switches override the opt-in', () => {
  const COURTLY_ENABLE_LLM_REPAIR = '1';
  assert.equal(config({ COURTLY_ENABLE_LLM_REPAIR, COURTLY_DISABLE_LLM: '1' }).enabled, false);
  assert.equal(config({ COURTLY_ENABLE_LLM_REPAIR }, ['--no-llm']).enabled, false);
});

test('repair model is configurable and blank values use the default', () => {
  assert.equal(config().model, DEFAULT_REPAIR_MODEL);
  assert.equal(config({ COURTLY_REPAIR_MODEL: '  ' }).model, DEFAULT_REPAIR_MODEL);
  assert.equal(config({ COURTLY_REPAIR_MODEL: 'other-model' }).model, 'other-model');
});

test('the runner uses the opt-in config and has no Chrome read path', async () => {
  const source = await readFile(new URL('../scripts/run-local-ingestion.mjs', import.meta.url), 'utf8');
  assert.match(source, /resolveLlmRepairConfig\(\)/);
  assert.doesNotMatch(source, /COURTLY_DISABLE_LLM|--no-llm/);
  assert.doesNotMatch(source, /chrome/i);
});
