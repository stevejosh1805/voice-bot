// General conversation through an LLM API, called straight from the browser.
// The key is typed into Settings and kept in this browser's localStorage only.
// Never put a key in the code you push to GitHub: anyone can read a public repo.

function systemPrompt(ctx) {
  return [
    `You are ${ctx.botName}, the voice assistant of a small wheeled robot built by an engineering student.`,
    'Your replies are read aloud, so keep them to one to three short sentences.',
    'No markdown, lists, emoji or code blocks.',
    ctx.userName ? `The person talking to you is ${ctx.userName}, recognised by the camera.` : 'You do not know who is talking.',
    `Local time is ${ctx.now}.`,
    'Movement is handled separately by exact commands. If someone asks you to move and you are seeing it here,',
    'tell them to phrase it like "move forward 3 steps", "rotate 90 degrees left" or "stop".',
  ].join(' ');
}

/** Merge consecutive same-role turns and make sure the list starts with the user. */
function tidyHistory(history) {
  const out = [];
  for (const m of history) {
    if (!out.length && m.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += `\n${m.text}`;
    else out.push({ role: m.role, text: m.text });
  }
  return out;
}

async function readError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j.error?.message || j.message || JSON.stringify(j).slice(0, 200);
  } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) return `The API key was rejected. Check it in Settings. ${detail}`;
  if (res.status === 404) return `The model name was not found. Check the model in Settings. ${detail}`;
  if (res.status === 429) return 'The AI service says too many requests. Wait a minute and try again.';
  return `The AI service returned an error (${res.status}). ${detail}`;
}

export async function chatReply({ settings, history, ctx }) {
  const { provider, apiKey, model } = settings;
  const sys = systemPrompt(ctx);
  const turns = tidyHistory(history);

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  }

  if (provider === 'openai') {
    const base = settings.baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: sys }, ...turns.map((m) => ({ role: m.role, content: m.text }))],
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: sys,
        messages: turns.map((m) => ({ role: m.role, content: m.text })),
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  throw new Error('No AI provider is set up.');
}
