// Wires everything together: face greeting, voice in/out, intents, robot link and simulator.
import { loadSettings, saveSettings, MODEL_DEFAULTS } from './settings.js';
import { parseUtterance } from './intents.js';
import { Voice } from './speech.js';
import { FaceGreeter } from './face.js';
import { RobotLink } from './robot.js';
import { RobotSim } from './sim.js';
import { getWeather } from './weather.js';
import { chatReply } from './chat.js';
import { timeGreeting } from './util.js';

const $ = (id) => document.getElementById(id);
const ABSENCE_MS = 60_000;      // greet someone again after they've been away this long
const PRESENT_MS = 5_000;       // how long a recognised face counts as "here" after last seen
const HISTORY_TURNS = 12;

let settings = loadSettings();
saveSettings(settings);

const state = {
  history: [],
  currentUser: null,
  currentSeenAt: 0,
  lastSeen: {},
  unknownStreak: 0,
  lastUnknownGreet: 0,
  cameraOn: false,
};

// ---------------------------------------------------------------- UI helpers
function setStatus(el, s, text) {
  el.dataset.state = s;
  el.textContent = text;
}

function addMessage(role, text, meta = {}) {
  const li = document.createElement('li');
  li.className = `msg ${role}${meta.kind ? ` k-${meta.kind}` : ''}`;
  if (meta.label) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = meta.label;
    li.append(tag);
  }
  const p = document.createElement('p');
  p.textContent = text;
  li.append(p);
  $('log').append(li);
  li.scrollIntoView({ block: 'end' });
  return li;
}

function remember(role, text) {
  state.history.push({ role, text });
  if (state.history.length > HISTORY_TURNS) state.history.splice(0, state.history.length - HISTORY_TURNS);
}

// ---------------------------------------------------------------- voice
const voice = new Voice({
  lang: settings.lang,
  onInterim: (t) => { $('interim').textContent = t; },
  onFinal: (t) => { $('interim').textContent = ''; handleInput(t); },
  onState: (s) => {
    const on = s === 'listening';
    $('btnMic').setAttribute('aria-pressed', String(on));
    $('btnMic').setAttribute('aria-label', on ? 'Stop listening' : 'Start listening');
    setStatus($('stMic'), on ? 'listening' : 'off', on ? 'Listening' : 'Mic ready');
    if (!on && $('interim').textContent === 'Listening…') $('interim').textContent = '';
    if (on) $('interim').textContent = 'Listening…';
  },
  onError: (msg) => addMessage('system', msg),
});
voice.voiceName = settings.voice;
voice.rate = Number(settings.rate) || 1;

if (!voice.canListen) {
  $('btnMic').disabled = true;
  $('btnMic').title = 'Speech recognition needs Chrome or Edge';
  setStatus($('stMic'), 'error', 'No speech input in this browser');
}

$('btnMic').addEventListener('click', () => voice.toggle());

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, button, dialog, summary');
  if (e.code === 'Space' && !typing && voice.canListen) {
    e.preventDefault();
    voice.toggle();
  }
  if (e.key === 'Escape' && voice.listening) voice.stop();
});

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('textIn').value;
  $('textIn').value = '';
  handleInput(t);
});

$('btnClear').addEventListener('click', () => {
  $('log').replaceChildren();
  state.history = [];
});

// ---------------------------------------------------------------- robot
const sim = new RobotSim($('sim'), (s) => {
  $('rdPos').textContent = `${s.x}, ${s.y}`;
  $('rdHead').textContent = `${s.heading}°`;
  $('rdBusy').textContent = s.busy ? (s.queued ? `Moving, ${s.queued} queued` : 'Moving') : 'Idle';
  $('rdBusy').classList.toggle('busy', s.busy);
});

const robot = new RobotLink({
  onState: (s, text) => setStatus($('stLink'), s, text),
  onMessage: (msg) => addMessage('system', `Robot: ${msg}`),
});
robot.configure(settings);

function describe(cmd) {
  if (cmd.action === 'stop') return 'Stopping.';
  if (cmd.action === 'rotate') return `Rotating ${cmd.deg} degrees ${cmd.dir}.`;
  const unit = cmd.steps === 1 ? 'step' : 'steps';
  return `Moving ${cmd.dir} ${cmd.steps} ${unit}.`;
}

