// Side decorations for wide screens. One fixed canvas sits behind the page; for every section
// on screen it draws that section's style in the empty margins either side of its `.wrap`
// (the content column), so nothing ever lands under text. Margins narrower than MIN_GUTTER
// get nothing, which in practice means windows under ~1370px wide stay plain.

import type { DecorKind } from '../data/site';

type Geo = { top: number; h: number; gw: number };
// `roll` decides whether this wire carries a pulse: it does when roll < motion
type Trace = {
  pts: [number, number][];
  segs: number[];
  len: number;
  speed: number;
  phase: number;
  pink: boolean;
  roll: number;
};
type Zone = { key: string; el: HTMLElement; kind: DecorKind; seed: number; traces?: { key: string; sides: Trace[][] } };

const CYAN = '95,243,238';
const MINT = '198,255,218';
const PINK = '255,122,217';
const INK = '180,255,250';
const MUTED = '93,127,122';
const TAU = Math.PI * 2;
const MIN_GUTTER = 90;
const FADE = 70; // px of soft fade where one section's decor meets the next
const FONT = '"JetBrains Mono Variable", ui-monospace, monospace';
const STILL = new Set<DecorKind>(['gutter', 'none']); // only redraw on scroll / pointer

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (...n: number[]) => {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
};
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export type Tune = { amount: number; motion: number };

