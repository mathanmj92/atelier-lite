// One theme for the whole window. "Light / dark / system" is the mode (nativeTheme); the colour
// theme (Indigo, Ocean, ...) tints it. From the two this builds a palette that the sidebar, Home,
// the assistant, the title bar and every app are painted with, so one click changes all of them.
const THEMES = [
  { id: "indigo", name: "Indigo", accent: "#5b6cff", side: "#14161c", hover: "#20242d", on: "#2a2f3b" },
  { id: "ocean", name: "Ocean", accent: "#0ea5b7", side: "#0e1c22", hover: "#162a32", on: "#1d3640" },
  { id: "forest", name: "Forest", accent: "#2f9e62", side: "#101c15", hover: "#18291f", on: "#203629" },
  { id: "amber", name: "Amber", accent: "#d98a0b", side: "#201a0e", hover: "#2d2415", on: "#3a2f1b" },
  { id: "rose", name: "Rose", accent: "#e0457b", side: "#21111a", hover: "#2d1822", on: "#3b2030" },
  { id: "violet", name: "Violet", accent: "#8b5cf6", side: "#181326", hover: "#221b35", on: "#2d2445" },
  { id: "graphite", name: "Graphite", accent: "#6b7280", side: "#17181b", hover: "#222428", on: "#2d2f35" },
  { id: "paper", name: "Paper", accent: "#4a5568", side: "#1b1d21", hover: "#26292e", on: "#30343a" },
];

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (v) => "#" + v.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
// t = 0 gives a, t = 1 gives b.
const mix = (a, b, t) => {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * t));
};

function palette(themeId, dark) {
  const a = THEMES.find((t) => t.id === themeId) || THEMES[0];
  if (dark) {
    return {
      id: a.id,
      dark: true,
      accent: mix(a.accent, "#ffffff", 0.28),
      accentStrong: mix(a.accent, "#ffffff", 0.5),
      accentInk: "#101218",
      accentWash: mix(a.side, a.accent, 0.24),
      page: mix(a.side, "#000000", 0.3),
      surface: a.side,
      surface2: a.hover,
      surface3: a.on,
      canvas: mix(a.side, "#000000", 0.42),
      frame: a.side,
      card: a.hover,
      workspace: mix(a.side, "#000000", 0.38),
      hover: a.on,
      press: mix(a.on, "#ffffff", 0.08),
      line: mix(a.on, "#ffffff", 0.1),
      ink: "#f1f2f4",
      ink2: "#c9cdd6",
      ink3: "#98a0ae",
      muted: "#8b95a8",
      side: a.side,
      sideHover: a.hover,
      sideOn: a.on,
      sideText: "#c4cad6",
      sideStrong: "#ffffff",
      sideLine: mix(a.on, "#ffffff", 0.08),
      titleBar: mix(a.side, "#000000", 0.12),
      titleSymbol: "#c9cdd6",
    };
  }
  const t = a.accent;
  return {
    id: a.id,
    dark: false,
    accent: mix(t, "#000000", 0.1),
    accentStrong: mix(t, "#000000", 0.28),
    accentInk: "#ffffff",
    accentWash: mix(t, "#ffffff", 0.88),
    page: mix(t, "#ffffff", 0.965),
    surface: "#ffffff",
    surface2: mix(t, "#ffffff", 0.93),
    surface3: mix(t, "#ffffff", 0.87),
    canvas: mix(t, "#ffffff", 0.91),
    frame: mix(t, "#ffffff", 0.94),
    card: "#ffffff",
    workspace: mix(t, "#ffffff", 0.92),
    hover: mix(t, "#ffffff", 0.9),
    press: mix(t, "#ffffff", 0.83),
    line: mix(t, "#ffffff", 0.83),
    ink: "#1b1f2a",
    ink2: "#41485a",
    ink3: "#6b7587",
    muted: "#6b7587",
    side: mix(t, "#ffffff", 0.9),
    sideHover: mix(t, "#ffffff", 0.84),
    sideOn: mix(t, "#ffffff", 0.75),
    sideText: "#2a3140",
    sideStrong: "#10151f",
    sideLine: mix(t, "#ffffff", 0.7),
    titleBar: mix(t, "#ffffff", 0.95),
    titleSymbol: "#41485a",
  };
}

module.exports = { THEMES, palette };
