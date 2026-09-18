// llm.js — Tiny provider adapters exposing one shape:
//   complete({ system, user, model, timeoutMs }) => Promise<string>
// Zero SDK deps: plain fetch (Node 22 has fetch built in).
// Add any OpenAI-compatible endpoint (Ollama, Groq, Together, xAI...) via `openaiCompatible`.

async function fetchWithTimeout(url, opts, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally { clearTimeout(t); }
}

function anthropic({ apiKey = process.env.ANTHROPIC_API_KEY, defaultModel = "claude-sonnet-4-6", timeoutMs = 6000 } = {}) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  return async ({ system, user, model, timeoutMs: ms }) => {
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || defaultModel,
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: user }],
      }),
    }, ms ?? timeoutMs);
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return (j.content || []).map((c) => c.text || "").join("");
  };
}

// Works for OpenAI, Groq, Together, xAI, Ollama (baseUrl http://localhost:11434/v1), etc.
function openaiCompatible({ apiKey = process.env.OPENAI_API_KEY, baseUrl = "https://api.openai.com/v1", defaultModel = "gpt-4o-mini", timeoutMs = 6000 } = {}) {
  return async ({ system, user, model, timeoutMs: ms }) => {
    const r = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model || defaultModel,
        max_tokens: 200,
        temperature: 0.9,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    }, ms ?? timeoutMs);
    if (!r.ok) throw new Error(`openai-compat ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content ?? "";
  };
}

// ---- Personas: what makes seats play differently --------------------------
const PERSONAS = {
  shark: `You are "The Shark" — cold, mathematical, patient. You never bluff early; you let others overextend and punish them with precise challenges. Your table talk is short and dry.`,
  degen: `You are "Degen" — hyper-aggressive, loves big bids, bluffs constantly, talks trash in crypto slang (gm, ngmi, wagmi, rekt). You'd rather go out swinging than fold.`,
  oracle: `You are "The Oracle" — you speak cryptically and act like you already know the outcome. Balanced play, unnerving confidence. Occasional sharp reads.`,
  grinder: `You are "Grinder" — cautious, honest bids only based on what you hold, challenges only when the math is clearly on your side. Humble, friendly table talk.`,
};

const PERSONA_TAGS = {
  shark: "Patient caller",
  degen: "Bluffs for fun",
  oracle: "Cryptic reads",
  grinder: "Honest math",
};

function personaTag(rec) {
  if (!rec) return null;
  if (rec.persona && PERSONA_TAGS[rec.persona]) return PERSONA_TAGS[rec.persona];
  if (rec.type === "prompt" && rec.persona) return String(rec.persona).replace(/\s+/g, " ").trim().slice(0, 48);
  const ag = Number(rec.aggression);
  if (Number.isFinite(ag)) {
    if (ag <= 0.3) return "Tight caller";
    if (ag >= 0.7) return "Aggressive bluffer";
    return "Balanced";
  }
  return rec.house ? "House seat" : null;
}

module.exports = { anthropic, openaiCompatible, PERSONAS, PERSONA_TAGS, personaTag, fetchWithTimeout };
