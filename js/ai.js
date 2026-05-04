// Claude-Haiku-Integration für AI-gestütztes Re-Ranking der Empfehlungen.
//
// Strategie: Hybrid. Der lokale Camelot-Algorithmus liefert Top-30-Kandidaten,
// Haiku rankt sie unter Berücksichtigung von Genre, Ära, Energie und
// Crowd-Appeal neu. Das verhindert Halluzinationen — Claude wählt nur aus
// echten Library-Einträgen.

import { camelotString, classicalString } from './camelot.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Rankt eine Liste von Vorschlägen mit Claude neu.
 * @param {Recommendation[]} candidates — vom lokalen Algorithmus gelieferte Top-N
 * @param {Track} current — aktuell laufender Track
 * @param {object} ctx — { weddingMode: boolean, maxResults: number }
 * @returns {Promise<Recommendation[]>} verfeinerte Liste mit aiReason-Feld
 */
export async function rerank(candidates, current, ctx = {}) {
  const apiKey = localStorage.getItem('anthropic_api_key');
  if (!apiKey) throw new Error('Kein Anthropic-API-Key in den Einstellungen.');
  if (!candidates || candidates.length === 0) return [];

  const maxResults = Math.min(ctx.maxResults ?? 10, candidates.length);

  const prompt = buildPrompt(candidates, current, { ...ctx, maxResults });
  const response = await callClaude(apiKey, prompt);
  const parsed = parseResponse(response);

  // Map IDs zurück auf die ursprünglichen Recommendation-Objekte und
  // hänge die Begründungen dran.
  const byId = new Map(candidates.map(c => [c.track.id, c]));
  const result = [];
  for (const item of parsed) {
    const orig = byId.get(item.id);
    if (orig) {
      result.push({ ...orig, aiReason: item.reason ?? null });
    }
  }
  // Falls Claude weniger zurückgibt als gewünscht, mit Original-Reihenfolge auffüllen.
  if (result.length < maxResults) {
    for (const c of candidates) {
      if (result.find(r => r.track.id === c.track.id)) continue;
      result.push(c);
      if (result.length >= maxResults) break;
    }
  }
  return result.slice(0, maxResults);
}

function buildPrompt(candidates, current, ctx) {
  const cur = trackLine(current, true);
  const list = candidates.map((c, i) => {
    const t = c.track;
    const tags = [];
    if (t.bpm != null) tags.push(`${Math.round(t.bpm)} BPM`);
    if (t.key) tags.push(`Key ${camelotString(t.key)} (${classicalString(t.key)})`);
    if (t.genre) tags.push(t.genre);
    if (c.bpmDeltaPercent != null) tags.push(`${c.bpmDeltaPercent >= 0 ? '+' : ''}${c.bpmDeltaPercent.toFixed(1)}%`);
    return `${i + 1}. id: ${t.id} | "${t.title}" — ${t.artist} | ${tags.join(', ')}`;
  }).join('\n');

  const mode = ctx.weddingMode
    ? 'Wedding/Pop/Charts-Set: Crowd ist gemischt, Stimmungswechsel sind ok, aber kein totales Genre-Whiplash.'
    : 'Club-Set: harte BPM- und Key-Disziplin, energetischer Aufbau bevorzugt.';

  return `Du bist ein erfahrener DJ-Assistant. ${mode}

AKTUELL LÄUFT:
${cur}

KANDIDATEN (vom Algorithmus nach BPM- und Tonart-Nähe vorausgewählt):
${list}

AUFGABE: Wähle die ${ctx.maxResults} besten nächsten Songs für einen sauberen, energetisch passenden Übergang. Berücksichtige:
- Genre-/Ära-Stimmigkeit (90er auf 90er, oder bewusster Bruch wenn passend)
- Tanzbarkeit und Crowd-Appeal
- Energetischer Bogen (aufbauen, halten, oder Cool-Down je nach Kontext)
- Harmonisches Matching (gleiche/relative Tonart bevorzugt)

ANTWORTE NUR mit einem JSON-Array, keine andere Ausgabe. Format:
[
  { "id": "<track-id aus der Liste>", "reason": "<knapper Grund max 10 Wörter>" }
]
Sortiere nach Eignung, bester Track zuerst. Genau ${ctx.maxResults} Einträge.`;
}

function trackLine(t, includeQuotes = false) {
  const tags = [];
  if (t.bpm != null) tags.push(`${Math.round(t.bpm)} BPM`);
  if (t.key) tags.push(`Key ${camelotString(t.key)} (${classicalString(t.key)})`);
  if (t.genre) tags.push(t.genre);
  const q = includeQuotes ? '"' : '';
  return `${q}${t.title}${q} — ${t.artist} | ${tags.join(', ')}`;
}

async function callClaude(apiKey, userPrompt) {
  const body = {
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: userPrompt }]
  };
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Leere Claude-Antwort.');
  return text;
}

function parseResponse(text) {
  // Manchmal kommen JSON-Blöcke in Markdown-Fences zurück — robust extrahieren.
  let s = text.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1].trim();

  // Falls Claude trotzdem mehr als nur das Array zurückgibt: erste eckige Klammer suchen.
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => x && typeof x.id === 'string');
  } catch (e) {
    console.warn('Claude-JSON-Parse fehlgeschlagen:', e, text);
    return [];
  }
}
