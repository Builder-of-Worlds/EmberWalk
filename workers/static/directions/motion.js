export const HEAVY = "cubic-bezier(0.3, 0, 0.1, 1)";

export const reduced = (win) => win.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const clamp = (v) => Math.min(1, Math.max(0, v));

export function onScroll(win, paint) {
  let queued = false;
  win.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  }, { passive: true });
  win.addEventListener("resize", paint);
  paint();
}

export function holdForms(doc) {
  for (const form of doc.querySelectorAll("form")) form.addEventListener("submit", (event) => event.preventDefault());
}

export function watch(doc, win, selector, margin, onChange) {
  const seen = new win.IntersectionObserver((entries) => {
    for (const entry of entries) onChange(entry.target, entry.isIntersecting, entry.boundingClientRect.top < 0);
  }, { rootMargin: margin });
  for (const el of doc.querySelectorAll(selector)) seen.observe(el);
}

export const mark = (items, at) => items.forEach((el, i) => el.classList.toggle("on", i === at));

export function cycle(win, count, ms, show) {
  let at = 0;
  show(at);
  win.setInterval(() => {
    at = (at + 1) % count;
    show(at);
  }, ms);
}
