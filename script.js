/* MAHMOUD RABIE - portfolio
   Vanilla JS. Observers, a ticker toggle, filters, and one canvas
   prism with real Snell-law refraction and dispersion. */

(() => {
  "use strict";

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* --- Sticky masthead state via sentinel --- */
  const masthead = document.querySelector(".masthead");
  const sentinel = document.getElementById("masthead-sentinel");
  if (masthead && sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      masthead.classList.toggle("is-stuck", !e.isIntersecting);
    }).observe(sentinel);
  }

  /* --- Scroll reveal (one shared observer) --- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  revealEls.forEach((el, i) => el.style.setProperty("--i", String(i % 3)));
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach((el) => io.observe(el));
  }

  /* --- Ticker pause/play (WCAG 2.2.2) --- */
  const ticker = document.querySelector(".ticker");
  const tickerToggle = document.getElementById("ticker-toggle");
  if (ticker && tickerToggle) {
    tickerToggle.addEventListener("click", () => {
      const paused = ticker.classList.toggle("is-paused");
      tickerToggle.textContent = paused ? "PLAY" : "PAUSE";
      tickerToggle.setAttribute("aria-label",
        paused ? "Play the skills ticker" : "Pause the skills ticker");
    });
  }

  /* --- Domain filters --- */
  const filterButtons = document.querySelectorAll(".filter");
  const filterables = document.querySelectorAll(".records > li, .archive__row");
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      const want = btn.dataset.filter;
      filterables.forEach((item) => {
        const domains = (item.dataset.domains ||
          item.querySelector("[data-domains]")?.dataset.domains || "").split(" ");
        item.classList.toggle("is-hidden", want !== "all" && !domains.includes(want));
      });
    });
  });

  /* --- The prism ------------------------------------------------
     Cursor = light source. The beam refracts at each glass face by
     Snell's law; each spectral band gets its own refractive index,
     so the dispersion fan is the physics, not an effect. Static
     frame under prefers-reduced-motion; loop pauses offscreen.   */
  const canvas = document.getElementById("beam");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero) return;
  const ctx = canvas.getContext("2d");
  const innerEl = hero.querySelector(".hero__inner");

  // magenta -> violet, with increasing refractive index.
  // Low-index "glass": at n~1.5 a 60-degree prism sits at the critical
  // angle for centroid-aimed rays (everything internally reflects), and
  // above n~1.12 some bands bounce while others exit, fracturing the
  // fan. n 1.05-1.12 keeps all six bands on the direct path from every
  // source position, so the fan stays whole and moves continuously.
  const SPECTRUM = [
    { c: "#FF3D9A", n: 1.050 },
    { c: "#F4509F", n: 1.064 },
    { c: "#D957C9", n: 1.078 },
    { c: "#BC60E3", n: 1.092 },
    { c: "#A467F2", n: 1.106 },
    { c: "#8B6CFF", n: 1.120 },
  ];

  /* vector helpers */
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (v, s) => ({ x: v.x * s, y: v.y * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const norm = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

  let w = 0, h = 0, dpr = 1;
  let prism = null;          // { verts, edges, normals, infl, cx, cy }
  let textBox = null;        // keep-out rect around the hero copy
  let idle = { x: 0, y: 0 }; // resting anchor for ambient drift
  let sx = 0, sy = 0, tx = 0, ty = 0;
  let lastPointer = 0, rafId = 0, heroVisible = true, tPrev = 0;

  function buildVerts(cx, cy, r) {
    const C = { x: cx, y: cy };
    const verts = [
      { x: cx, y: cy - r },                    // apex
      { x: cx - r * 0.92, y: cy + r * 0.72 },  // bottom-left
      { x: cx + r * 0.92, y: cy + r * 0.72 },  // bottom-right
    ];
    const edges = verts.map((p, i) => ({ p, q: verts[(i + 1) % 3] }));
    const normals = edges.map(({ p, q }) => {
      let n = norm({ x: q.y - p.y, y: -(q.x - p.x) });
      if (dot(n, sub(C, p)) > 0) n = mul(n, -1); // outward
      return n;
    });
    // inflated copy keeps the light source from entering the glass
    const infl = verts.map((v) => add(C, mul(sub(v, C), 1.28)));
    prism = { verts, edges, normals, infl, cx, cy, r };
  }

  // Tight bounds of the actual hero copy. Block elements report
  // full-width boxes, so measure the real glyph runs via a Range.
  function measureText() {
    textBox = null;
    if (!innerEl) return;
    const range = document.createRange();
    range.selectNodeContents(innerEl);
    const rects = range.getClientRects();
    if (!rects.length) return;
    const hr = hero.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.left - hr.left); y0 = Math.min(y0, r.top - hr.top);
      x1 = Math.max(x1, r.right - hr.left); y1 = Math.max(y1, r.bottom - hr.top);
    }
    textBox = { x0: x0 - 26, y0: y0 - 22, x1: x1 + 26, y1: y1 + 22 };
  }

  // Put the prism in space clear of the copy: in the gap to the right
  // when the layout is wide, otherwise in the taller free band above
  // or below the (near full-width) copy on narrow screens. The prism
  // centroid must end up outside textBox so the source constraint can
  // keep every beam off the copy.
  function placePrism() {
    if (!textBox) { buildVerts(w * 0.74, h * 0.46, Math.min(w, h) * 0.16); return; }
    const rightGap = w - textBox.x1;
    if (rightGap >= w * 0.30) {
      const r = Math.min(w, h) * 0.16;
      const cx = textBox.x1 + rightGap * 0.52;
      const cy = Math.max(r + 14, Math.min(h - r * 0.72 - 14, h * 0.44));
      buildVerts(cx, cy, r);
    } else {
      const below = h - textBox.y1, above = textBox.y0;
      const strip = Math.max(below, above);
      const r = Math.max(26, Math.min(w * 0.14, (strip - 20) / 2.2));
      const cy = below >= above
        ? textBox.y1 + 1.28 * r + 10
        : textBox.y0 - 1.28 * r - 10;
      buildVerts(w * 0.62, Math.max(r + 10, Math.min(h - r * 0.72 - 10, cy)), r);
    }
  }

  // Resting anchor for ambient drift, on the prism's clear side.
  function setIdle() {
    if (!textBox) { idle = { x: w * 0.3, y: h * 0.3 }; return; }
    const leftOfPrism = prism.cx - prism.r;
    if (leftOfPrism > textBox.x1 + 20) {
      idle = { x: (textBox.x1 + leftOfPrism) / 2, y: Math.max(30, Math.min(h - 30, prism.cy * 0.92)) };
    } else {
      const x = Math.max(30, Math.min(prism.cx - prism.r - 16, w * 0.32));
      idle = { x, y: prism.cy >= textBox.y1 ? textBox.y1 + (h - textBox.y1) * 0.5 : textBox.y0 * 0.5 };
    }
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = hero.clientWidth;
    h = hero.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measureText();
    placePrism();
    setIdle();
    if (!lastPointer) {
      const p = constrainTarget(idle.x, idle.y);
      tx = p.x; ty = p.y; sx = p.x; sy = p.y;
    }
  }

  function inTriangle(pt, verts) {
    let neg = false, pos = false;
    for (let i = 0; i < 3; i++) {
      const a = verts[i], b = verts[(i + 1) % 3];
      const cr = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
      if (cr < 0) neg = true; else if (cr > 0) pos = true;
    }
    return !(neg && pos);
  }

  // t along ray o+t*d hitting segment p-q, or null
  function rayEdge(o, d, p, q) {
    const r = sub(q, p);
    const denom = d.x * r.y - d.y * r.x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p.x - o.x) * r.y - (p.y - o.y) * r.x) / denom;
    const s = ((p.x - o.x) * d.y - (p.y - o.y) * d.x) / denom;
    return (t > 1e-6 && s >= 0 && s <= 1) ? t : null;
  }

  function firstHit(o, d, skip) {
    let best = null;
    for (let i = 0; i < 3; i++) {
      if (i === skip) continue;
      const t = rayEdge(o, d, prism.edges[i].p, prism.edges[i].q);
      if (t !== null && (!best || t < best.t)) best = { t, i, point: add(o, mul(d, t)) };
    }
    return best;
  }

  // Snell's law. d: unit incident, n: unit normal opposing d, eta: n1/n2.
  // Returns null at total internal reflection.
  function refract(d, n, eta) {
    const cosI = -dot(d, n);
    const s2 = eta * eta * (1 - cosI * cosI);
    if (s2 > 1) return null;
    const cosT = Math.sqrt(1 - s2);
    return norm(add(mul(d, eta), mul(n, eta * cosI - cosT)));
  }

  const reflect = (d, n) => norm(sub(d, mul(n, 2 * dot(d, n))));

  // keep the source outside the inflated prism (it lives in air)
  function clampOutOfPrism(x, y) {
    const pt = { x, y };
    if (!inTriangle(pt, prism.infl)) return pt;
    const C = { x: prism.cx, y: prism.cy };
    let dir = norm(sub(pt, C));
    if (!dir.x && !dir.y) dir = { x: -1, y: 0 };
    let t = 0;
    for (let i = 0; i < 3; i++) {
      const hit = rayEdge(C, dir, prism.infl[i], prism.infl[(i + 1) % 3]);
      if (hit !== null) t = Math.max(t, hit);
    }
    return add(C, mul(dir, t * 1.04));
  }

  // Hold the source on the prism's side of the copy. The prism sits
  // outside textBox (placePrism guarantees it), so pushing the source
  // past the copy's near edge keeps the whole source->prism beam off
  // the text -- not just the source point.
  function clearOfText(pt) {
    if (!textBox) return pt;
    const out = { x: pt.x, y: pt.y };
    if (prism.cx >= textBox.x1) out.x = Math.max(out.x, textBox.x1);
    else if (prism.cx <= textBox.x0) out.x = Math.min(out.x, textBox.x0);
    if (prism.cy >= textBox.y1) out.y = Math.max(out.y, textBox.y1);
    else if (prism.cy <= textBox.y0) out.y = Math.min(out.y, textBox.y0);
    return out;
  }

  // full keep-out: inside the hero, beam clear of the copy, out of glass
  function constrainTarget(x, y) {
    const m = 12;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let pt = { x: clamp(x, m, w - m), y: clamp(y, m, h - m) };
    pt = clearOfText(pt);
    pt = { x: clamp(pt.x, m, w - m), y: clamp(pt.y, m, h - m) };
    return clampOutOfPrism(pt.x, pt.y);
  }

  function stroke(p, q, width, style) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  }

  function glow(p, radius, color) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawPrism() {
    const [a, b, c] = prism.verts;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();
    ctx.fillStyle = "rgba(242,238,232,0.03)";
    ctx.fill();
    ctx.strokeStyle = "rgba(242,238,232,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const S = { x: sx, y: sy };
    const aim = norm(sub({ x: prism.cx, y: prism.cy }, S));
    const entry = firstHit(S, aim, -1);

    ctx.globalCompositeOperation = "lighter";

    if (entry) {
      const N = prism.normals[entry.i];

      // incident beam: halo, body, core
      stroke(S, entry.point, 8, "rgba(255,61,154,0.06)");
      const body = ctx.createLinearGradient(S.x, S.y, entry.point.x, entry.point.y);
      body.addColorStop(0, "rgba(242,238,232,0)");
      body.addColorStop(0.3, "rgba(242,238,232,0.35)");
      body.addColorStop(1, "rgba(255,61,154,0.8)");
      stroke(S, entry.point, 2.4, body);
      const core = ctx.createLinearGradient(S.x, S.y, entry.point.x, entry.point.y);
      core.addColorStop(0, "rgba(242,238,232,0)");
      core.addColorStop(1, "rgba(242,238,232,0.9)");
      stroke(S, entry.point, 1, core);

      // refract each band through the glass; reflect internally on TIR
      const reach = w * 1.3;
      let exitMid = null;
      for (let i = 0; i < SPECTRUM.length; i++) {
        const band = SPECTRUM[i];
        let d = refract(aim, N, 1 / band.n); // air->glass never TIRs
        if (!d) continue;
        let o = entry.point, skip = entry.i;
        let exitPoint = null, dOut = null;

        for (let bounce = 0; bounce < 3 && !dOut; bounce++) {
          const hit = firstHit(o, d, skip);
          if (!hit) break;
          stroke(o, hit.point, 1, band.c + "30"); // path inside the glass
          const M = prism.normals[hit.i];
          const out = refract(d, mul(M, -1), band.n);
          if (out) {
            exitPoint = hit.point;
            dOut = out;
          } else {
            d = reflect(d, M);
            o = hit.point;
            skip = hit.i;
          }
        }
        if (!dOut) continue;
        if (i === Math.floor(SPECTRUM.length / 2)) exitMid = exitPoint;

        // out into the air
        const far = add(exitPoint, mul(dOut, reach));
        stroke(exitPoint, far, 2.6, band.c + "1F");
        const ray = ctx.createLinearGradient(exitPoint.x, exitPoint.y, far.x, far.y);
        ray.addColorStop(0, band.c + "D9");
        ray.addColorStop(0.5, band.c + "38");
        ray.addColorStop(1, band.c + "00");
        stroke(exitPoint, far, 1.4, ray);
      }

      glow(entry.point, 9, "rgba(242,238,232,0.35)");
      if (exitMid) glow(exitMid, 14, "rgba(255,61,154,0.4)");
    }

    // source node
    glow(S, 10, "rgba(242,238,232,0.25)");
    ctx.beginPath();
    ctx.arc(S.x, S.y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(242,238,232,0.95)";
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    drawPrism();
  }

  function frame(t) {
    if (!tPrev) tPrev = t;
    const dt = Math.min((t - tPrev) / 1000, 0.05);
    tPrev = t;

    // ambient drift around the idle anchor once the pointer's been idle
    if (performance.now() - lastPointer > 4000) {
      const drift = constrainTarget(
        idle.x + w * 0.04 * Math.sin(t / 7000),
        idle.y + h * 0.05 * Math.sin(t / 9400 + 1.3)
      );
      tx = drift.x; ty = drift.y;
    }

    // frame-rate-independent smoothing
    const k = 1 - Math.exp(-dt * 5);
    sx += (tx - sx) * k;
    sy += (ty - sy) * k;

    draw();
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (!rafId && heroVisible && !document.hidden && !reduceMotion.matches) {
      tPrev = 0;
      rafId = requestAnimationFrame(frame);
    }
  }
  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  resize();
  if (reduceMotion.matches) {
    draw(); // one static frame, no loop
  } else {
    start();
  }

  new ResizeObserver(() => { resize(); if (reduceMotion.matches) draw(); }).observe(hero);

  // the copy reflows when the webfonts swap in - remeasure everything
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measureText(); placePrism(); setIdle(); });
  }

  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    const clamped = constrainTarget(e.clientX - r.left, e.clientY - r.top);
    tx = clamped.x;
    ty = clamped.y;
    lastPointer = performance.now();
  }, { passive: true });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      heroVisible = e.isIntersecting;
      heroVisible ? start() : stop();
    }).observe(hero);
  }
  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : start();
  });
  reduceMotion.addEventListener?.("change", () => {
    if (reduceMotion.matches) { stop(); draw(); } else { start(); }
  });
})();
