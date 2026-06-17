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

  function buildPrism() {
    const cx = w * 0.74, cy = h * 0.46, r = Math.min(h, w) * 0.16;
    const verts = [
      { x: cx, y: cy - r },                    // apex
      { x: cx - r * 0.92, y: cy + r * 0.72 },  // bottom-left
      { x: cx + r * 0.92, y: cy + r * 0.72 },  // bottom-right
    ];
    const edges = verts.map((p, i) => ({ p, q: verts[(i + 1) % 3] }));
    const normals = edges.map(({ p, q }) => {
      let n = norm({ x: q.y - p.y, y: -(q.x - p.x) });
      if (dot(n, sub({ x: cx, y: cy }, p)) > 0) n = mul(n, -1); // outward
      return n;
    });
    // inflated copy keeps the light source from entering the glass
    const infl = verts.map((v) => add({ x: cx, y: cy }, mul(sub(v, { x: cx, y: cy }), 1.28)));
    prism = { verts, edges, normals, infl, cx, cy };
  }

  // Tight bounds of the actual hero copy (block elements report
  // full-width boxes, so measure the real glyph runs via a Range),
  // padded, plus a resting anchor placed in free space.
  function buildTextZone() {
    textBox = null;
    idle = { x: w * 0.3, y: Math.max(40, h * 0.22) };
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
    // rest in the gap between the copy and the prism if there's room,
    // otherwise in the band above the copy
    const gap = prism.verts[1].x - textBox.x1;
    idle = gap > 120
      ? { x: textBox.x1 + gap * 0.5, y: h * 0.32 }
      : { x: Math.max(40, Math.min(w * 0.3, textBox.x0 + 40)), y: Math.max(34, textBox.y0 * 0.5) };
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = hero.clientWidth;
    h = hero.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildPrism();
    buildTextZone();
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

  // push a point to the nearest edge of a rect if it's inside
  function pushOutRect(pt, box) {
    if (!box) return pt;
    if (pt.x < box.x0 || pt.x > box.x1 || pt.y < box.y0 || pt.y > box.y1) return pt;
    const dl = pt.x - box.x0, dr = box.x1 - pt.x, dt = pt.y - box.y0, db = box.y1 - pt.y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dt) return { x: pt.x, y: box.y0 };
    if (m === db) return { x: pt.x, y: box.y1 };
    if (m === dl) return { x: box.x0, y: pt.y };
    return { x: box.x1, y: pt.y };
  }

  // full keep-out: inside the hero, off the copy, out of the glass
  function constrainTarget(x, y) {
    const m = 12;
    let pt = { x: Math.max(m, Math.min(w - m, x)), y: Math.max(m, Math.min(h - m, y)) };
    pt = pushOutRect(pt, textBox);
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

  // the copy reflows when the webfonts swap in - remeasure the keep-out
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { buildTextZone(); });
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
