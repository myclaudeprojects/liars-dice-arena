// Option previews are not procedural busts. A missing portrait is a letter
// in the creator, not a generated SVG.

const { previewSelections } = require("./creationSelections");

function previewSvg(group, id) {
  if (!previewSelections(group, id)) return null;
  return null;
}

function warmCreationPreviews() {
  return 0;
}

module.exports = {
  previewSvg,
  warmCreationPreviews,
};