function runRobot(cmd) {
  const full = { ...cmd };
  if (full.action === 'move' && full.cm === undefined) full.cm = full.steps * settings.stepCm;
  const { packet, delivered } = robot.send(full);
  sim.enqueue(full);
  $('lastPacket').textContent = JSON.stringify(packet, null, 2);
  let text = describe(full);
  if (settings.linkMode !== 'sim' && !delivered) text += ' The robot link is offline, so this ran in the simulator only.';
  return text;
}

document.querySelector('.pad').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (!b) return;
  const text = runRobot(JSON.parse(b.dataset.cmd));
  addMessage('bot', text, { kind: 'robot', label: 'Manual control' });
});

$('btnReset').addEventListener('click', () => sim.reset());

// ---------------------------------------------------------------- intents -> replies
const JOKES = [
  'Why did the robot go on holiday? It needed to recharge.',
  'I tried to tell a joke about my wheels, but it kept going round in circles.',
  'My favourite kind of music? Heavy metal, naturally.',
  'Why was the robot so calm under pressure? Nerves of steel.',
];

function whoIsHere() {
  if (state.currentUser && Date.now() - state.currentSeenAt < PRESENT_MS) return state.currentUser;
  return null;
}

async function respond(intent) {
  const name = whoIsHere();
  const lang = settings.lang;

  switch (intent.type) {
    case 'robot':
      if (intent.error) return { text: intent.error, kind: 'robot', label: 'Robot' };
      return { text: runRobot(intent), kind: 'robot', label: 'Robot command' };

    case 'weather': {
      $('interim').textContent = 'Checking the weather…';
      try {
        const text = await getWeather({
          place: intent.place, defaultCity: settings.city, units: settings.units, tomorrow: intent.tomorrow,
        });
        return { text, label: 'Weather' };
      } finally {
        $('interim').textContent = '';
      }
    }

    case 'time':
      return { text: `It's ${new Date().toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' })}.`, label: 'Time' };

    case 'date':
      return {
        text: `Today is ${new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
        label: 'Date',
      };

    case 'whoami':
      if (name) return { text: `You're ${name}.`, kind: 'face', label: 'Face recognition' };
      if (!state.cameraOn) return { text: "Start the camera and I'll try to recognise you." };
      return { text: "I can't see anyone I know right now. Use Add a face so I can learn who you are." };

    case 'botname':
      return { text: `I'm ${settings.botName}, the voice assistant for this robot.` };

    case 'help':
      return {
        text: 'I can greet you by face, tell you the time, date and weather, chat, and drive the robot. Try "move forward 3 steps", "rotate 180", "turn left" or "stop".',
      };

    case 'thanks':
      return { text: "You're welcome." };

    case 'joke':
      return { text: JOKES[Math.floor(Math.random() * JOKES.length)] };

    case 'greet': {
      const hello = `${timeGreeting()}${name ? `, ${name}` : ''}!`;
      return { text: intent.howAreYou ? `${hello} I'm running smoothly, thanks. How can I help?` : `${hello} How can I help?` };
    }

    case 'chat':
    default:
      return chat(intent.text || '');
  }
}

async function chat(text) {
  if (settings.provider === 'off' || !settings.apiKey) {
    return {
      text: "I can handle greetings, time, date, weather and movement for now. To chat about anything else, add an AI key in Settings.",
      label: 'Built-in reply',
    };
  }
  $('interim').textContent = 'Thinking…';
  try {
    const reply = await chatReply({
      settings,
      history: state.history,
      ctx: {
        botName: settings.botName,
        userName: whoIsHere(),
        now: new Date().toLocaleString(settings.lang, { dateStyle: 'full', timeStyle: 'short' }),
      },
    });
    return { text: reply || "I don't have an answer for that.", label: 'AI reply' };
  } finally {
    $('interim').textContent = '';
  }
}

let queue = Promise.resolve();
function handleInput(raw) {
  // Process one utterance at a time so replies never overlap.
  queue = queue.then(() => processInput(raw)).catch((e) => console.error(e));
  return queue;
}

async function processInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  addMessage('user', text);
  remember('user', text);

  const intents = parseUtterance(text, { botName: settings.botName, stepCm: Number(settings.stepCm) || 10 });
  const replies = [];
  for (const intent of intents) {
    try {
      replies.push(await respond(intent));
    } catch (err) {
      replies.push({ text: err.message || String(err), kind: 'error', label: 'Problem' });
    }
  }
  for (const r of replies) addMessage('bot', r.text, r);
  const spoken = replies.map((r) => r.text).join(' ');
  remember('assistant', spoken);
  voice.speak(spoken);
}

