// imageprovider.js — Portrait backends.
//
// The live backend is procedural SVG. There is no diffusion vendor in this
// process. A future provider can implement generate() without changing the
// brand flow, as long as it returns a square image payload.

const { renderPfp, MASTER_SIZE } = require("./pfp");

class ImageProvider {
  async generate() {
    throw new Error("ImageProvider.generate() not implemented");
  }
}

class ProceduralSvgProvider extends ImageProvider {
  constructor(render = renderPfp) {
    super();
    this.render = render;
    this.id = "procedural-svg";
  }

  renderSync({ recipe, size = MASTER_SIZE, nonce = "pfp" } = {}) {
    const px = size === "1024x1024" ? MASTER_SIZE : size;
    return this.render(recipe, { size: px, nonce });
  }

  async generate({ prompt, recipe, size = "1024x1024", nonce = "pfp" } = {}) {
    const svg = this.renderSync({ recipe, size: MASTER_SIZE, nonce });
    return {
      provider: this.id,
      mime: "image/svg+xml",
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      svg,
      prompt: prompt || "",
      requestedSize: size,
    };
  }
}

function createImageProvider() {
  return new ProceduralSvgProvider();
}

module.exports = {
  ImageProvider,
  ProceduralSvgProvider,
  createImageProvider,
};
