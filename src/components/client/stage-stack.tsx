'use client';

/**
 * "How it works" perspective card stack — a port of the original landing
 * page's GSAP CardSwap: the front card drops away, the rest move up with an
 * elastic ease, and the dropped card returns to the back. Each stage holds for
 * ~2.8 s (the dot under the stack fills as its timer). Hover to hold, click a
 * stage or a dot to jump. With reduced motion the stages render as a plain list.
 *
 * GSAP is bundled from npm, so it satisfies the app's script-src 'self' CSP.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

export interface Stage { n: string; title: string; body: string }

const ICONS = [
  // radar · document · match · pen — same glyphs as the original page
  <svg key="r" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-6 w-6"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><path d="M12 12l6-5" /></svg>,
  <svg key="d" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-6 w-6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>,
  <svg key="m" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-6 w-6"><path d="M4 7h6M14 7h6M4 17h6M14 17h6" /><circle cx="12" cy="7" r="2" /><circle cx="12" cy="17" r="2" /></svg>,
  <svg key="p" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-6 w-6"><path d="M4 20h4L20 8l-4-4L4 16z" /><path d="M14 6l4 4" /></svg>,
];
const TONES = [
  { icon: 'bg-blue/[.12] text-blue', grad: false },
  { icon: 'bg-blue-soft/[.12] text-blue-soft', grad: false },
  { icon: 'bg-sand/[.12] text-sand', grad: false },
  { icon: 'bg-white/15 text-white', grad: true },
];

const SW = {
  dist: 46, vdist: 40, skew: 4, hold: 2.8,
  ease: 'elastic.out(0.62,0.9)', durDrop: 1.4, durMove: 1.4, durReturn: 1.4,
  overlap: 0.9, returnDelay: 0.05,
};

export function StageStack({ stages, hint }: { stages: Stage[]; hint?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<HTMLElement[]>([]);
  const dotFillRefs = useRef<HTMLElement[]>([]);
  const [front, setFront] = useState(0);
  const [animated, setAnimated] = useState(true);
  const [held, setHeld] = useState(false);

  // Mutable animation state lives in a ref so GSAP callbacks see the latest.
  const st = useRef({
    order: [] as number[], tl: null as gsap.core.Timeline | null,
    hold: null as gsap.core.Tween | null, target: null as number | null, seen: false,
    /** Fan spacing scale: 1 at full width, smaller on phones so the fan fits. */
    k: 1,
  });

  const dir = () => (document.documentElement.dir === 'rtl' ? -1 : 1);
  const slot = (i: number, total: number) => {
    const d = dir(), k = st.current.k;
    return { x: i * SW.dist * k * d, y: -i * SW.vdist * k, z: -i * SW.dist * 1.5 * k, zi: total - i };
  };
  const place = (el: HTMLElement, s: ReturnType<typeof slot>) =>
    gsap.set(el, {
      x: s.x, y: s.y, z: s.z, xPercent: -50, yPercent: -50,
      skewY: SW.skew * dir(), transformOrigin: 'center center', zIndex: s.zi, force3D: true,
    });

  const size = useCallback(() => {
    const wrap = wrapRef.current, inner = stackRef.current, els = cardRefs.current;
    if (!wrap || !inner || !els.length) return;
    const n = els.length;
    // Fit card + fan inside the viewport (minus page padding) on narrow screens.
    const fanRatio = 1 + ((n - 1) * SW.dist) / 408;
    const w = Math.round(Math.max(220, Math.min(408, (window.innerWidth - 72) / fanRatio)));
    // Height: the design ratio, or the tallest card's content if that needs more
    // (narrow screens wrap the paragraph onto more lines).
    els.forEach((e) => { e.style.width = `${w}px`; e.style.height = 'auto'; });
    const natural = Math.max(...els.map((e) => e.offsetHeight));
    const h = Math.max(Math.round(w * 0.8), natural);
    st.current.k = w / 408;
    const dx = SW.dist * st.current.k * (n - 1), dy = SW.vdist * st.current.k * (n - 1);
    wrap.style.width = `${w + dx + 24}px`;
    wrap.style.height = `${h + dy + 24}px`;
    els.forEach((e) => { e.style.height = `${h}px`; });
    inner.style.transform = `translate(${(-dx / 2) * dir()}px, ${dy / 2}px)`;
  }, []);

  const holdStart = useCallback(() => {
    const s = st.current;
    s.hold?.kill();
    dotFillRefs.current.forEach((b) => gsap.set(b, { scaleX: 0 }));
    const fill = dotFillRefs.current[s.order[0]];
    if (!fill) return;
    gsap.set(fill, { scaleX: 0, transformOrigin: dir() < 0 ? 'right center' : 'left center' });
    s.hold = gsap.to(fill, { scaleX: 1, duration: SW.hold, ease: 'none', onComplete: () => swap() });
    // swap/holdStart call each other; both are stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const swap = useCallback(() => {
    const s = st.current, els = cardRefs.current;
    if (s.order.length < 2) return;
    s.hold?.kill();
    const [first, ...rest] = s.order;
    const elF = els[first];
    if (!elF) return;
    const total = els.length;
    const tl = gsap.timeline();
    s.tl = tl;

    tl.to(elF, { y: '+=520', duration: SW.durDrop, ease: SW.ease });
    tl.addLabel('promote', `-=${SW.durDrop * SW.overlap}`);
    tl.call(() => setFront(rest[0]), undefined, 'promote');

    rest.forEach((idx, i) => {
      const el = els[idx];
      if (!el) return;
      const sl = slot(i, total);
      tl.set(el, { zIndex: sl.zi }, 'promote');
      tl.to(el, { x: sl.x, y: sl.y, z: sl.z, duration: SW.durMove, ease: SW.ease }, `promote+=${i * 0.14}`);
    });

    const back = slot(total - 1, total);
    tl.addLabel('return', `promote+=${SW.durMove * SW.returnDelay}`);
    tl.call(() => { gsap.set(elF, { zIndex: back.zi }); }, undefined, 'return');
    tl.to(elF, { x: back.x, y: back.y, z: back.z, duration: SW.durReturn, ease: SW.ease }, 'return');

    tl.call(() => {
      s.order = [...rest, first];
      setFront(s.order[0]);
      if (s.target !== null && s.order[0] !== s.target) { swap(); return; }
      s.target = null;
      holdStart();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = (i: number) => {
    const s = st.current;
    if (!animated || i === s.order[0] || (s.tl && s.tl.isActive())) return;
    s.target = i;
    swap();
  };

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setAnimated(false); return; }

    const s = st.current;
    const els = cardRefs.current;
    s.order = els.map((_, i) => i);
    size();
    els.forEach((el, i) => place(el, slot(i, els.length)));
    setFront(0);

    // Start the clock only once the section is on screen; pause when it leaves.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          s.seen = true;
          if (s.tl?.paused()) s.tl.play();
          if (s.hold?.paused()) s.hold.play();
          else if (!s.tl?.isActive() && !s.hold) holdStart();
        } else {
          s.hold?.pause();
          s.tl?.pause();
        }
      });
    }, { threshold: 0.25 });
    if (wrapRef.current) io.observe(wrapRef.current);

    const onResize = () => {
      size();
      s.order.forEach((idx, i) => place(els[idx], slot(i, els.length)));
    };
    window.addEventListener('resize', onResize);

    return () => {
      io.disconnect();
      window.removeEventListener('resize', onResize);
      s.tl?.kill(); s.hold?.kill();
      s.tl = null; s.hold = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages.length]);

  const onEnter = () => { st.current.tl?.pause(); st.current.hold?.pause(); setHeld(true); };
  const onLeave = () => { st.current.tl?.play(); st.current.hold?.play(); setHeld(false); };

  const card = (stage: Stage, i: number, fallback = false) => {
    const tone = TONES[i % TONES.length];
    return (
      <article
        key={stage.n}
        ref={fallback ? undefined : (el) => { if (el) cardRefs.current[i] = el; }}
        className={[
          fallback ? 'relative min-h-[16rem]' : 'swapcard',
          'flex flex-col justify-between gap-6 rounded-3xl p-7 sm:p-8',
          tone.grad ? 'bg-gradient-to-br from-blue to-blue-soft text-white' : 'glass',
        ].join(' ')}
      >
        <div className="flex items-start justify-between">
          <div className={`grid h-12 w-12 place-items-center rounded-2xl ${tone.icon}`}>{ICONS[i % ICONS.length]}</div>
          <span className={`tnum lbl rounded-full border px-3 py-1 text-xs ${tone.grad ? 'border-white/30' : 'border-white/12'}`}>{stage.n}</span>
        </div>
        <div>
          <h3 className={`text-2xl sm:text-[1.65rem] ${tone.grad ? 'font-semibold' : ''}`}>{stage.title}</h3>
          <p className={`mt-3 text-sm leading-relaxed ${tone.grad ? 'text-white/80' : 'text-muted'}`}>{stage.body}</p>
        </div>
        <div className={`h-px w-full ${tone.grad ? 'bg-white/20' : 'bg-white/[.08]'}`} />
      </article>
    );
  };

  return (
    <div className="grid items-center gap-16 lg:grid-cols-2">
      {/* stage index */}
      <div className="order-2 lg:order-1">
        <ol className="space-y-2">
          {stages.map((s, i) => (
            <li
              key={s.n}
              onClick={() => goTo(i)}
              className={`stagerow relative flex cursor-pointer items-baseline gap-4 rounded-e-xl py-4 pe-3 ps-5 ${front === i ? 'on' : ''}`}
            >
              <span className="st-n tnum lbl text-xs text-muted/50">{s.n}</span>
              <span className="st-t text-lg font-medium text-muted">{s.title}</span>
            </li>
          ))}
        </ol>
        {hint && animated && (
          <p className="mt-7 text-xs leading-relaxed text-muted/60">{hint}</p>
        )}
      </div>

      {/* perspective stack */}
      <div className="order-1 flex flex-col items-center lg:order-2">
        {animated ? (
          <>
            <div
              ref={wrapRef}
              className={`stackwrap relative ${held ? 'held' : ''}`}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
            >
              <div ref={stackRef} className="stack absolute inset-0">
                {stages.map((s, i) => card(s, i))}
              </div>
            </div>
            <div className="mt-7 flex items-center gap-2.5">
              {stages.map((s, i) => (
                <button
                  key={s.n}
                  type="button"
                  aria-label={s.title}
                  onClick={() => goTo(i)}
                  className={`stackdot ${front === i ? 'on' : ''}`}
                >
                  <i ref={(el) => { if (el) dotFillRefs.current[i] = el; }} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="grid w-full max-w-[408px] gap-5">{stages.map((s, i) => card(s, i, true))}</div>
        )}
      </div>
    </div>
  );
}