// ---------------------------------------------------------------- faces
const face = new FaceGreeter({
  video: $('video'),
  overlay: $('overlay'),
  threshold: Number(settings.matchThreshold),
  onStatus: (s, text) => setStatus($('stCam'), s, text),
  onFrame: onFaces,
});

function setWelcome(text, cls, fresh = false) {
  const el = $('welcome');
  if (el.textContent !== text) el.textContent = text;
  el.className = `welcome${cls ? ` ${cls}` : ''}`;
  if (fresh) { void el.offsetWidth; el.classList.add('fresh'); }
}

function greetPerson(name) {
  const text = `${timeGreeting()}, ${name}! Welcome back.`;
  setWelcome(`Welcome back, ${name}.`, 'known', true);
  addMessage('bot', text, { kind: 'face', label: 'Face recognition' });
  remember('assistant', text);
  voice.speak(text);
}

function onFaces(faces) {
  const now = Date.now();
  const known = [...new Set(faces.filter((f) => f.name).map((f) => f.name))];

  if (known.length) {
    state.unknownStreak = 0;
    for (const n of known) {
      const last = state.lastSeen[n];
      if (!last || now - last > ABSENCE_MS) greetPerson(n);
      state.lastSeen[n] = now;
    }
    state.currentUser = known[0];
    state.currentSeenAt = now;
    if (!$('welcome').classList.contains('fresh')) setWelcome(`Welcome back, ${known.join(' and ')}.`, 'known');
    return;
  }

  if (faces.length) {
    state.unknownStreak++;
    setWelcome("Someone's here, but I don't recognise them yet.", 'unknown');
    if (settings.greetUnknown && state.unknownStreak >= 4 && now - state.lastUnknownGreet > ABSENCE_MS) {
      state.lastUnknownGreet = now;
      const text = "Hello there! I don't think we've met. Use Add a face so I can remember you.";
      addMessage('bot', text, { kind: 'face', label: 'Face recognition' });
      voice.speak("Hello there! I don't think we've met.");
    }
    return;
  }

  state.unknownStreak = 0;
  if (!whoIsHere()) setWelcome(state.cameraOn ? 'No one in view.' : 'Camera is off.', '');
}

$('welcome').addEventListener('animationend', () => $('welcome').classList.remove('fresh'));

$('btnCam').addEventListener('click', async () => {
  const btn = $('btnCam');
  if (state.cameraOn) {
    face.stop();
    state.cameraOn = false;
    $('viewport').classList.remove('live');
    btn.textContent = 'Start camera';
    $('btnEnroll').disabled = true;
    setWelcome('Camera is off.', '');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    await face.start();
    state.cameraOn = true;
    $('viewport').classList.add('live');
    btn.textContent = 'Stop camera';
    $('btnEnroll').disabled = false;
    setWelcome('No one in view.', '');
    if (!face.list().length) addMessage('system', 'Camera is on. Use Add a face so I can greet you by name.');
  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Camera access is blocked. Allow the camera from the lock icon in the address bar.'
      : err.name === 'NotFoundError' ? 'No camera was found.' : err.message;
    setStatus($('stCam'), 'error', 'Camera problem');
    addMessage('bot', msg, { kind: 'error', label: 'Problem' });
    btn.textContent = 'Start camera';
  } finally {
    btn.disabled = false;
  }
});

// enrolment dialog
function renderFaces() {
  const people = face.list();
  $('faceCount').textContent = people.length;
  const ul = $('faceList');
  ul.replaceChildren(...people.map((p) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.innerHTML = `<strong></strong> <span class="meta"></span>`;
    label.querySelector('strong').textContent = p.name;
    label.querySelector('.meta').textContent = `${p.samples} samples`;
    const del = document.createElement('button');
    del.className = 'btn small quiet';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      if (confirm(`Remove ${p.name}'s saved face?`)) { face.remove(p.name); renderFaces(); }
    });
    li.append(label, del);
    return li;
  }));
  if (!people.length) {
    const li = document.createElement('li');
    li.className = 'meta';
    li.textContent = 'No faces saved yet.';
    ul.append(li);
  }
}
renderFaces();

$('btnEnroll').addEventListener('click', () => {
  $('enrollProgress').textContent = '';
  $('enrollProgress').classList.remove('error');
  $('enrollName').value = '';
  $('enrollDlg').showModal();
  $('enrollName').focus();
});
$('enrollCancel').addEventListener('click', () => $('enrollDlg').close());

