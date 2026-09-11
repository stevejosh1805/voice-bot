// Settings live in this browser only (localStorage). Nothing is sent to GitHub.
import { randomId } from './util.js';

const KEY = 'voicebot.settings.v1';

// Model names change often. Check your provider's model list if a request fails.
export const MODEL_DEFAULTS = {
  off: '',
  gemini: 'gemini-3.1-flash-lite',
  openai: 'llama-3.3-70b-versatile',
  anthropic: 'claude-haiku-4-5-20251001',
};

export const DEFAULTS = {
  botName: 'Nova',
  lang: 'en-IN',
  voice: '',
  rate: 1,

  provider: 'off',          // off | gemini | openai | anthropic
  apiKey: '',
  model: '',
  baseUrl: 'https://api.groq.com/openai/v1',

  city: '',
  units: 'celsius',

  greetUnknown: true,
  matchThreshold: 0.5,

  linkMode: 'sim',          // sim | mqtt | ws
  mqttUrl: 'wss://broker.hivemq.com:8884/mqtt',
  topic: '',
  wsUrl: 'ws://192.168.1.50:81',
  stepCm: 10,
};

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    saved = {};
  }
  const s = { ...DEFAULTS, ...saved };
  if (!s.topic) s.topic = `voicebot/${randomId()}`;
  if (!s.model) s.model = MODEL_DEFAULTS[s.provider] || '';
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
