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
  // Set by jumpTo, cleared once its smooth scroll has had time to settle —
  // while it's in the future, the observer below leaves activeId alone
  // instead of following the scroll-in-progress. Without this, clicking a
  // nav item raced the IntersectionObserver: mid-scroll, the target section
  // (and often its neighbour, if they share a row) both briefly intersect,
  // and the very next observer callback could silently override the section
  // the user just clicked with whatever the observer preferred instead.
  const suppressObserverUntilRef = useRef(0);

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
        if (Date.now() < suppressObserverUntilRef.current) return;
        // Prefer the entry closest to the top of the viewport/root among
        // those currently intersecting — matches how a reader's eye tracks
        // which section they're "in" while scrolling past several at once.
        // Two sections can land at the exact same top (e.g. a pair drawn
        // side-by-side in an equal-height grid row) — on that tie, prefer
        // whichever comes first in nav order rather than whatever order the
        // browser happened to report entries in, which is otherwise
        // arbitrary and can silently pick the wrong one of the two.
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const minTop = Math.min(...visible.map((e) => e.boundingClientRect.top));
        const tied = visible.filter((e) => e.boundingClientRect.top === minTop);
        const top = tied.length === 1 ? tied[0] : tied.reduce((a, b) => (
          sectionIds.indexOf(a.target.dataset.sectionId) <= sectionIds.indexOf(b.target.dataset.sectionId) ? a : b
        ));
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
    // Generous window for a "smooth" scroll to finish settling, even over a
    // longer page — the observer resumes normal scroll-spy tracking after.
    suppressObserverUntilRef.current = Date.now() + 1000;
  }, []);

  return { activeId, setSectionRef, jumpTo };
}

export default useSectionNav;
