/**
 * Phase N.1 — local-AI hook.
 *
 * Speaks the OpenAI/Ollama-compatible `/v1/chat/completions` schema. The
 * default endpoint targets a local Ollama instance (`http://localhost:11434`)
 * so nothing leaves the user's machine unless they explicitly override it.
 *
 * The settings (endpoint, model, opt-in flag) are persisted via
 * `setProfileSetting` so they ride along with the active profile.
 */
import { getProfileSetting, setProfileSetting } from '@/core/db';
import { AI } from './config';

export interface AISettings {
  enabled: boolean;
  endpoint: string;
  model: string;
}

const KEY_ENABLED = 'ai_enabled';
const KEY_ENDPOINT = 'ai_endpoint';
const KEY_MODEL = 'ai_model';

export async function getAISettings(): Promise<AISettings> {
  const [enabled, endpoint, model] = await Promise.all([
    getProfileSetting(KEY_ENABLED),
    getProfileSetting(KEY_ENDPOINT),
    getProfileSetting(KEY_MODEL),
  ]);
  return {
    enabled: enabled === 'true',
    endpoint: endpoint && endpoint.length > 0 ? endpoint : AI.defaultEndpoint,
    model: model && model.length > 0 ? model : AI.defaultModel,
  };
}

export async function saveAISettings(s: AISettings): Promise<void> {
  await Promise.all([
    setProfileSetting(KEY_ENABLED, s.enabled ? 'true' : 'false'),
    setProfileSetting(KEY_ENDPOINT, s.endpoint),
    setProfileSetting(KEY_MODEL, s.model),
  ]);
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

async function chat(messages: ChatMessage[]): Promise<string> {
  const settings = await getAISettings();
  if (!settings.enabled) {
    throw new Error('AI integration is disabled. Enable it in Settings → AI.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI.requestTimeoutMs);
  try {
    const res = await fetch(settings.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as ChatResponse;
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('AI response was empty.');
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Summarize an arbitrary block of text. Trimmed to {@link AI.maxInputChars}. */
export async function summarize(text: string, opts?: { sentences?: number }): Promise<string> {
  const trimmed = text.length > AI.maxInputChars
    ? `${text.slice(0, AI.maxInputChars)}\n…[truncated]`
    : text;
  const sentences = opts?.sentences ?? 3;
  return chat([
    {
      role: 'system',
      content: `You produce concise summaries. Reply with exactly ${sentences} sentence(s), no preamble, no markdown headings.`,
    },
    { role: 'user', content: trimmed },
  ]);
}

/** Suggest 3–6 short tags for a piece of text (comma-separated, lowercase). */
export async function suggestTags(text: string): Promise<string[]> {
  const trimmed = text.length > AI.maxInputChars
    ? text.slice(0, AI.maxInputChars)
    : text;
  const reply = await chat([
    {
      role: 'system',
      content:
        'You suggest 3 to 6 short, lowercase, comma-separated tags for the user-provided text. Reply with ONLY the comma-separated list, no preamble.',
    },
    { role: 'user', content: trimmed },
  ]);
  return reply
    .split(',')
    .map((t) => t.trim().replace(/[^\p{L}\p{N}\-_ ]/gu, '').toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 32)
    .slice(0, 6);
}

/** Direct chat passthrough — exported for future custom flows. */
export const ai = { chat, summarize, suggestTags };
