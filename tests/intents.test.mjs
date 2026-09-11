// Run with:  node tests/intents.test.mjs
import { parseUtterance } from '../js/intents.js';

const opts = { botName: 'Nova', stepCm: 10 };
const cases = [
  ['rotate 180', [{ type: 'robot', action: 'rotate', dir: 'right', deg: 180 }]],
  ['rotate one eighty degrees', [{ action: 'rotate', deg: 180 }]],
  ['turn left', [{ action: 'rotate', dir: 'left', deg: 90 }]],
  ['turn right 45°', [{ action: 'rotate', dir: 'right', deg: 45 }]],
  ['turn around', [{ action: 'rotate', deg: 180 }]],
  ['rotate anti-clockwise 90 degrees', [{ action: 'rotate', dir: 'left', deg: 90 }]],
  ['spin', [{ action: 'rotate', deg: 360 }]],
  ['turn on the lights', [{ type: 'chat' }]],
  ['move forward 3 steps', [{ action: 'move', dir: 'forward', steps: 3, cm: 30 }]],
  ['move forward few steps', [{ action: 'move', dir: 'forward', steps: 3 }]],
  ['go back two steps', [{ action: 'move', dir: 'backward', steps: 2 }]],
  ['move forward to steps', [{ action: 'move', steps: 2 }]],
  ['move 50 cm', [{ action: 'move', dir: 'forward', steps: 5, cm: 50 }]],
  ['go ahead 1.5 metres', [{ action: 'move', steps: 15, cm: 150 }]],
  ['move forward 100 steps', [{ type: 'robot', error: true }]],
  ['forward', [{ action: 'move', dir: 'forward', steps: 1 }]],
  ['stop', [{ action: 'stop' }]],
  ['move forward 2 steps and then turn left', [{ action: 'move', steps: 2 }, { action: 'rotate', dir: 'left' }]],
  ['Nova, rotate 90 then go back a step', [{ action: 'rotate', deg: 90 }, { action: 'move', dir: 'backward', steps: 1 }]],
  ['what time is it', [{ type: 'time' }]],
  ["what's the date today", [{ type: 'date' }]],
  ['time and date', [{ type: 'time' }, { type: 'date' }]],
  ['hey nova what time is it', [{ type: 'time' }]],
  ["what's the weather in New Delhi", [{ type: 'weather', place: 'new delhi', tomorrow: false }]],
  ['will it rain in Chennai tomorrow', [{ type: 'weather', place: 'chennai', tomorrow: true }]],
  ['weather', [{ type: 'weather', place: null }]],
  ["what's the weather going forward", [{ type: 'weather' }]],
  ['hello', [{ type: 'greet' }]],
  ['hi nova', [{ type: 'greet' }]],
  ['hello how are you', [{ type: 'greet', howAreYou: true }]],
  ['hello, can you explain how a transistor works', [{ type: 'chat' }]],
  ['tell me about rock and roll', [{ type: 'chat' }]],
  ['who am i', [{ type: 'whoami' }]],
  ['tell me a joke', [{ type: 'joke' }]],
  ['what is the boiling temperature of water', [{ type: 'chat' }]],
  ['how is it going', [{ type: 'greet', howAreYou: true }]],
];

let pass = 0;
for (const [input, expected] of cases) {
  const got = parseUtterance(input, opts);
  const ok = got.length === expected.length && expected.every((e, i) =>
    Object.entries(e).every(([k, v]) => (v === true ? got[i][k] !== undefined : got[i][k] === v)));
  if (ok) pass++;
  else console.log('FAIL', JSON.stringify(input), '\n  got     ', JSON.stringify(got), '\n  expected', JSON.stringify(expected));
}
console.log(`${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
