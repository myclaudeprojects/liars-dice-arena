// Neon-competitive portrait provider.
//
// Live portraits are generated images. There is no procedural stand-in.
// OPENAI_API_KEY is required. When it is missing, createImage() throws and
// the arena keeps the letter fallback.

const MISSING_KEY_MESSAGE = "OPENAI_API_KEY is not set. Neon competitive portraits are not generated without it.";

function imageProviderConfigured(env = process.env) {
  return Boolean(env && String(env.OPENAI_API_KEY || "").trim());
}

function squareSize(width, height) {
  const w = Number(width) || 1024;
  const h = Number(height) || 1024;
  const side = Math.max(w, h);
  if (side >= 1024) return "1024x1024";
  if (side >= 512) return "512x512";
  return "256x256";
}

async function createImage({
  prompt,
  width = 1024,
  height = 1024,
  seed,
} = {}) {
  if (!imageProviderConfigured()) {
    const err = new Error(MISSING_KEY_MESSAGE);
    err.code = "pfp_provider_unconfigured";
    throw err;
  }
  const apiKey = String(process.env.OPENAI_API_KEY).trim();
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const body = {
    model,
    prompt: String(prompt || "").slice(0, 16000),
    size: squareSize(width, height),
    n: 1,
  };
  // dall-e returns a URL unless response_format is set. gpt-image-1 rejects that field.
  if (/^dall-e/i.test(model)) body.response_format = "b64_json";

  const response = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    const err = new Error(`Image provider ${response.status}: ${text}`);
    err.code = "pfp_provider_failed";
    throw err;
  }
  const json = await response.json();
  const row = json && Array.isArray(json.data) ? json.data[0] : null;
  let buffer = null;
  if (row && row.b64_json) buffer = Buffer.from(row.b64_json, "base64");
  else if (row && row.url) {
    const fetched = await fetch(row.url);
    if (!fetched.ok) {
      const err = new Error("Image provider returned a URL that could not be fetched.");
      err.code = "pfp_provider_failed";
      throw err;
    }
    buffer = Buffer.from(await fetched.arrayBuffer());
  }
  if (!buffer || buffer.length < 32) {
    const err = new Error("Image provider returned an empty portrait.");
    err.code = "pfp_provider_failed";
    throw err;
  }
  return {
    buffer,
    model: (json && json.model) || model,
    seed: seed || null,
  };
}

module.exports = {
  MISSING_KEY_MESSAGE,
  imageProviderConfigured,
  createImage,
};
