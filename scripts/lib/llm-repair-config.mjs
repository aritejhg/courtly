export const DEFAULT_REPAIR_MODEL = 'gpt-5.6-luna';

/**
 * LLM repair feeds untrusted Telegram text to an unattended agent, so it runs only on
 * explicit request. --no-llm and COURTLY_DISABLE_LLM=1 still win over the opt-in.
 */
export function resolveLlmRepairConfig({ argv = process.argv, env = process.env } = {}) {
  const optedIn = env.COURTLY_ENABLE_LLM_REPAIR === '1';
  const vetoed = argv.includes('--no-llm') || env.COURTLY_DISABLE_LLM === '1';
  return {
    enabled: optedIn && !vetoed,
    model: env.COURTLY_REPAIR_MODEL?.trim() || DEFAULT_REPAIR_MODEL,
  };
}
