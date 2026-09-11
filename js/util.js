// Small shared helpers.

const scriptCache = new Map();

/** Load a classic <script> once; resolves when it has executed. */
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptCache.delete(src);
        reject(new Error(`Could not load ${src}. Check your internet connection.`));
      };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Remove markdown and emoji so text-to-speech reads cleanly. */
export function forSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>~]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function timeGreeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const randomId = (n = 6) => Math.random().toString(36).slice(2, 2 + n);
