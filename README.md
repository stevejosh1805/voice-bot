# Nova — voice and face console for an autonomous robot

A static web page (no server needed) that:

- recognises faces from the laptop webcam and greets people by name
- listens through the laptop mic and answers greetings, time, date and weather
- holds a general conversation through an AI API of your choice
- turns spoken movement commands ("move forward 3 steps", "rotate 180") into JSON commands
- shows those commands on a live top-down robot simulator
- can forward the same commands to a Raspberry Pi or ESP32 over MQTT or WebSocket

Everything runs in the browser, so it hosts for free on GitHub Pages.

## Project layout

```
index.html            page structure
css/style.css         styling
js/app.js             wires everything together
js/intents.js         rule-based command parser (pure JS, unit tested)
js/speech.js          speech recognition + text-to-speech (Web Speech API)
js/face.js            face detection/recognition (@vladmandic/face-api, TensorFlow.js)
js/weather.js         weather via Open-Meteo (free, no key)
js/chat.js            general conversation (Gemini / OpenAI-compatible / Claude)
js/robot.js           robot link: simulator, MQTT or WebSocket
js/sim.js             canvas simulator
js/settings.js        settings stored in the browser
tools/robot_listener.py   fake robot for testing the MQTT link
tests/intents.test.mjs    parser tests
```

## Run it on your laptop

Camera and mic only work on `https://` or `localhost`, so don't double-click `index.html`. Serve it:

```bash
cd voice-bot
python -m http.server 8000
```

Open http://localhost:8000 in **Chrome or Edge**. Firefox and Brave don't support speech recognition; you can still type.

## Put it on GitHub Pages

1. Create a new repository on GitHub, e.g. `voice-bot`.
2. Upload the contents of this folder (drag and drop in the browser works) or push with git:
   ```bash
   git init
   git add .
   git commit -m "Voice console first version"
   git branch -M main
   git remote add origin https://github.com/<your-username>/voice-bot.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main, folder: / (root) → Save**.
4. After a minute the site is live at `https://<your-username>.github.io/voice-bot/`.

## First use

1. Click **Start camera** and allow access. The face models (about 7 MB) download once.
2. Click **Add a face**, type your name and hold still for five samples.
3. Walk out of frame for a minute and come back: it greets you by name.
4. Tap the mic (or press Space) and try the commands below.

Faces and settings are saved in that browser's localStorage. Use **Export faces** to move them to another device.

## Voice commands

| Say | What happens |
| --- | --- |
| "hello", "hi Nova", "how are you" | Greeting, using your name if the camera recognises you |
| "what time is it", "what's the date", "time and date" | Time and/or date |
| "what's the weather", "weather in Chennai", "will it rain tomorrow" | Weather from Open-Meteo |
| "move forward 3 steps", "go back two steps", "move 50 cm" | Move command |
| "rotate 180", "turn left", "turn right 45 degrees", "turn around" | Rotate command |
| "stop" | Stops immediately and clears queued moves |
| "move forward 2 steps and then turn left" | Runs both, in order |
| "who am I", "what can you do", "tell me a joke" | Built-in replies |
| anything else | General conversation (needs an AI key) |

Defaults: "turn left/right" is 90°, "rotate 180" with no direction turns right, "a few steps" is 3, one command is capped at 20 steps.

## General conversation (AI key)

Open **Settings → General conversation**, pick a service and paste a key:

- **Google Gemini** has a free tier. Get a key at aistudio.google.com.
- **OpenAI-compatible** works with Groq, OpenAI or OpenRouter (change the base URL).
- **Anthropic Claude** works with a key from console.anthropic.com.

Model names change often. If you get a "model not found" error, copy a current model name from the provider's model list into the Model box.

The key stays in your browser. **Never put it in the code**: a public repo is readable by everyone and keys get scraped within minutes. For a public demo, move the AI call behind a small server (e.g. a Cloudflare Worker) later.

## Robot link

Every command is one JSON message:

```json
{"id": 7, "action": "move",   "dir": "forward", "steps": 3, "cm": 30, "ts": 1757570000000}
{"id": 8, "action": "rotate", "dir": "right",   "deg": 180,           "ts": 1757570001000}
{"id": 9, "action": "stop",                                           "ts": 1757570002000}
```

`dir` is `forward`/`backward` for moves and `left`/`right` for rotation. `cm` uses the step length from Settings.

### Option A: MQTT (recommended, works from GitHub Pages)

The page publishes to `<topic>/cmd` and listens on `<topic>/status`. Your topic is shown in Settings; it has a random suffix so strangers on the public broker don't drive your robot.

Test it before any hardware exists:

```bash
pip install paho-mqtt
python tools/robot_listener.py --topic voicebot/<your-suffix>
```

Switch Settings → Robot link to **MQTT broker**, say "move forward 2 steps", and the terminal prints the command while the page shows the reply.

Important: a page served over `https://` (GitHub Pages) can only open **`wss://`** connections. The default public broker `wss://broker.hivemq.com:8884/mqtt` works. A Mosquitto broker on the Pi needs a WebSocket listener *with TLS* to be reachable from GitHub Pages; without TLS, open the page from `http://localhost` instead.

### Option B: WebSocket straight to an ESP32

Run a WebSocket server on the ESP32 (e.g. the `WebSockets` library on port 81) and set the address to `ws://<esp32-ip>:81`. Because it's plain `ws://`, this only works when the page is opened from `http://localhost:8000` on a laptop on the same Wi-Fi, not from GitHub Pages.

## Tests

```bash
node tests/intents.test.mjs
```

## Roadmap

- Raspberry Pi bridge: replace the TODOs in `tools/robot_listener.py` with motor control
- ESP32 firmware that subscribes to the same MQTT topic
- Wake word ("hey Nova") for hands-free use
- Obstacle and status feedback from the robot shown in the simulator
- Move the AI key behind a serverless proxy for public demos
