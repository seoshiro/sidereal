export const PALETTE = {
  background: "#0C0D12",
  surface: "#171921",
  raised: "#202330",
  text: "#F2F3F7",
  secondary: "#A7ADBD",
  accent: "#B9C9FF",
  line: "#353B4B",
  orbit: "#41485B",
  danger: "#FFB6BD",
  layers: ["#B9C9FF", "#F0AFD0", "#9EDCD3"],
} as const;
export function applyPalette() {
  for (const [key, value] of Object.entries(PALETTE))
    if (typeof value === "string")
      document.documentElement.style.setProperty(`--${key}`, value);
}
