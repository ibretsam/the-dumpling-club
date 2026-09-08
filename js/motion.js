// Global motion preferences. main.js sets these; every animated module reads them.
export const motion = {
  reduced: false,   // true when the user prefers reduced motion (media query or toggle)
  steam: true,
  sauce: true,
  sound: false,
  timeScale: 1,
};

export function detectReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}
