/* global document, window, fetch */
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

export const SVG = "http://www.w3.org/2000/svg";
export const WALK_MS = 9000;
export const CYCLE_MS = 12000;
export const WALK = WALK_MS / CYCLE_MS;
export const HOLD = 0.9;
export const GONE = 0.97;
export const POP_MS = 900;
export const MARKER_AT = [0.59, 0.99, 0.87];
export const STEP_AT = [[0, 0.42], [0.42, 0.78], [0.78, 1]];
export const LIT = 0.03;
export const IN_VIEW = "-12% 0px -12% 0px";
export const STEPS = 5;
export const FEATHER = 1.6;
export const TAIL = 0.5;
export const ZONE_MS = 3600;
export const PIN_MS = 2600;
export const LOOP_SPAN = 2.5;
export const LOOP_LAG = 0.8;
export const LIT_EARLY = 0.002;
export const REGIONS = [
  [[8, 0], [46, 0], [46, 22], [40, 34], [44, 45], [60, 39], [82, 32], [85, 34], [66, 54], [66, 58.5], [3, 58.5], [3, 45], [18, 45], [16, 24]],
  [[3, 54], [27, 54], [31, 48.5], [37, 53], [64, 52], [82.5, 33], [99, 55], [99, 60], [3, 60]],
  [[67, 70], [80, 64], [100, 64], [100, 86], [84, 88], [67, 88]],
  [[0, 72], [38, 71], [40, 72.5], [64, 86], [81, 86.5], [100, 84], [100, 100], [0, 100]],
];
export const SPRING = "cubic-bezier(0.2, 1.4, 0.4, 1)";
export const FOREVER = { duration: CYCLE_MS, iterations: Infinity };
export const FRAMES = 75;
export const PUSH = 0.12;
export const HOUSE = [0.7, 0.72];
export const MIDDLE = [0.5, 0.5];
export const RATE = 4;
export const SETTLE = 0.0005;
export const ARC = 0.04;
export const EMBER_R = 14;
export const TRAIL = 4;
export const HAZE = "222, 204, 178";
export const MARKS = { glide: 0.1, swap: 0.42, hazeIn: 0.3, hazeOut: 0.52, settle: 0.9, lift: 0.08, land: 0.94 };
export const CARDS = [[0.1, 0.38], [0.46, 0.74], [0.74, Infinity]];
export const RIDGE = [1920, 1072];
export const SIZES = { d: [1920, 1068], p: [604, 1072] };
export const EMBER_FROM = [0.73, 0.82];
export const EMBER_TO = { d: [0.36, 0.84], p: [0.3, 0.84] };

export const GROW = {
  keyframes: [{ opacity: 0, transform: "scale(0.86)" }, { opacity: 1, transform: "scale(1)" }],
  options: { duration: 1800, easing: HEAVY, fill: "backwards" },
};

export const between = (p, from, to, still) => {
  const t = clamp((p - from) / (to - from));
  return still ? Math.round(t) : t;
};

export function openingState(p) {
  const at = clamp(p) || 0;
  const { glide, swap, hazeIn, hazeOut, settle, lift, land } = MARKS;
  return {
    glide: between(at, 0, glide),
    zoom: 1 + PUSH * between(at, 0, swap),
    haze: Math.min(between(at, hazeIn, swap), 1 - between(at, swap, hazeOut)),
    frame: at < swap ? -1 : Math.round(between(at, swap, settle) * (FRAMES - 1)),
    card: CARDS.findIndex(([from, to]) => at >= from && at < to),
    travel: between(at, lift, land),
    glow: 0.6 + 0.4 * between(at, land, 1),
  };
}

export const damp = (current, target, dt) => current + (target - current) * (1 - Math.exp(-dt * RATE));

const within = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function cover([iw, ih], vw, vh, [fx, fy], zoom) {
  const s = Math.max(vw / iw, vh / ih);
  const [w, h] = [iw * s, ih * s];
  const hx = within(vw / 2 - fx * w, vw - w, 0) + fx * w;
  const hy = within(vh / 2 - fy * h, vh - h, 0) + fy * h;
  return [hx - fx * w * zoom, hy - fy * h * zoom, w * zoom, h * zoom];
}

