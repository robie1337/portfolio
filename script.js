/* MAHMOUD RABIE — portfolio
   Vanilla JS. Budget: observers, a ticker toggle, filters,
   and one canvas prism. Nothing per-frame except the beam. */

(() => {
  "use strict";

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* ─── Sticky masthead state via sentinel ─── */
  const masthead = document.querySelector(".masthead");
  const sentinel = document.getElementById("masthead-sentinel");
  if (masthead && sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      masthead.classList.toggle("is-stuck", !e.isIntersecting);
    }).observe(sentinel);
  }

  /* ─── Scroll reveal (one shared observer) ─── */
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

  /* ─── Ticker pause/play (WCAG 2.2.2) ─── */
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

  /* ─── Domain filters ─── */
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

  /* ─── The prism ───────────────────────────────────────────────
     Cursor = light source. Beam hits the prism, exits as a
     magenta→violet dispersion fan. Static frame under
     prefers-reduced-motion; loop pauses offscreen.            */
  const canvas = document.getElementById("beam");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero) return;
  const ctx = canvas.getContext("2d");

  const SPECTRUM = ["#FF3D9A", "#F4509F", "#D957C9", "#BC60E3", "#A467F2", "#8B6CFF"];
  let w = 0, h = 0, dpr = 1;
  let prism = null;
  // light source position (lerped) and its target
  let sx = 0, sy = 0, tx = 0, ty = 0;
  let lastPointer = 0;
  let rafId = 0;
  let heroVisible = true;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = hero.clientWidth;
    h = hero.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w * 0.74, cy = h * 0.46, r = Math.min(h, w) * 0.16;
    prism = {
      cx, cy,
      a: { x: cx, y: cy - r },                       // apex
      b: { x: cx - r * 0.92, y: cy + r * 0.72 },     // bottom-left
      c: { x: cx + r * 0.92, y: cy + r * 0.72 },     // bottom-right
    };
    if (!lastPointer) { tx = w * 0.16; ty = h * 0.3; sx = tx; sy = ty; }
  }

  function drawPrism() {
    const { a, b, c } = prism;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();
    ctx.fillStyle = "rgba(242,238,232,0.03)";
    ctx.fill();
    ctx.strokeStyle = "rgba(242,238,232,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    const { a, b, c } = prism;
    // entry: midpoint of the left face, exit: midpoint of the right face
    const P = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const E = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };

    ctx.globalCompositeOperation = "lighter";

    // incident beam: source → entry point (double-stroked: halo + core)
    const beam = ctx.createLinearGradient(sx, sy, P.x, P.y);
    beam.addColorStop(0, "rgba(242,238,232,0)");
    beam.addColorStop(0.25, "rgba(242,238,232,0.55)");
    beam.addColorStop(1, "rgba(255,61,154,0.9)");
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(P.x, P.y);
    ctx.strokeStyle = "rgba(255,61,154,0.10)"; ctx.lineWidth = 7; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(P.x, P.y);
    ctx.strokeStyle = beam; ctx.lineWidth = 1.4; ctx.stroke();

    // source node
    ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(242,238,232,0.9)"; ctx.fill();

    // internal segment, dimmer
    ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(E.x, E.y);
    ctx.strokeStyle = "rgba(242,238,232,0.30)"; ctx.lineWidth = 1; ctx.stroke();

    // dispersion fan: blend of incoming direction and the right-face normal
    const inAngle = Math.atan2(E.y - sy, E.x - sx);
    const normal = Math.atan2(E.y - prism.cy, E.x - prism.cx);
    const base = inAngle * 0.45 + normal * 0.55;
    const reach = w * 1.2;
    const n = SPECTRUM.length;
    for (let i = 0; i < n; i++) {
      const spread = (i / (n - 1) - 0.5) * 0.62;
      const wobble = Math.sin(t / 1400 + i * 1.7) * 0.012;
      const ang = base + spread + wobble;
      const x2 = E.x + Math.cos(ang) * reach;
      const y2 = E.y + Math.sin(ang) * reach;
      const g = ctx.createLinearGradient(E.x, E.y, x2, y2);
      g.addColorStop(0, SPECTRUM[i] + "E6");
      g.addColorStop(0.55, SPECTRUM[i] + "38");
      g.addColorStop(1, SPECTRUM[i] + "00");
      ctx.beginPath(); ctx.moveTo(E.x, E.y); ctx.lineTo(x2, y2);
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.stroke();
    }

    // exit glow
    ctx.beginPath(); ctx.arc(E.x, E.y, 12, 0, Math.PI * 2);
    const halo = ctx.createRadialGradient(E.x, E.y, 0, E.x, E.y, 12);
    halo.addColorStop(0, "rgba(255,61,154,0.5)");
    halo.addColorStop(1, "rgba(255,61,154,0)");
    ctx.fillStyle = halo; ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    drawPrism();
  }

  function frame(t) {
    // ambient drift when the pointer has been idle (or never arrived)
    if (performance.now() - lastPointer > 4000) {
      tx = w * (0.18 + 0.07 * Math.sin(t / 5200));
      ty = h * (0.32 + 0.14 * Math.sin(t / 3600 + 1.3));
    }
    sx += (tx - sx) * 0.07;
    sy += (ty - sy) * 0.07;
    draw(t);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (!rafId && heroVisible && !document.hidden && !reduceMotion.matches) {
      rafId = requestAnimationFrame(frame);
    }
  }
  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  resize();
  if (reduceMotion.matches) {
    draw(0); // one static frame, no loop
  } else {
    start();
  }

  new ResizeObserver(() => { resize(); if (reduceMotion.matches) draw(0); }).observe(hero);

  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    tx = e.clientX - r.left;
    ty = e.clientY - r.top;
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
    if (reduceMotion.matches) { stop(); draw(0); } else { start(); }
  });
})();