export function startDecor(canvas: HTMLCanvasElement, config: Record<string, DecorKind>, initial: Tune) {
  const ctx = canvas.getContext('2d')!;
  const tune = { ...initial };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: -9999, y: -9999, inside: false };
  let vw = 0;
  let vh = 0;
  let raf = 0;
  let lastGutter = 0;

  const zones: Zone[] = Object.entries(config).flatMap(([key, kind]) => {
    const el = document.getElementById(key) ?? document.querySelector<HTMLElement>(key);
    return el ? [{ key, el, kind, seed: hash(...[...key].map((c) => c.charCodeAt(0))) }] : [];
  });

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    vw = canvas.clientWidth;
    vh = canvas.clientHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kick();
  }

  // x measured from the screen edge inward, mirrored for the right margin
  const sx = (side: number, xl: number) => (side ? vw - xl : xl);

  // ---------------------------------------------------------------- styles

  function halftone(g: Geo, t: number, inward: boolean) {
    const S = Math.round(lerp(26, 16, tune.amount)); // more amount, tighter grid
    const j0 = Math.max(0, Math.floor((-S - g.top) / S));
    for (let j = j0; ; j++) {
      const y = g.top + j * S + S / 2;
      if (y > Math.min(g.top + g.h, vh) + S) break;
      const stagger = j & 1 ? S / 2 : 0;
      for (let xl = S / 2 + stagger; xl < g.gw; xl += S) {
        const out = 1 - xl / g.gw; // 1 at the screen edge, 0 by the content
        let r = inward ? lerp(S * 0.44, 0.7, out ** 0.9) : lerp(0.7, S * 0.44, out ** 1.3);
        if (!reduce) r *= 1 + 0.14 * tune.motion * Math.sin(t / 1300 + y / 80 + xl / 55);
        const a = inward ? lerp(0.28, 0.05, out) : lerp(0.05, 0.28, out);
        for (const side of [0, 1]) {
          const x = sx(side, xl);
          const pd = Math.hypot(x - pointer.x, y - pointer.y);
          const near = pd < 160 ? (1 - pd / 160) ** 2 : 0;
          ctx.fillStyle = near > 0.05 ? `rgba(${PINK},${Math.min(1, a + near * 0.45)})` : `rgba(${CYAN},${a})`;
          ctx.beginPath();
          ctx.arc(x, y, Math.min(S * 0.5, r * (1 + 1.1 * near)), 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  // PCB traces that end in a ring, like the ones in the CompE logo, with pulses running along them
  function buildTraces(z: Zone, g: Geo) {
    const key = `${Math.round(g.gw)}:${Math.round(g.h)}:${tune.amount}`;
    if (z.traces?.key === key) return z.traces.sides;
    const rand = rng(z.seed + Math.round(g.gw));
    const sides = [0, 1].map(() => {
      // amount 1 is a wire every ~110px down the section; 0 leaves just one or two
      const n = Math.max(1, Math.round((g.h / 110) * lerp(0.15, 1, tune.amount)));
      const list: Trace[] = [];
      for (let k = 0; k < n; k++) {
        const y = ((k + 0.5) * g.h) / n + (rand() - 0.5) * (g.h / n) * 0.5;
        const a = g.gw * (0.08 + rand() * 0.3);
        const d = 20 + rand() * Math.min(70, g.gw * 0.25);
        const y1 = y + (rand() < 0.5 ? -d : d);
        const c = Math.min(g.gw - 14, a + d + g.gw * (0.12 + rand() * 0.35));
        const pts: [number, number][] =
          c > a + d + 8 ? [[-4, y], [a, y], [a + d, y1], [c, y1]] : [[-4, y], [Math.min(c, g.gw - 14), y]];
        const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
        list.push({
          pts,
          segs,
          len: segs.reduce((s, v) => s + v, 0),
          speed: 40 + rand() * 60,
          phase: rand(),
          pink: rand() < 0.22,
          roll: rand(),
        });
      }
      return list;
    });
    z.traces = { key, sides };
    return sides;
  }

  function traces(z: Zone, g: Geo, t: number) {
    const sides = buildTraces(z, g);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    sides.forEach((list, side) => {
      for (const tr of list) {
        const P = tr.pts.map(([x, y]) => [sx(side, x), g.top + y] as const);
        if (P.every(([, y]) => y < -20) || P.every(([, y]) => y > vh + 20)) continue;

        ctx.strokeStyle = `rgba(${CYAN},0.13)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();

        const pulsing = !reduce && tr.roll < tune.motion;

        // where the pulse is along the path
        const speed = tr.speed * lerp(0.3, 1.2, tune.motion);
        const f = pulsing ? (t / 1000 / (tr.len / speed) + tr.phase) % 1 : 0;
        let s = f * tr.len;
        let px = P[0][0];
        let py = P[0][1];
        for (let i = 0; i < tr.segs.length; i++) {
          if (s <= tr.segs[i]) {
            const k = s / tr.segs[i];
            px = lerp(P[i][0], P[i + 1][0], k);
            py = lerp(P[i][1], P[i + 1][1], k);
            break;
          }
          s -= tr.segs[i];
        }

        // ring at the end; it lights up as the pulse arrives
        const [ex, ey] = P[P.length - 1];
        const hit = f > 0.9 ? (f - 0.9) / 0.1 : 0;
        ctx.fillStyle = '#030606';
        ctx.strokeStyle = `rgba(${tr.pink ? PINK : CYAN},${0.26 + hit * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ex, ey, 5.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
        if (!pulsing) continue;

        const col = tr.pink ? PINK : INK;
        ctx.shadowColor = `rgba(${col},0.7)`;
        ctx.shadowBlur = 8;
        ctx.fillStyle = `rgba(${col},0.75)`;
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
  }

  const RAIN = '01<>{}[]/=+;:$#*HACKED';
  function rain(z: Zone, g: Geo, t: number) {
    const col = Math.round(lerp(64, 20, tune.amount)); // more amount, more columns
    const trail = Math.round(lerp(5, 14, tune.amount));
    const lh = 18;
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cols = Math.floor(g.gw / col);
    const pace = reduce ? 0 : lerp(0, 1, tune.motion);
    for (const side of [0, 1]) {
      for (let i = 0; i < cols; i++) {
        const xl = col * (i + 0.5);
        const out = 1 - xl / g.gw;
        const seed = hash(z.seed, side, i);
        const speed = (25 + ((seed % 1000) / 1000) * 55) * pace;
        const span = g.h + 300;
        const head = (((t / 1000) * speed + (seed % 997) * 7) % span) - 150;
        const pink = seed % 7 === 0;
        for (let k = 0; k < trail; k++) {
          const y = head - k * lh;
          const Y = g.top + y;
          if (y < -lh || y > g.h + lh || Y < -20 || Y > vh + 20) continue;
          const a = (k === 0 ? 0.5 : 0.28 * (1 - k / trail)) * (0.25 + 0.75 * out);
          // characters change less as motion drops (and not at all at 0)
          const flick = pace ? Math.floor((t * pace) / (k === 0 ? 110 : 900)) : 0;
          const ch = RAIN[hash(seed, Math.floor(y / lh), flick) % RAIN.length];
          ctx.fillStyle = `rgba(${k === 0 ? INK : pink ? PINK : CYAN},${a})`;
          ctx.fillText(ch, sx(side, xl), Y);
        }
      }
    }
  }

  // a code editor's margins: line numbers + git marks on the left, a minimap-ish column on the right
  function codeBars(x0: number, maxW: number, y: number, row: number, seed: number, a: number, mirror: boolean) {
    const h = hash(seed, row);
    if (h % 6 === 0) return; // blank line
    const palette = [CYAN, MINT, PINK, MUTED, INK, CYAN, MUTED];
    let x = ((h >>> 3) % 5) * 12;
    const tokens = 1 + (h % 4);
    for (let k = 0; k < tokens; k++) {
      const hk = hash(h, k);
      const w = 8 + (hk % 46);
      if (x + w > maxW) break;
      ctx.fillStyle = `rgba(${palette[hk % palette.length]},${a})`;
      ctx.fillRect(mirror ? x0 - x - w : x0 + x, y - 2, w, 4);
      x += w + 6;
    }
  }

  function gutter(z: Zone, g: Geo) {
    const lh = 24;
    const focus = pointer.inside ? pointer.y : vh * 0.45;
    ctx.font = `500 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    const j0 = Math.max(0, Math.floor(-g.top / lh));
    for (let j = j0; ; j++) {
      const y = g.top + j * lh + lh / 2;
      if (y > Math.min(g.top + g.h, vh) + lh) break;
      const docRow = Math.floor((y + scrollY) / lh) + 1;
      const cur = Math.abs(y - focus) < lh / 2;
      const hm = hash(z.seed, docRow);

      // left: numbers hug the content edge, code fills the rest
      if (cur) {
        ctx.fillStyle = `rgba(${CYAN},0.06)`;
        ctx.fillRect(0, y - lh / 2, g.gw, lh);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = cur ? `rgba(${INK},0.95)` : `rgba(${MUTED},0.6)`;
      ctx.fillText(String(docRow), g.gw - 12, y);
      if (cur) {
        ctx.fillStyle = `rgba(${PINK},0.9)`;
        ctx.fillText('>', g.gw - 50, y);
      }
      if (hm % 9 === 0 || hm % 13 === 0) {
        ctx.fillStyle = hm % 9 === 0 ? `rgba(${MINT},0.6)` : `rgba(${PINK},0.6)`;
        ctx.fillRect(g.gw - 4, y - lh / 2 + 3, 3, lh - 6);
      }
      if (g.gw > 140) codeBars(g.gw - 70, g.gw - 90, y, docRow, z.seed, 0.22, true);

      // right: two minimap rows per line, fading toward the screen edge
      for (const half of [0, 1]) {
        const yy = y - lh / 4 + half * (lh / 2);
        codeBars(vw - g.gw + 16, g.gw - 32, yy, docRow * 2 + half, z.seed + 1, 0.26, false);
      }
    }
  }

  // rings spreading in from the screen edges, a few sources per section
  function ripples(z: Zone, g: Geo, t: number) {
    const gap = Math.round(lerp(90, 40, tune.amount)); // more amount, more rings
    const maxR = g.gw * 1.2 + 40;
    const shift = reduce ? 0 : ((t / 1000) * 22 * tune.motion) % gap;
    const every = 420;
    const n = Math.max(1, Math.round(g.h / every));
    ctx.lineWidth = 1.5;
    for (const side of [0, 1]) {
      for (let m = 0; m < n; m++) {
        // stagger left and right sources so the two sides don't mirror each other exactly
        const cy = g.top + (m + 0.5 + (side ? 0.2 : -0.2)) * (g.h / n);
        if (cy + maxR < 0 || cy - maxR > vh) continue;
        const cx = side ? vw + 30 : -30;
        for (let k = 0; ; k++) {
          const r = k * gap + shift;
          if (r > maxR) break;
          const a = 0.22 * (1 - r / maxR);
          ctx.strokeStyle = `rgba(${(k + m) % 3 === 1 ? PINK : CYAN},${a})`;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.stroke();
        }
      }
    }
  }

  // ---------------------------------------------------------------- loop

  function draw(t: number) {
    ctx.clearRect(0, 0, vw, vh);
    let animate = false;
    lastGutter = 0;
    for (const z of zones) {
      if (z.kind === 'none') continue;
      const r = z.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const wrap = (z.el.querySelector('.wrap') ?? z.el).getBoundingClientRect();
      const gw = Math.min(wrap.left, vw - wrap.right) - 6;
      lastGutter = Math.max(lastGutter, gw);
      if (gw < MIN_GUTTER) continue;
      const g: Geo = { top: r.top, h: r.height, gw };

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, r.top, gw, r.height);
      ctx.rect(vw - gw, r.top, gw, r.height);
      ctx.clip();

      if (z.kind === 'halftone' || z.kind === 'halftone-in') halftone(g, t, z.kind === 'halftone-in');
      else if (z.kind === 'traces') traces(z, g, t);
      else if (z.kind === 'rain') rain(z, g, t);
      else if (z.kind === 'gutter') gutter(z, g);
      else if (z.kind === 'ripples') ripples(z, g, t);

      // soften the top and bottom edges so neighbouring sections blend
      ctx.globalCompositeOperation = 'destination-out';
      for (const [y0, y1] of [
        [r.top, r.top + FADE],
        [r.bottom, r.bottom - FADE],
      ]) {
        const grad = ctx.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, Math.min(y0, y1), vw, FADE);
      }
      ctx.restore();

      if (!STILL.has(z.kind) && tune.motion > 0) animate = true;
    }
    return animate;
  }

  function loop(t: number) {
    raf = 0;
    const animate = draw(t);
    if (animate && !reduce) raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  addEventListener('resize', resize);
  addEventListener('scroll', kick, { passive: true });
  addEventListener(
    'pointermove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
      kick();
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.x = pointer.y = -9999;
    pointer.inside = false;
    kick();
  });
  document.fonts?.ready.then(kick);
  resize();

  return {
    set(key: string, kind: DecorKind) {
      const z = zones.find((z) => z.key === key);
      if (z) z.kind = kind;
      kick();
    },
    setTune(next: Partial<Tune>) {
      Object.assign(tune, next);
      kick();
    },
    /** widest margin seen on the last frame, for the tuning panel */
    gutter: () => Math.round(lastGutter),
    minGutter: MIN_GUTTER,
  };
}
