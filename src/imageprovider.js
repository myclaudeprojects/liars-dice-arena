// imageprovider.js — Live portrait backend.
//
// Neon competitive images via OPENAI_API_KEY. No procedural SVG fallback.

const { createImage, imageProviderConfigured } = require("./branding/imageProvider");

class ImageProvider {
  async generate() {
    throw new Error("ImageProvider.generate() not implemented");
  }
}

class NeonImageProvider extends ImageProvider {
  constructor() {
    super();
    this.id = "neon-competitive";
  }

  async generate({ prompt, width = 1024, height = 1024, seed } = {}) {
    const image = await createImage({ prompt, width, height, seed });
    return {
      provider: this.id,
      mime: "image/webp",
      width: 1024,
      height: 1024,
      buffer: image.buffer,
      model: image.model,
      seed: image.seed || seed || null,
      prompt: prompt || "",
    };
  }
}

function createImageProvider() {
  return new NeonImageProvider();
}

module.exports = {
  ImageProvider,
  NeonImageProvider,
  createImageProvider,
  imageProviderConfigured,
};
