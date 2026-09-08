// src/components/borrowers/useSectionNav.js
//
// Shared scroll-spy for the sanction screens' left section-nav sidebar (Edit
// Sanction/Review What Was Read modal and the read-only Sanction Detail
// view) — one IntersectionObserver wired to a scrollable container ref and a
// list of section ids, reporting back whichever section is currently most in
// view so the sidebar can highlight it and "jump to section" can scroll it
// into place. Kept framework-thin (just id/ref bookkeeping) since the two
// callers render completely different section content.
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * @param {string[]} sectionIds — in nav order
 * @param {object} [opts]
 * @param {React.RefObject} [opts.rootRef] — the scrollable ancestor to observe
 *   within (defaults to the viewport when omitted)
 */
export function useSectionNav(sectionIds, opts = {}) {
  const { rootRef } = opts;
  const [activeId, setActiveId] = useState(sectionIds[0] || '');
  const sectionRefs = useRef({});

  const setSectionRef = useCallback((id) => (el) => {
    if (el) sectionRefs.current[id] = el;
    else delete sectionRefs.current[id];
  }, []);

  useEffect(() => {
    const root = rootRef?.current || null;
    const els = sectionIds.map((id) => sectionRefs.current[id]).filter(Boolean);
    if (!els.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer the entry closest to the top of the viewport/root among
        // those currently intersecting — matches how a reader's eye tracks
        // which section they're "in" while scrolling past several at once.
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveId(top.target.dataset.sectionId);
      },
      { root, rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIds.join('|'), rootRef]);

  const jumpTo = useCallback((id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  }, []);

  return { activeId, setSectionRef, jumpTo };
}

export default useSectionNav;
