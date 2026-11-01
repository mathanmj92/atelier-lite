// Atelier has no Puter account or cloud, so the apps' wording is rewritten as it is
// served: "Save to Puter" becomes "Save to workspace", and so on.
//
// Only words in running text change. Names that merely contain "Puter" are file-format
// markers the apps write into their own documents (PuterExportMeta, /PuterOCR, rIdPuterScripts,
// insertImagePuter...) and must stay as they are, or saved files would stop round-tripping.
// The attribution lines (Puter Technologies Inc., Puter.js) are licence credits and stay too.

// Not part of a longer identifier or path: nothing name-like on either side.
const W = "(?<![A-Za-z0-9_/\\\\.\\-])Puter(?![A-Za-z0-9_]|\\.js|\\s+Technologies)";

const RULES = [
  // "your (own) Puter cloud / drive / files"
  [new RegExp(`\\b(Your|your|the|The)(\\s+own)?\\s+${W}\\s+(?:cloud|drive|files|storage)`, "g"), (m, a) => (a[0] === "Y" || a === "The" ? "Your workspace" : "your workspace")],
  [new RegExp(`(\\bown\\s+)${W}\\s+(?:cloud|drive|files|storage)`, "g"), "$1workspace"],
  [new RegExp(`${W}\\s+(?:cloud|drive|storage)`, "g"), "workspace"],
  // AI
  [new RegExp(`${W}(’s|'s)?\\s+AI(\\s+service)?`, "g"), "Atelier AI"],
  // "Powered by Puter", "Built with Puter"
  [new RegExp(`(Powered by|Propulsé par)\\s+${W}`, "g"), "$1 Atelier"],
  // places: save to / open from / in
  [new RegExp(`\\b(to|in|on|from|into)\\s+${W}`, "g"), "$1 the workspace"],
  // everything else is the product name
  [new RegExp(W, "g"), "Atelier"],
];

function rebrand(text) {
  if (!text.includes("Puter")) return text;
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

module.exports = { rebrand };
