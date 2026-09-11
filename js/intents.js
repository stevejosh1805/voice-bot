// Rule-based intent parser.
// Pure functions, no DOM access, so it can be unit-tested in Node (see tests/intents.test.mjs).
//
// parseUtterance("move forward 3 steps and then turn left", { botName: "Nova", stepCm: 10 })
//   -> [ { type: "robot", action: "move", dir: "forward", steps: 3, cm: 30 },
//        { type: "robot", action: "rotate", dir: "left", deg: 90 } ]

export const MAX_STEPS = 20;

const SINGLE = {
  zero: 0, one: 1, won: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// Order matters: longer phrases first.
const PHRASES = [
  [/\bone hundred (and )?eighty\b/g, '180'],
  [/\bone eighty\b/g, '180'],
  [/\btwo seventy\b/g, '270'],
  [/\bthree (hundred (and )?)?sixty\b/g, '360'],
  [/\bforty[- ]five\b/g, '45'],
  [/\bhalf (a )?(turn|circle|rotation)\b/g, 'rotate 180 degrees'],
  [/\bquarter (turn|rotation)\b/g, 'rotate 90 degrees'],
  [/\bfull (turn|circle|rotation)\b/g, 'rotate 360 degrees'],
  [/\bu[- ]?turn\b/g, 'rotate 180 degrees'],
  [/\bturn (a)?round\b/g, 'rotate 180 degrees'],
  [/\bturn back\b/g, 'rotate 180 degrees'],
  [/\b(a )?couple( of)?\b/g, '2'],
  [/\b(a )?few\b/g, '3'],
  [/\bseveral\b/g, '3'],
  // Speech-to-text homophones that only make sense right before a unit
  [/\b(to|too)\s+(steps?|met(?:er|re)s?)\b/g, '2 $2'],
  [/\bfor\s+(steps?)\b/g, '4 $1'],
  [/\ban?\s+(step|met(?:er|re)|pace)\b/g, '1 $1'],
];

export function normalize(raw) {
  let t = ' ' + String(raw).toLowerCase()
    .replace(/°/g, ' degrees ')
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9'.\s-]/g, ' ') + ' ';
  t = t.replace(/\.(?!\d)|(?<!\d)\./g, ' ');           // keep decimals like 1.5, drop other dots
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  t = t.replace(/\b(zero|one|won|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    (w) => String(SINGLE[w]));
  t = t.replace(/\b([2-9]0) ([1-9])\b/g, (_, a, b) => String(+a + +b)); // "20 5" -> 25
  t = t.replace(/-/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// ---------- robot motion ----------
const LEFT = /\b(left|anti ?clockwise|counter ?clockwise)\b/;
const RIGHT = /\b(right|clockwise)\b/;
const FORWARD = /\b(forward|forwards|ahead|straight)\b/;
const BACKWARD = /\b(backward|backwards|back|reverse|behind)\b/;
const MOVE_VERB = /\b(move|go|walk|drive|roll|step|head|advance|come|travel)\b/;
const ROTATE_VERB = /\b(rotate|turn|spin|pivot)\b/;
const STOP = /\b(stop|halt|freeze|brake|stay still|don'?t move|do not move)\b/;

function parseMotion(n, stepCm) {
  const words = n.split(' ').length;
  if (words > 12) return null;

  if (STOP.test(n)) return { type: 'robot', action: 'stop' };

  if (ROTATE_VERB.test(n)) {
    const left = LEFT.test(n);
    const right = !left && RIGHT.test(n);
    const m = n.match(/\b(\d{1,3})\s*(degrees?|deg)?\b/);
    let deg = m ? parseInt(m[1], 10) : null;
    if (deg === null && /\bspin\b/.test(n)) deg = 360;
    if (!left && !right && deg === null) {
      if (/\b(rotate|pivot|spin)\b/.test(n) && words <= 3) {
        return { type: 'robot', error: 'Tell me how far to rotate, for example "rotate 90 degrees left".' };
      }
      return null; // e.g. "turn on the lights" — not a motion command
    }
    if (deg === null) deg = 90;
    if (deg < 1 || deg > 720) {
      return { type: 'robot', error: 'I can rotate between 1 and 720 degrees in one command.' };
    }
    return { type: 'robot', action: 'rotate', dir: left ? 'left' : 'right', deg };
  }

  const fwd = FORWARD.test(n);
  const back = BACKWARD.test(n);
  const verb = MOVE_VERB.test(n);
  const numM = n.match(/\b(\d+(?:\.\d+)?)\s*(steps?|paces?|cm|centimet(?:er|re)s?|met(?:er|re)s?|m|units?|blocks?|cells?|squares?)?\b/);

  if (!fwd && !back) {
    // "move 3 steps" with no direction means forward
    if (!(verb && numM && numM[2])) return null;
  }
  if (!verb && !numM && words > 2) return null; // "welcome back to the show"

  let dir = 'forward';
  if (back && !fwd) dir = 'backward';
  else if (back && fwd) dir = n.search(BACKWARD) < n.search(FORWARD) ? 'backward' : 'forward';

  let steps;
  let cm;
  const amount = numM ? parseFloat(numM[1]) : 1;
  const unit = numM && numM[2] ? numM[2] : 'steps';
  if (/^(cm|centi)/.test(unit)) cm = amount;
  else if (/^(m$|met)/.test(unit)) cm = amount * 100;

  if (cm !== undefined) {
    steps = Math.max(1, Math.round(cm / stepCm));
  } else {
    steps = Math.round(amount);
    cm = steps * stepCm;
  }
  if (steps < 1) return { type: 'robot', error: 'Give me a distance of at least one step.' };
  if (steps > MAX_STEPS) {
    return { type: 'robot', error: `That's further than I'll go in one command. Try ${MAX_STEPS} steps or fewer.` };
  }
  return { type: 'robot', action: 'move', dir, steps, cm: Math.round(cm) };
}

// ---------- information intents ----------
const WEATHER = /\b(weather|forecast|raining|rain|umbrella|humidity|humid|sunny|cloudy|how hot|how cold|is it hot|is it cold|temperature (outside|today|now|in|at|like)|outside temperature)\b/;
const TIME = /\b(what'?s? (is )?(the )?time|what time|time (is it|now|please)|current time|tell me the time|time right now)\b/;
const DATE = /\b(what'?s? (is )?(the |today'?s )?date|today'?s date|what day|which day|day is it|day today|what'?s? (is )?today|date today|the date)\b/;
const WHO_AM_I = /\b(who am i|do you (know|recognise|recognize) me|what'?s? (is )?my name|can you see me)\b/;
const BOT_NAME = /\b(what'?s? (is )?your name|who are you|introduce yourself)\b/;
const HELP = /^(help|what can you do|what commands( do you know)?|list (the |your )?commands|what do you do)\b/;
const THANKS = /^(thanks|thank you|thank u|cheers)\b/;
const JOKE = /\b(tell me (a |another )?joke|a joke|make me laugh|say something funny)\b/;
const GREET = /^(hi|hello|hey|hiya|yo|namaste|vanakkam|greetings|good (morning|afternoon|evening|day))\b/;
const HOW_ARE_YOU = /\b(how are you|how'?s? (is )?it going|how do you do|how are things)\b/;

const NOT_PLACES = new Set(['here', 'my area', 'my city', 'my location', 'this city', 'the city', 'outside', 'this area']);

function extractPlace(n) {
  const cleaned = n
    .replace(/\b(today|tomorrow|tonight|right now|now|currently|please|at the moment|this (morning|afternoon|evening|week)|like)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = cleaned.match(/\b(?:in|at|for|near|around)\s+([a-z][a-z' ]*)$/);
  if (!m) return null;
  const place = m[1].replace(/^(the )?city of /, '').trim();
  return NOT_PLACES.has(place) || place.length < 2 ? null : place;
}

function parseSegment(n, opts) {
  const words = n ? n.split(' ').length : 0;

  const motion = parseMotion(n, opts.stepCm);
  if (motion) return motion;

  if (WEATHER.test(n) && words <= 14) {
    return { type: 'weather', place: extractPlace(n), tomorrow: /\btomorrow\b/.test(n) };
  }
  if (n === 'time' || TIME.test(n)) return { type: 'time' };
  if (n === 'date' || DATE.test(n)) return { type: 'date' };
  if (WHO_AM_I.test(n)) return { type: 'whoami' };
  if (BOT_NAME.test(n)) return { type: 'botname' };
  if (HELP.test(n)) return { type: 'help' };
  if (THANKS.test(n) && words <= 4) return { type: 'thanks' };
  if (JOKE.test(n) && words <= 8) return { type: 'joke' };
  if ((GREET.test(n) && words <= 5) || (HOW_ARE_YOU.test(n) && words <= 6)) {
    return { type: 'greet', howAreYou: HOW_ARE_YOU.test(n) };
  }
  return { type: 'chat' };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseUtterance(raw, opts = {}) {
  const o = { botName: '', stepCm: 10, ...opts };
  let text = String(raw || '').trim();
  if (!text) return [];

  // Strip a wake phrase like "hey Nova," so "hey Nova what time is it" becomes a time request.
  if (o.botName) {
    const re = new RegExp(`^(?:(?:hey|hi|hello|ok|okay)\\s+)?${escapeRe(o.botName)}\\b[\\s,.!?-]*`, 'i');
    const stripped = text.replace(re, '');
    if (stripped !== text) {
      if (!stripped.trim()) return [{ type: 'greet', howAreYou: false }];
      text = stripped.trim();
    }
  }

  // Compound commands: "rotate 180 and then move forward 2 steps", "time and date".
  // Only split when every piece is a command we recognise; otherwise the whole sentence goes to chat.
  const pieces = text
    .split(/\s*(?:,|;|\band then\b|\bthen\b|\bafter that\b|\band\b|\balso\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (pieces.length > 1) {
    const parsed = pieces.map((p) => parseSegment(normalize(p), o));
    if (parsed.every((p) => p.type !== 'chat')) return parsed;
  }

  const single = parseSegment(normalize(text), o);
  if (single.type === 'chat') single.text = text;
  return [single];
}