export const point = ([x, y, w, h], [fx, fy]) => [x + fx * w, y + fy * h];

export const emberPoint = ([ax, ay], [bx, by], t, vh) => [ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(Math.PI * t) * ARC * vh];

export const frameSrc = (set, i) => `/landing/frames/synthetic-v2-${set}-${String(i).padStart(2, "0")}.webp`;

export const setFor = (vw, vh) => (vw < vh ? "p" : "d");

export function nearest(ready, i) {
  for (let k = i; k >= 0; k--) if (ready[k]) return k;
  return ready.findIndex((ok, k) => ok && k > i);
}

function glowAt(ctx, [x, y], r, alpha) {
  const a = alpha.toFixed(3);
  const fill = ctx.createRadialGradient(x, y, 0, x, y, r);
  fill.addColorStop(0, `rgba(255, 246, 220, ${a})`);
  fill.addColorStop(0.18, `rgba(255, 170, 60, ${a})`);
  fill.addColorStop(0.45, `rgba(232, 84, 18, ${a})`);
  fill.addColorStop(1, "rgba(200, 50, 10, 0)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawEmber(ctx, from, to, { travel, glow }, vh) {
  for (let k = TRAIL; k >= 1; k--) {
    const t = travel - k * 0.012;
    if (travel < 1 && t > 0) glowAt(ctx, emberPoint(from, to, t, vh), EMBER_R * 0.6, (1 - k / (TRAIL + 1)) * 0.5);
  }
  glowAt(ctx, emberPoint(from, to, travel, vh), EMBER_R * 2 * glow, 1);
}

export function scrub(win, read, paint) {
  let current = read();
  let target = current;
  let last = 0;
  let running = false;
  const step = (now) => {
    current = Math.abs(target - current) < SETTLE ? target : damp(current, target, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    paint(current);
    running = current !== target;
    if (running) win.requestAnimationFrame(step);
    else last = 0;
  };
  const wake = () => {
    target = read();
    if (running) return;
    running = true;
    win.requestAnimationFrame(step);
  };
  win.addEventListener("scroll", wake, { passive: true });
  win.addEventListener("resize", () => {
    paint(current);
    wake();
  });
  paint(current);
  return () => paint(current);
}

const isReady = (img) => img.complete && img.naturalWidth > 0;

export function paintOpening(win, opening) {
  const canvas = opening.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const ridge = opening.querySelector(".ridge");
  const cards = [...opening.querySelectorAll(".opening-cards .card")];
  const frames = [];
  let set = "";
  let repaint = () => {};
  const load = (want) => {
    set = want;
    frames.length = 0;
    for (let i = 0; i < FRAMES; i++) {
      const img = new win.Image();
      img.addEventListener("load", () => repaint());
      img.src = frameSrc(set, i);
      frames.push(img);
    }
  };
  const paint = (p) => {
    const s = openingState(p);
    const [vw, vh] = [win.innerWidth, win.innerHeight];
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const want = setFor(vw, vh);
    if (p > 0 && want !== set) load(want);
    if (canvas.width !== Math.round(vw * dpr)) canvas.width = Math.round(vw * dpr);
    if (canvas.height !== Math.round(vh * dpr)) canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const at = s.frame < 0 ? -1 : nearest(frames.map(isReady), s.frame);
    if (at >= 0) ctx.drawImage(frames[at], ...cover(SIZES[set], vw, vh, MIDDLE, 1));
    else if (isReady(ridge)) ctx.drawImage(ridge, ...cover(RIDGE, vw, vh, HOUSE, s.zoom));
    if (s.haze > 0) {
      ctx.fillStyle = `rgba(${HAZE}, ${s.haze.toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    const from = point(cover(RIDGE, vw, vh, HOUSE, s.zoom), EMBER_FROM);
    const to = point(cover(SIZES[want], vw, vh, MIDDLE, 1), EMBER_TO[want]);
    drawEmber(ctx, from, to, s, vh);
    opening.style.setProperty("--glide", s.glide.toFixed(3));
    mark(cards, s.card);
  };
  opening.classList.toggle("pinned", true);
  repaint = scrub(win, () => {
    const rect = opening.getBoundingClientRect();
    return clamp(-rect.top / (rect.height - win.innerHeight));
  }, paint);
  ridge.addEventListener("load", () => repaint());
}

export const fadeOut = (frame) => [
  { ...frame, opacity: 1, offset: HOLD },
  { ...frame, opacity: 0, offset: GONE },
  { ...frame, opacity: 0, offset: 1 },
];

export const traceFrames = (length) => [
  { strokeDashoffset: length, offset: 0 },
  { strokeDashoffset: 0, offset: WALK },
  { strokeDashoffset: 0, offset: 1 },
];

export const loopFrames = () => [{ opacity: 1, offset: 0 }, ...fadeOut({})];

export function walkFrames(pointAt, steps) {
  const frames = Array.from({ length: steps + 1 }, (_, i) => {
    const p = pointAt(i / steps);
    return { transform: `translate(${p.x}px, ${p.y}px)`, opacity: 1, offset: (i / steps) * WALK };
  });
  return [...frames, ...fadeOut({ transform: frames[steps].transform })];
}

export function pop(i) {
  const at = MARKER_AT[i] * WALK;
  const small = { transform: "translate(-50%, -50%) scale(0.2)" };
  const big = { transform: "translate(-50%, -50%) scale(1)" };
  return [
    { ...small, opacity: 0, offset: 0 },
    { ...small, opacity: 0, offset: at, easing: SPRING },
    { ...big, opacity: 1, offset: at + POP_MS / CYCLE_MS },
    ...fadeOut(big),
  ];
}

export function stepFrames([from, to]) {
  const idle = { backgroundColor: "#2b3a30", color: "#f7f3e6", transform: "scale(1)" };
  const lit = { backgroundColor: "#f5c24c", color: "#1a271e", transform: "scale(1.2)" };
  return [
    { ...idle, offset: 0 },
    { ...idle, offset: from },
    { ...lit, offset: Math.min(from + LIT, 1) },
    { ...lit, offset: Math.max(to - LIT, 0) },
    { ...idle, offset: to },
    { ...idle, offset: 1 },
  ];
}

const past = (v) => (v <= 0 ? -5 : v >= 100 ? 105 : v);

export function mask(points) {
  const at = points.map(([x, y]) => `${past(x)},${past(y)}`).join(" ");
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
    `<filter id='f' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='${FEATHER}'/></filter>` +
    `<polygon points='${at}' fill='white' filter='url(#f)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function centre(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export const lift = (t, still) => (still ? 0 : Math.min(between(t, 0, 0.3), 1 - between(t, 0.7, 1)));

export function apartState(p, still) {
  const s = (clamp(p) || 0) * STEPS + 0.5;
  const at = Math.min(Math.floor(s), STEPS);
  const t = s - at;
  const layers = REGIONS.map((_, i) => {
    if (i + 1 < at) return { shown: true, lift: 0, clear: 1 };
    if (i + 1 > at) return { shown: false, lift: 0, clear: 0 };
    return { shown: true, lift: lift(t, still), clear: t >= 0.5 ? 1 : 0 };
  });
  return { at, layers };
}

export const focus = (at) => (at >= 1 && at <= REGIONS.length ? centre(REGIONS[at - 1])[0] : 50);

export function pan(x, box, view) {
  return Math.min(Math.max(0, (view - box) / 2), Math.max(view - box, view / 2 - (x / 100) * box));
}

export function traceMask(doc, loop, length) {
  const mask = doc.createElementNS(SVG, "mask");
  mask.id = "drawn";
  const trace = doc.createElementNS(SVG, "path");
  const attrs = { d: loop.getAttribute("d"), fill: "none", stroke: "#fff", "stroke-width": "40", "stroke-dasharray": `${length} ${length}`, "stroke-dashoffset": `${length}` };
  for (const [key, value] of Object.entries(attrs)) trace.setAttribute(key, value);
  mask.append(trace);
  loop.ownerSVGElement.prepend(mask);
  loop.setAttribute("mask", "url(#drawn)");
  return trace;
}

export function whenShown(doc, run) {
  if (doc.visibilityState === "visible") return run();
  const wait = () => {
    if (doc.visibilityState !== "visible") return;
    doc.removeEventListener("visibilitychange", wait);
    run();
  };
  doc.addEventListener("visibilitychange", wait);
}

export function rise(el, shown, above) {
  el.classList.toggle("shown", shown);
  el.classList.toggle("above", !shown && above);
}

function placeWalker(plot) {
  const loop = plot.querySelector(".loop");
  const home = loop.getPointAtLength(0);
  const walker = plot.querySelector(".walker");
  walker.setAttribute("cx", home.x.toFixed(1));
  walker.setAttribute("cy", home.y.toFixed(1));
}

export function walk(doc, box) {
  const loop = box.querySelector(".loop");
  const walker = box.querySelector(".walker");
  const length = loop.getTotalLength();
  traceMask(doc, loop, length).animate(traceFrames(length), FOREVER);
  loop.animate(loopFrames(), FOREVER);
  walker.setAttribute("cx", "0");
  walker.setAttribute("cy", "0");
  walker.animate(walkFrames((t) => loop.getPointAtLength(length * t), 80), FOREVER);
  [...box.querySelectorAll(".marker")].forEach((marker, i) => marker.animate(pop(i), FOREVER));
  [...box.querySelectorAll(".dot")].forEach((dot, i) => dot.animate(stepFrames(STEP_AT[i]), FOREVER));
}

export function paintApart(win, apart, still) {
  const box = apart.querySelector(".apart-box");
  const pieces = [...apart.querySelectorAll(".piece")];
  const cards = [...apart.querySelectorAll(".apart-cards .card")];
  pieces.forEach((piece, i) => {
    const [x, y] = centre(REGIONS[i]);
    const cut = piece.querySelector(".cut");
    piece.style.setProperty("--ox", `${x}%`);
    piece.style.setProperty("--oy", `${y}%`);
    cut.style.setProperty("mask-image", mask(REGIONS[i]));
    cut.style.setProperty("-webkit-mask-image", mask(REGIONS[i]));
  });
  apart.classList.toggle("pinned", true);
  onScroll(win, () => {
    const rect = apart.getBoundingClientRect();
    const { at, layers } = apartState(-rect.top / (rect.height - (1 + TAIL) * win.innerHeight), still);
    layers.forEach((layer, i) => {
      pieces[i].classList.toggle("shown", layer.shown);
      pieces[i].classList.toggle("up", i + 1 === at);
      pieces[i].style.setProperty("--lift", layer.lift.toFixed(3));
      pieces[i].style.setProperty("--clear", layer.clear.toFixed(3));
    });
    cards.forEach((card, i) => card.classList.toggle("on", i === at));
    apart.classList.toggle("done", layers.every((layer) => layer.clear === 1));
    apart.style.setProperty("--dim", (layers[at - 1]?.lift ?? 0).toFixed(3));
    box.style.setProperty("--pan", `${pan(focus(at), box.offsetWidth, win.innerWidth).toFixed(1)}px`);
  });
}

export function zones(win, map) {
  const bands = [...map.querySelectorAll(".band")].reverse();
  const cards = [...map.querySelectorAll(".zone")];
  bands.forEach((band, i) => band.animate(GROW.keyframes, { ...GROW.options, delay: i * 700 }));
  cycle(win, cards.length, ZONE_MS, (at) => {
    mark(bands, at);
    mark(cards, at);
  });
}

export function pins(win, figure) {
  const all = [...figure.querySelectorAll(".pin")];
  cycle(win, all.length, PIN_MS, (at) => mark(all, at));
}

export function loopState(p, count) {
  const drawn = clamp(p) || 0;
  return { drawn, lit: Array.from({ length: count }, (_, i) => drawn + LIT_EARLY >= i / count) };
}

export function paintLoop(ring, steps, p) {
  const { drawn, lit } = loopState(p, steps.length);
  ring.style.setProperty("--p", drawn.toFixed(3));
  steps.forEach((step, i) => step.classList.toggle("lit", lit[i]));
}

export function loop(card, gsap, trigger) {
  const ring = card.querySelector(".ring");
  const steps = [...ring.querySelectorAll(".ring-step")];
  const stage = card.parentElement;
  ring.classList.toggle("live", true);
  gsap.registerPlugin(trigger);
  trigger.create({
    trigger: stage,
    start: "center center",
    end: `+=${LOOP_SPAN * 100}%`,
    pin: stage,
    anticipatePin: 1,
    scrub: LOOP_LAG,
    onUpdate: (self) => paintLoop(ring, steps, self.progress),
  });
  paintLoop(ring, steps, 0);
}

export const LIVE = {
  walk: (doc, win, el) => whenShown(doc, () => walk(doc, el)),
  zones: (doc, win, el) => zones(win, el),
  pins: (doc, win, el) => pins(win, el),
};

export const MESSAGES = {
  success: "You're on the list. We'll email you when EmberWalk launches.",
  invalid_email: "That email address doesn't look right. Please check it and try again.",
  invalid_role: "Please choose the one that describes you best.",
  no_token: "Please wait a moment for the check to finish, then try again.",
  turnstile_failed: "We couldn't confirm you're a person. Please try again.",
  server: "Something went wrong on our end. Please try again, or write to hello@emberwalk.app.",
  network: "We couldn't reach the server. Please check your connection and try again.",
};

export function startTurnstile(doc, win, fetchImpl, box, onToken) {
  const widget = { id: null };
  const render = () => {
    widget.id = win.turnstile.render(box, {
      sitekey: widget.siteKey,
      appearance: "interaction-only",
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  };
  fetchImpl("/api/config")
    .then((response) => response.json())
    .then((config) => {
      widget.siteKey = config.turnstileSiteKey;
      const script = doc.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      doc.head.append(script);
    })
    .catch(() => onToken(""));
  return () => {
    if (widget.id !== null && win.turnstile) win.turnstile.reset(widget.id);
    onToken("");
  };
}

export function setupSignup(doc, win, fetchImpl) {
  const form = doc.getElementById("signup");
  if (!form) return;
  const status = doc.getElementById("signup-status");
  const button = form.querySelector("button");
  let token = "";
  const resetTurnstile = startTurnstile(doc, win, fetchImpl, doc.getElementById("turnstile-box"), (value) => {
    token = value;
  });

  const show = (key, kind) => {
    status.textContent = MESSAGES[key];
    status.dataset.kind = kind;
    status.hidden = false;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.elements.email;
    const role = form.elements.role;
    if (!email.validity.valid || email.value.trim() === "") return show("invalid_email", "error");
    if (role.value === "") return show("invalid_role", "error");
    if (token === "") return show("no_token", "error");

    button.disabled = true;
    try {
      const response = await fetchImpl("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.value, role: role.value, turnstileToken: token }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        for (const field of form.querySelectorAll(".field, .button, .turnstile-box")) field.hidden = true;
        return show("success", "ok");
      }
      resetTurnstile();
      show(MESSAGES[result.error] ? result.error : "server", "error");
    } catch {
      resetTurnstile();
      show("network", "error");
    } finally {
      button.disabled = false;
    }
  });
}

export function start(doc, win, fetchImpl) {
  const still = reduced(win);
  const [opening, apart, plot, after] = ["opening", "apart", "plot", "after"].map((id) => doc.getElementById(id));
  setupSignup(doc, win, fetchImpl);
  if (apart) paintApart(win, apart, still);
  if (plot) placeWalker(plot);
  if (still) return;
  if (opening) paintOpening(win, opening);
  if (after && win.gsap && win.ScrollTrigger) loop(after, win.gsap, win.ScrollTrigger);
  doc.documentElement.classList.add("js");
  watch(doc, win, ".rise", IN_VIEW, rise);
  const begun = new Set();
  watch(doc, win, "[data-live]", "0px", (el, shown) => {
    if (!shown || begun.has(el)) return;
    begun.add(el);
    LIVE[el.getAttribute("data-live")](doc, win, el);
  });
}

if (typeof document !== "undefined") start(document, window, (...args) => fetch(...args));
