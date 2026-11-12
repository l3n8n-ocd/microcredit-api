/**
 * Picks the model planner from server-side keys, if any. No `server-only`
 * import, so the CLI can use it too. Keys are read here and never logged.
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import { readSecret } from '../../utils/env.ts'

export interface PlannerModel {
  readonly model: LanguageModel
  readonly label: string
}

export function resolvePlannerModel(env: Record<string, string | undefined> = process.env): PlannerModel | null {
  const anthropic = readSecret(env.ANTHROPIC_API_KEY)
  if (anthropic !== null) {
    const id = env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5'
    return { model: createAnthropic({ apiKey: anthropic })(id), label: id }
  }
  const google = readSecret(env.GOOGLE_GENERATIVE_AI_API_KEY)
  if (google !== null) {
    const id = env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || 'gemini-3.5-flash-lite'
    return { model: createGoogle({ apiKey: google })(id), label: id }
  }
  return null
}