$('enrollForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('enrollName').value;
  const prog = $('enrollProgress');
  const go = $('enrollGo');
  prog.classList.remove('error');
  go.disabled = true;
  try {
    const saved = await face.enroll(name, {
      samples: 5,
      onProgress: (n, total, issue) => {
        prog.textContent = issue === 'none' ? `Can't see a face. Look at the camera. (${n} of ${total})`
          : issue === 'many' ? `I see more than one face. Only one person, please. (${n} of ${total})`
          : `Hold still… ${n} of ${total}`;
      },
    });
    $('enrollDlg').close();
    renderFaces();
    state.lastSeen[saved] = Date.now();
    const text = `Nice to meet you, ${saved}. I'll recognise you from now on.`;
    setWelcome(`Welcome, ${saved}.`, 'known', true);
    addMessage('bot', text, { kind: 'face', label: 'Face recognition' });
    voice.speak(text);
  } catch (err) {
    prog.textContent = err.message;
    prog.classList.add('error');
  } finally {
    go.disabled = false;
  }
});

$('btnExport').addEventListener('click', () => {
  const blob = new Blob([face.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'saved-faces.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('fileImport').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    face.importJSON(await file.text());
    renderFaces();
    addMessage('system', 'Faces imported.');
  } catch (err) {
    addMessage('bot', err.message, { kind: 'error', label: 'Problem' });
  }
  e.target.value = '';
});

// ---------------------------------------------------------------- settings dialog
const form = $('settingsForm');

function fillVoices() {
  const sel = $('voiceSelect');
  const voices = voice.voices();
  const prefix = (form.elements.lang.value || settings.lang).split('-')[0];
  const sorted = [...voices].sort((a, b) =>
    (b.lang.startsWith(prefix) - a.lang.startsWith(prefix)) || a.name.localeCompare(b.name));
  sel.replaceChildren(new Option('Browser default', ''), ...sorted.map((v) => new Option(`${v.name} (${v.lang})`, v.name)));
  sel.value = settings.voice;
}
if (voice.canSpeak) speechSynthesis.addEventListener('voiceschanged', fillVoices);

function syncVisibility() {
  const provider = form.elements.provider.value;
  const link = form.elements.linkMode.value;
  form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== provider; });
  form.querySelectorAll('[data-hide]').forEach((el) => { el.hidden = el.dataset.hide === provider; });
  form.querySelectorAll('[data-link]').forEach((el) => { el.hidden = el.dataset.link !== link; });
  const topic = form.elements.topic.value.replace(/\/+$/, '');
  $('topicCmd').textContent = `${topic}/cmd`;
  $('topicStatus').textContent = `${topic}/status`;
}

function openSettings() {
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (el.type === 'checkbox') el.checked = Boolean(settings[el.name]);
    else el.value = settings[el.name];
  }
  fillVoices();
  syncVisibility();
  $('settingsDlg').showModal();
}

$('btnSettings').addEventListener('click', openSettings);
$('settingsCancel').addEventListener('click', () => $('settingsDlg').close());
form.addEventListener('input', syncVisibility);
form.elements.lang.addEventListener('change', fillVoices);

$('providerSelect').addEventListener('change', (e) => {
  const prev = settings.provider;
  const model = $('modelInput');
  if (!model.value || model.value === MODEL_DEFAULTS[prev] || Object.values(MODEL_DEFAULTS).includes(model.value)) {
    model.value = MODEL_DEFAULTS[e.target.value] || '';
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const next = { ...settings };
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (el.type === 'checkbox') next[el.name] = el.checked;
    else if (el.type === 'number' || el.type === 'range') next[el.name] = Number(el.value);
    else next[el.name] = el.value.trim();
  }
  if (!next.botName) next.botName = 'Nova';
  const linkChanged = ['linkMode', 'mqttUrl', 'topic', 'wsUrl'].some((k) => next[k] !== settings[k]);
  settings = next;
  saveSettings(settings);
  applySettings(linkChanged);
  $('settingsDlg').close();
  addMessage('system', 'Settings saved.');
});

function applySettings(reconnect) {
  $('botTitle').textContent = settings.botName;
  document.title = `${settings.botName} — robot voice console`;
  voice.setLang(settings.lang);
  voice.voiceName = settings.voice;
  voice.rate = Number(settings.rate) || 1;
  face.setThreshold(Number(settings.matchThreshold));
  if (reconnect) robot.configure(settings);
}

applySettings(false);
