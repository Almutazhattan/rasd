'use client';

/**
 * Scroll reveal, as on the original landing page: elements marked `.reveal`
 * rise 34px and fade in once as they enter the viewport. Stagger with an
 * inline transitionDelay. Mount once per page.
 *
 * Content is never left hidden: an inline script in the root layout sets
 * html.reveal-ready before first paint and reveals everything after 2.5 s if
 * this component never mounts; reduced-motion users never see it hidden.
 */
import { useEffect } from 'react';

export function RevealOnScroll() {
  useEffect(() => {
    (window as unknown as { __revealMounted?: boolean }).__revealMounted = true;
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal:not(.active)'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('active'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('active');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    // Anything already on screen reveals on the first frame; the rest on scroll.
    els.forEach((el) => io.observe(el));
    document.documentElement.classList.add('reveal-ready');

    // A fast fling can jump past an element between frames, so the observer
    // never sees it intersect. Reveal anything that is above the fold already.
    let raf = 0;
    const sweep = () => {
      raf = 0;
      const limit = window.innerHeight;
      document.querySelectorAll<HTMLElement>('.reveal:not(.active)').forEach((el) => {
        if (el.getBoundingClientRect().top < limit) { el.classList.add('active'); io.unobserve(el); }
      });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sweep); };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
