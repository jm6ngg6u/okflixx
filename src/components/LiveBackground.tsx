import { useEffect, useRef } from "react";

/**
 * Florzin-style light beam background.
 *
 * Dense clusters of thin, mostly-horizontal wispy beams that bundle into
 * 2 glowing bands. Beams bob vertically over time (real wave motion),
 * react to cursor, scroll (parallax + velocity push) and tap (radial pulse).
 * Non-accumulating by default so color never builds up.
 */
type Props = {
  /** 0 = no trail (default, safe), 0.05–0.15 = subtle motion blur. Max 0.25. */
  trail?: number;
  /** Master alpha multiplier, 0..1. Default 0.9. */
  intensity?: number;
  /** Number of thin beams per band. Default 22. */
  beamsPerBand?: number;
};

export function LiveBackground({ trail = 0, intensity = 0.9, beamsPerBand = 22 }: Props = {}) {
  const ribbonRef = useRef<HTMLCanvasElement>(null);
  const starRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ribbonRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const trailAmt = Math.max(0, Math.min(0.25, trail));
    const inten = Math.max(0, Math.min(1, intensity));

    let w = 0, h = 0, dpr = 1;
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
    const scroll = { y: 0, ty: 0, vel: 0 };
    const pulse = { v: 0, x: 0, y: 0 };

    type Beam = {
      bandY: number;
      yOffset: number;
      curve: number;
      phase: number;
      speed: number;
      length: number;
      xShift: number;
      bobAmp: number;
      bobSpeed: number;
      hue: [number, number, number];
      alpha: number;
      thickness: number;
      ox: number;
      oy: number;
      jx: number; // tiny per-beam offset inside the logo area
      jy: number;
      wobble: number; // slow drift of the start point
      scatterX: number; // 0..1, this beam's permanent x position when logo is off-screen
      scatterY: number; // px offset above top edge when logo is off-screen
    };
    let beams: Beam[] = [];

    const palette: Array<[number, number, number]> = [
      [229, 9, 20],
      [255, 60, 72],
      [255, 120, 130],
      [255, 255, 255],
      [180, 6, 15],
    ];

    const getOrigin = () => {
      // Anchor to the real logo element if present, else fall back to nav corner.
      const el = document.querySelector<HTMLElement>('[data-wave-origin]')
        || document.querySelector<HTMLElement>('nav a img, nav img');
      const fallbackX = w < 768 ? 32 : w < 1024 ? 56 : 80;
      const fallbackY = w < 768 ? 44 : 60;
      let x = fallbackX, y = fallbackY;
      let visible = true;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          x = r.left + r.width / 2;
          y = r.top + r.height / 2;
          // Logo has scrolled above the viewport — mark origin as hidden
          if (r.bottom < 0) visible = false;
        }
      }
      x = Math.max(24, Math.min(w - 24, x));
      // Keep origin pinned near the top edge when the logo scrolls away, so beams
      // stay full-strength across the viewport instead of shrinking to nothing.
      y = Math.max(fallbackY, Math.min(h - 40, y));
      return { x, y, visible };
    };


    const build = () => {
      beams = [];
      const origin = getOrigin();
      const originX = origin.x;
      const originY = origin.y;
      // Start every beam inside the logo footprint, then fan outward with varied
      // endpoints/control points. This keeps the animation visually attached to
      // the logo without turning the whole scene into one hard point-source ray.
      for (let i = 0; i < beamsPerBand * 2; i++) {
        // Beams start from within the logo footprint, spread evenly (no tight center cluster)
        const logoRadius = w < 768 ? 18 : 22;
        const angle = Math.random() * Math.PI * 2;
        // Linear radius (not pow) => even distribution across the disk, no dense center dot
        const radius = Math.sqrt(Math.random()) * logoRadius;
        const jx = Math.cos(angle) * radius;
        const jy = Math.sin(angle) * radius;
        // Endpoint fans across the far edge (varied y) so beams don't collapse to one target
        const endY = originY + 120 + Math.random() * (h * 0.85);
        beams.push({
          bandY: endY,
          yOffset: (Math.random() - 0.5) * 30,
          curve: (Math.random() - 0.5) * 220, // stronger bow → visible waves
          phase: Math.random() * Math.PI * 2,
          speed: 0.00018 + Math.random() * 0.0005,
          length: 0.9 + Math.random() * 0.25,
          xShift: Math.random() * Math.PI * 2,
          bobAmp: 18 + Math.random() * 46,
          bobSpeed: 0.14 + Math.random() * 0.32,
          hue: palette[Math.floor(Math.random() * palette.length)],
          alpha: 0.22 + Math.random() * 0.5,
          thickness: 0.35 + Math.random() * 0.9,
          ox: originX,
          oy: originY,
          jx,
          jy,
          wobble: Math.random() * Math.PI * 2,
          scatterX: Math.random(),
          scatterY: -20 - Math.random() * 120,
        } as Beam);
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };
    resize();
    // Rebuild once after mount so the logo element is in the DOM
    const initialAnchor = setTimeout(() => build(), 30);
    // Track logo position live (survives scroll & responsive layout shifts)
    let originVisible = true;
    const trackOrigin = () => {
      const o = getOrigin();
      originVisible = o.visible;
      // Always scatter beams across the top edge — never a point source.
      // The logo stays as a decorative element, not the beam emitter.
      for (const b of beams) {
        b.ox = b.scatterX * w;
        b.oy = b.scatterY;
      }
    };




    const onMove = (e: MouseEvent) => { mouse.tx = e.clientX; mouse.ty = e.clientY; mouse.active = true; };
    const onLeave = () => { mouse.active = false; };
    const onScroll = () => { scroll.ty = window.scrollY || 0; };
    const onTap = (e: PointerEvent) => {
      pulse.v = Math.min(1.2, pulse.v + 0.9);
      pulse.x = e.clientX; pulse.y = e.clientY;
      mouse.tx = e.clientX; mouse.ty = e.clientY; mouse.active = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) { mouse.tx = t.clientX; mouse.ty = t.clientY; mouse.active = true; }
    };
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onTap);
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    const drawBeam = (b: Beam, tGlobal: number) => {
      const t = b.phase;
      const bob = Math.sin(tGlobal * b.bobSpeed + b.phase) * b.bobAmp;
      // Bounded parallax so beams never wander off-screen no matter how far you scroll
      const scrollBounded = Math.tanh(scroll.y / 800) * 40; // caps at ~±40px
      const parallax = Math.sin(b.phase * 0.2 + b.xShift) * scrollBounded;

      // Start point stays inside the logo footprint on all viewport sizes,
      // with only a tiny wobble so it remains visibly attached to the logo.
      const wob = tGlobal * 0.5 + b.wobble;
      const x0 = b.ox + b.jx + Math.cos(wob) * 1.8;
      const y0 = b.oy + b.jy + Math.sin(wob * 1.3) * 1.8;

      // Endpoint varies per beam: some go off-right, some off-bottom, some off-left.
      // xShift-derived deterministic direction so each beam keeps its identity.
      const dir = (Math.sin(b.xShift * 2.13) + 1) * 0.5;   // 0..1
      const endDrift = Math.sin(tGlobal * b.bobSpeed * 0.8 + b.xShift) * 40;
      let x1: number;
      if (dir < 0.55) {
        x1 = w + 60 + Math.sin(b.xShift) * 40;             // rightward
      } else if (dir < 0.85) {
        x1 = w * (0.25 + Math.cos(b.xShift * 1.7) * 0.25); // land inside viewport (down)
      } else {
        x1 = -60 + Math.cos(b.xShift) * 40;                // leftward
      }
      const y1 = b.bandY + b.yOffset + bob - parallax + scroll.vel * 0.25 + endDrift;

      // Control point creates the arcing wave; animated for live motion
      const cx = x0 + (x1 - x0) * (0.35 + 0.1 * Math.sin(tGlobal * 0.3 + b.phase));
      let cy = (y0 + y1) / 2 + b.curve
        + Math.sin(tGlobal * (b.bobSpeed + 0.2) + b.phase * 1.5) * (b.bobAmp * 0.9 + 20);

      // tap pulse — push beams radially outward from tap point
      if (pulse.v > 0.01) {
        const pdx = cx - pulse.x, pdy = cy - pulse.y;
        const pd = Math.sqrt(pdx * pdx + pdy * pdy) + 0.001;
        const R = 520;
        if (pd < R) {
          const f = (1 - pd / R) * pulse.v;
          cy += (pdy / pd) * f * 60;
        }
      }

      if (mouse.active) {
        const dx = mouse.x - cx, dy = mouse.y - cy;
        const d2 = dx * dx + dy * dy;
        const R = 420;
        if (d2 < R * R) {
          const f = 1 - d2 / (R * R);
          cy += dy * f * 0.7;
        }
      }

      const [R, G, B] = b.hue;
      const layers = [
        { w: b.thickness * 18, a: 0.012 },
        { w: b.thickness * 6,  a: 0.035 },
        { w: b.thickness * 2,  a: 0.10 },
        { w: b.thickness * 0.6, a: 0.35 },
      ];
      const aMul = b.alpha * inten * (1 + pulse.v * 0.35);

      // Emitter glow removed — was showing as a bright red ball around the logo.



      for (const layer of layers) {
        ctx.beginPath();
        ctx.lineWidth = layer.w;
        ctx.strokeStyle = `rgba(${R},${G},${B},${layer.a * aMul})`;
        ctx.lineCap = "round";
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(cx, cy, x1, y1);
        ctx.stroke();
      }
    };

    let raf = 0;
    const tStart = performance.now();
    const tick = () => {
      const tGlobal = (performance.now() - tStart) / 1000;

      if (mouse.active) {
        mouse.x += (mouse.tx - mouse.x) * 0.09;
        mouse.y += (mouse.ty - mouse.y) * 0.09;
      }
      const prevY = scroll.y;
      scroll.y += (scroll.ty - scroll.y) * 0.12;
      scroll.vel = scroll.vel * 0.85 + (scroll.y - prevY) * 0.2;
      pulse.v *= 0.93;
      trackOrigin();

      ctx.globalCompositeOperation = "source-over";
      if (trailAmt <= 0) {
        ctx.clearRect(0, 0, w, h);
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(1 - trailAmt, 1.5)})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalCompositeOperation = "lighter";
      for (const b of beams) {
        b.phase += b.speed * 16;
        drawBeam(b, tGlobal);
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onTap);
      window.removeEventListener("touchmove", onTouchMove);
      clearTimeout(initialAnchor);
    };
  }, [trail, intensity, beamsPerBand]);

  useEffect(() => {
    const canvas = starRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0, dpr = 1;
    type Star = { x: number; y: number; r: number; a: number; tw: number; red: boolean };
    let stars: Star[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.floor((w * h) / 22000);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 0.9 + 0.2,
          a: 0.12 + Math.random() * 0.35,
          tw: Math.random() * Math.PI * 2,
          red: Math.random() < 0.1,
        });
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.tw += 0.015;
        const a = s.a * (0.5 + 0.5 * Math.sin(s.tw));
        ctx.fillStyle = s.red ? `rgba(229,9,20,${a})` : `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0, background: "#000" }} aria-hidden>
      <canvas ref={starRef} className="absolute inset-0 block opacity-60" />
      <canvas
        ref={ribbonRef}
        className="absolute inset-0 block"
        style={{ mixBlendMode: "screen" }}
      />
      <div className="bg-vignette" />
    </div>
  );
}
