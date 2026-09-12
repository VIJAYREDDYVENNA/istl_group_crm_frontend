// src/components/Dropdowns/FilterSelect.js — custom styled dropdown with portal rendering
// Renders the dropdown list via ReactDOM.createPortal at document.body level
// so it is never clipped by overflow:hidden/auto on any ancestor (modals, drawers, etc.)
import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import '../../components_css/Dropdowns/FilterSelect.css';

/**
 * Props:
 *   value        {string}          — current selected value
 *   onChange     {(value) => void} — called with new value string
 *   options      {Array<{ value, label }>}
 *   placeholder  {string}          — shown when no value selected
 *   disabled     {boolean}
 *   id           {string}          — for label htmlFor
 *   searchable   {boolean}         — enables inline search/filter input in the dropdown
 *   searchPlaceholder {string}     — placeholder for the inline search input (searchable only)
 */
const FilterSelect = ({ value, onChange, options = [], placeholder = 'Select', disabled = false, id, searchable = 'auto', searchPlaceholder = 'Search…' }) => {
  // 'auto' (default): the search box appears automatically once the list is
  // long enough to need it (>= AUTO_SEARCH_MIN options — e.g. user lists),
  // and stays hidden for short lists like Priority / Status.
  // Pass searchable={true} or {false} to force either behaviour.
  const AUTO_SEARCH_MIN = 6;
  const isSearchable = searchable === 'auto' ? options.length >= AUTO_SEARCH_MIN : !!searchable;
  const [open,        setOpen]        = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [listPos,     setListPos]     = useState({ top: 0, left: 0, width: 0, openUp: false });

  // typeahead state for non-isSearchable dropdowns
  const typeaheadBuffer = useRef('');
  const typeaheadTimer  = useRef(null);

  const triggerRef = useRef(null);
  const listRef    = useRef(null);
  const searchRef  = useRef(null);

  // Filtered options when isSearchable
  const filteredOptions = isSearchable && searchQuery.trim()
    ? options.filter(o => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  // Calculate portal position relative to viewport each time we open
  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect       = triggerRef.current.getBoundingClientRect();
    const ROW_H      = 38;
    const searchBarH = isSearchable ? 44 : 0;
    const MARGIN     = 8;
    const HARD_CAP   = isSearchable ? 560 : 520; // ~13 rows before scrolling
    // Ideal height if nothing constrained us. +1 row accounts for the always-
    // rendered placeholder / "clear selection" row above the options, so the
    // last real option is never clipped. An empty list still renders one row
    // ("No options available" / "No results for …"), so it counts as 1 — without
    // this the menu is sized for the placeholder alone and the empty-state row
    // is clipped behind a scrollbar.
    const rowCount   = Math.max(filteredOptions.length, 1) + 1;
    const desired    = Math.min(rowCount * ROW_H + 8 + searchBarH, HARD_CAP);
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    // Open downward unless there is clearly more room above. Open toward the
    // larger gap and cap the list to whatever space that direction actually has,
    // so the last item is always reachable by scrolling instead of being clipped.
    const openUp     = spaceBelow < desired && spaceAbove > spaceBelow;
    const avail      = openUp ? spaceAbove : spaceBelow;
    // Never exceed the available space (keeps it on-screen); the now-visible
    // scrollbar signals there is more when the full list doesn't fit.
    const listHeight = Math.min(desired, avail);

    // ── Horizontal placement (responsive) ─────────────────────────────────
    // Searchable lists want to be wider than a narrow trigger; others match the
    // trigger. In every case clamp the width and left offset to the viewport so
    // the menu is never pushed off the left/right edge — a searchable list on a
    // left-aligned trigger used to expand off-screen and clip its labels.
    const viewportW = window.innerWidth;
    const width      = Math.min(
      isSearchable ? Math.max(rect.width, 420) : rect.width,
      viewportW - MARGIN * 2
    );
    // Searchable: align the list's right edge with the trigger and grow left;
    // otherwise align left edges. Then clamp so it stays fully on-screen.
    let left = isSearchable ? rect.right - width : rect.left;
    left = Math.max(MARGIN, Math.min(left, viewportW - width - MARGIN));

    const next = {
      left,
      width,
      openUp,
      maxHeight: listHeight,
      top:    openUp ? rect.top - listHeight - 4 : rect.bottom + 4,
    };
    // Skip the update when nothing actually moved. A scroll/resize listener
    // firing dozens of times during one gesture is normal, but re-rendering
    // (and so re-applying the list's inline style) on every one of those
    // ticks when the trigger hasn't moved is not — see the effect above for
    // why re-applying that style mid-scroll matters.
    setListPos(prev => (
      prev.left === next.left && prev.width === next.width && prev.openUp === next.openUp &&
      prev.maxHeight === next.maxHeight && prev.top === next.top
    ) ? prev : next);
  }, [filteredOptions.length, isSearchable]);

  const handleOpen = () => {
    if (disabled) return;
    if (!open) {
      calcPosition();
      setSearchQuery('');
    }
    setOpen(o => !o);
  };

  // Focus search input when dropdown opens (isSearchable only)
  useEffect(() => {
    if (open && isSearchable && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, isSearchable]);

  // Recalculate on scroll / resize while open. Scroll events don't bubble,
  // but a capturing window listener still fires for them regardless of
  // origin — including the portal list's own internal scroll (it's
  // overflowY: auto). Without the contains() check below, every wheel/
  // trackpad tick inside the list re-ran calcPosition() and re-applied the
  // <ul>'s inline style (maxHeight/overflowY) to the very element being
  // scrolled, which interrupted the browser's native scroll: the scrollbar
  // would appear on open but scrolling itself did nothing.
  useEffect(() => {
    if (!open) return;
    const update = (e) => {
      if (listRef.current?.contains(e.target)) return;
      calcPosition();
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update, true);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update, true);
    };
  }, [open, calcPosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const clickedTrigger = triggerRef.current?.contains(e.target);
      const clickedList    = listRef.current?.contains(e.target);
      if (!clickedTrigger && !clickedList) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Cleanup typeahead timer on unmount
  useEffect(() => () => clearTimeout(typeaheadTimer.current), []);

  const selectedLabel = options.find(o => String(o.value) === String(value))?.label;

  const handleSelect = (optValue) => {
    onChange(optValue);
    setOpen(false);
    setSearchQuery('');
  };

  // ── Keyboard handler on the trigger div ──────────────────────────────────
  const handleTriggerKeyDown = (e) => {
    // Open / close
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpen();
      return;
    }

    if (disabled) return;

    // Printable character typed while trigger is focused
    const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!isPrintable) return;

    if (isSearchable) {
      // Searchable dropdown: open it and seed the search with the typed char
      e.preventDefault();
      if (!open) {
        calcPosition();
        setSearchQuery(e.key);
        setOpen(true);
        // After open, focus search and place cursor at end
        setTimeout(() => {
          if (searchRef.current) {
            searchRef.current.focus();
            // value already set via setSearchQuery; move cursor to end
            const len = searchRef.current.value.length;
            searchRef.current.setSelectionRange(len, len);
          }
        }, 60);
      } else {
        // Already open — append to search and keep search focused
        setSearchQuery(prev => prev + e.key);
        searchRef.current?.focus();
      }
    } else {
      // Non-isSearchable dropdown: native-select-style typeahead
      e.preventDefault();
      clearTimeout(typeaheadTimer.current);
      typeaheadBuffer.current += e.key.toLowerCase();

      const match = options.find(o =>
        !o.disabled && o.label.toLowerCase().startsWith(typeaheadBuffer.current)
      );
      if (match) {
        onChange(match.value);
        // If dropdown is open, close it after selection
        if (open) setOpen(false);
      }

      // Reset buffer after 800 ms of no typing
      typeaheadTimer.current = setTimeout(() => {
        typeaheadBuffer.current = '';
      }, 800);
    }
  };

  const triggerClass = [
    'filter-trigger',
    open     ? 'filter-trigger--open'      : '',
    value    ? 'filter-trigger--has-value' : '',
    disabled ? 'filter-trigger--disabled'  : '',
  ].filter(Boolean).join(' ');

  // Portal list — fixed to viewport, never clipped by overflow ancestors
  const portalList = open && ReactDOM.createPortal(
    <ul
      ref={listRef}
      className="filter-dropdown-list"
      style={{
        position:  'fixed',
        top:       listPos.top,
        left:      listPos.left,
        width:     listPos.width,
        zIndex:    99999,
        maxHeight: listPos.maxHeight ? `${listPos.maxHeight}px` : undefined,
        overflowY: 'auto',
        animation: listPos.openUp ? 'dropdown-up 0.12s ease' : 'dropdown-in 0.12s ease',
      }}
      role="listbox"
    >
      {/* Search input — shown only when isSearchable prop is true */}
      {isSearchable && (
        <li className="filter-dropdown-search-wrapper" role="none">
          <div className="filter-dropdown-search-inner">
            <svg className="filter-dropdown-search-icon" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="filter-dropdown-search-input"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); calcPosition(); }}
              onMouseDown={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            />
            {searchQuery && (
              <button
                className="filter-dropdown-search-clear"
                onMouseDown={e => { e.preventDefault(); setSearchQuery(''); searchRef.current?.focus(); }}
                tabIndex={-1}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </li>
      )}

      {/* Placeholder / clear row */}
      <li
        className={`filter-dropdown-item filter-dropdown-item--placeholder${!value ? ' filter-dropdown-item--placeholder-active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); handleSelect(''); }}
        role="option"
        aria-selected={!value}
      >
        {value ? `— Clear selection —` : placeholder}
      </li>

      {filteredOptions.map(opt => {
        const isSelected = String(opt.value) === String(value);
        // Options may opt in to being disabled via { disabled: true, disabledReason }.
        // Purely additive — callers that don't set it are unaffected.
        const isDisabled = !!opt.disabled;
        return (
          <li
            key={opt.value}
            className={`filter-dropdown-item${isSelected ? ' filter-dropdown-item--selected' : ''}${isDisabled ? ' filter-dropdown-item--disabled' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); if (!isDisabled) handleSelect(opt.value); }}
            role="option"
            aria-selected={isSelected}
            aria-disabled={isDisabled || undefined}
            title={isDisabled ? (opt.disabledReason || undefined) : undefined}
          >
            {opt.label}
          </li>
        );
      })}

      {filteredOptions.length === 0 && (
        <li className="filter-dropdown-item" style={{ color: '#94a3b8', fontStyle: 'italic', cursor: 'default' }}>
          {searchQuery ? `No results for "${searchQuery}"` : 'No options available'}
        </li>
      )}
    </ul>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ position: 'relative' }} id={id}>
      {/* Trigger */}
      <div
        className={triggerClass}
        onClick={handleOpen}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`filter-trigger__text${!value ? ' filter-trigger__text--placeholder' : ''}`}>
          {selectedLabel || placeholder}
        </span>
        <span className="filter-trigger__chevron">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {portalList}
    </div>
  );
};

export default FilterSelect;