// src/components/borrowers/SanctionFormModal.js
//
// One form, three ways in:
//   mode="import" — pre-filled from a parsed letter, low-confidence fields
//                   flagged, document preview beside it
//   mode="create" — opened blank for a borrower with no letter yet
//   mode="edit"   — opened on a saved sanction
//
// Keeping them in one component is deliberate: an imported record must stay as
// editable as a typed one, and two forms would drift apart the first time a
// field is added.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, AlertTriangle, FileText, Paperclip, Calendar, Plus, Trash2 } from 'lucide-react';
import { BsInfoCircle } from 'react-icons/bs';
import borrowerApi from '../../services/borrowerApi';
import { useAuth } from '../../hooks/useAuth';
import CrmPreloader from '../preLoader';
import {
  deriveSanction, deriveRepaymentSchedule, parseDate, parsePct, parseMoneyCrore, formatCrore,
  parseMoratoriumMonths, resolveRepaymentWindow, formatDate,
} from './sanctionDerive';
import SanctionCompareModal from './SanctionCompareModal';
import RepaymentScheduleTab from './RepaymentScheduleTab';
import TechnologyGroupDropdowns from './TechnologyGroupDropdowns';
import { SANCTION_FIELDS as FIELDS, sanctionFieldGroups, FACILITY_TYPE_OPTIONS } from './sanctionFields';
import { BORROWER_IMPORT_KEYS, CIN_REGEX } from './borrowerFields';
import { resolveHierarchyGroupId } from './HierarchyPicker';
import { useSectionNav } from './useSectionNav';
import { statusLabel, sourceLabel } from './SanctionOverviewPanel';
import '../../pages-css/BorrowerRegistry.css';
import '../../pages-css/SanctionRedesign.css';

// `terms` (Sanction Terms — Product section) isn't a flat SANCTION_FIELDS
// scalar, so it's not part of the FIELDS-driven reduce below; added here so
// every fresh form (and every reset back to EMPTY) still starts with a real
// array, never undefined. `disbursementDate`/`tentativeDisbursementDate`
// are ALSO no longer FIELDS scalars (removed from sanctionFields.js — see
// its own comment) but every other piece of this form still reads them by
// exactly these names (deriveSanction, resolveRepaymentWindow, the "Updates
// as you type" panel, the payload sent to save) — kept here as plain form
// keys, synced from Term 1 by an effect rather than typed into directly.
const EMPTY = {
  ...FIELDS.reduce((a, f) => ({ ...a, [f.key]: f.defaultValue ?? '' }), {}),
  terms: [], disbursementDate: '', tentativeDisbursementDate: '',
};
const GROUPS = sanctionFieldGroups();
// The section-nav order the redesign requires — three sections (Sanction
// Terms, Derived Values, Status) have no scalar SANCTION_FIELDS entries of
// their own (terms is its own array/SanctionTermsCard; Derived Values is
// computed by deriveSanction; Status is the sanction's status/source), so
// they're spliced in here rather than living in sanctionFields.js.
const NAV_ORDER = [
  'Number', 'Borrower Details', 'Project Details', 'Project Cost & Finance',
  'Product', 'Sanction Terms', 'Interest & Repayment', 'Important Dates',
  'Conditions & Covenants', 'Derived Values', 'Status', 'Additional Information',
];
const NAV_SECTIONS = (() => {
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g.group, g]));
  return NAV_ORDER.map((group, i) => ({
    id: `sr-sec-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
    num: String(i + 1).padStart(2, '0'),
    group,
    fields: byGroup[group]?.fields || null,
  }));
})();
const NAV_SECTION_IDS = NAV_SECTIONS.map((s) => s.id);
const FIELD_KIND = Object.fromEntries(FIELDS.map((f) => [f.key, f.kind]));
// Only fields that declare one — same convention as sanctionFields.js
// documents for `normalize`, applied uniformly wherever a value is typed
// into `form` (the initial-load effects reuse this too, so a value read off
// a letter is shaped identically to one typed by hand).
const FIELD_NORMALIZE = Object.fromEntries(
  FIELDS.filter((f) => f.normalize).map((f) => [f.key, f.normalize]),
);

// A letter often states the moratorium only inline in the Tenor sentence
// ("18 years including moratorium of 9 months") rather than as its own row —
// the repayment schedule already reads that count via parseMoratoriumMonths
// (see resolveRepaymentWindow in sanctionDerive.js), but leaving the
// Moratorium (Months) field blank hid the number the schedule was actually
// using. Surface it into the field itself once, still fully editable —
// this doesn't change what gets calculated, since the derivation already
// fell back to the same parse when the field was empty.
const withDerivedMoratorium = (next) => {
  if (String(next.moratoriumMonths || '').trim()) return next;
  const derived = parseMoratoriumMonths(next.tenorText);
  return derived != null ? { ...next, moratoriumMonths: String(derived) } : next;
};

/**
 * Sanction Terms must always start with Term 1 — never an empty table, on
 * a brand-new sanction as much as one already saved. Only runs while
 * `terms` is genuinely empty (never touches an already-loaded Term 1, so a
 * reviewer's own edit is never overwritten).
 *
 * For a sanction saved before Sanction Terms existed, `legacyTentative`/
 * `legacyActual` are that OLD record's own top-level Tentative/Actual Disb.
 * Date values (read once, straight off `initial`, since the FIELDS-driven
 * copy in the caller no longer populates `next.disbursementDate`/
 * `next.tentativeDisbursementDate` — those keys are reserved for the
 * Term-1-synced mirror kept for deriveSanction/resolveRepaymentWindow/the
 * backend's own validateSanction, not for this seed to read back from) —
 * Term 1 inherits them, so the existing repayment schedule keeps computing
 * exactly as it did before this change. On a genuinely new sanction both
 * are blank, and Term 1 simply starts blank too, same as every other term
 * a reviewer adds by hand.
 */
const withDerivedTerm1 = (next, legacyTentative, legacyActual, legacyRepaymentProfileJson) => {
  if (next.terms && next.terms.length) return next;
  return {
    ...next,
    terms: [{
      termLimit: next.limitAmount || '',
      facilityType: next.instrument || '',
      tentativeDisbursementDate: toIsoDate(legacyTentative) || toIsoDate(legacyActual) || '',
      actualDisbursementDate: toIsoDate(legacyActual) || '',
      // A sanction saved before Sanction Terms existed kept its edited
      // repayment percentages at the sanction level — Term 1 inherits that
      // same profile so its (now per-term) schedule keeps showing exactly
      // what was already saved, not a reset-to-default equal split.
      repaymentProfileJson: legacyRepaymentProfileJson || '',
    }],
  };
};

// Limit (Product section) starts at whatever Debt Amount already holds
// (falling back to Sanctioned Amount, matching deriveSanction's own
// "one lender, one facility" fallback) — same one-time gap-fill shape as
// the two helpers above, and the field's own hint text says exactly this.
const withDerivedLimit = (next) => {
  if (String(next.limitAmount || '').trim()) return next;
  const seed = next.debtAmount || next.sanctionedAmount;
  return seed ? { ...next, limitAmount: seed } : next;
};

/**
 * Rebuilds every Sanction Term's amount as an equal split of `limitAmount`
 * (a plain ₹-Cr number, same crore-scale text every money field on this form
 * already stores — see stripRs/withRs above) across `count` terms, last term
 * absorbing the rounding remainder — same "acknowledge every prior figure's
 * rounding" shape as defaultRepaymentPercents in sanctionDerive.js, just for
 * money instead of percentages. Only ever called from "+ Add Term"; editing
 * a term by hand afterward never re-triggers this.
 */
const equalSplitTermLimits = (limitAmount, count) => {
  const total = parseFloat(String(limitAmount ?? '').replace(/,/g, ''));
  if (!Number.isFinite(total) || count <= 0) return Array(Math.max(count, 0)).fill('');
  const share = Math.floor((total / count) * 100) / 100;
  const amounts = Array(count).fill(share);
  amounts[count - 1] = Math.round((total - share * (count - 1)) * 100) / 100;
  return amounts.map((cr) => cr.toFixed(2));
};

// A letter's date arrives as "14 Mar 2025" (or "14/03/2025", or already ISO);
// the picker below only understands ISO "yyyy-MM-dd". `parseDate` already
// reads all of those, so this just re-renders whichever one comes in as ISO.
// The reverse trip doesn't need a matching `fromIso` — the picker hands back
// ISO directly, and SanctionValueParser.parseDate on the backend accepts ISO
// as one of its recognised formats already.
const toIsoDate = (raw) => {
  const d = parseDate(raw);
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const CAL_WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Calendar-only date picker — the same one already used on the Purchase
 * Order pages (there as `PODatePicker`), copied rather than imported since
 * every page that uses it keeps its own copy (see GeneratePoModal.js,
 * VendorPaymentsPage.js, etc.). value/onChange are ISO "yyyy-MM-dd" strings;
 * the trigger displays dd-mm-yyyy.
 */
const SanctionDatePicker = ({ value, onChange, placeholder = 'Select date', warn = false, minDate = '', maxDate = '' }) => {
  const [show, setShow] = useState(false);
  const [calMo, setCalMo] = useState(() => (value ? parseInt(value.slice(5, 7), 10) - 1 : new Date().getMonth()));
  const [calYr, setCalYr] = useState(() => (value ? parseInt(value.slice(0, 4), 10) : new Date().getFullYear()));
  const [showYrPicker, setShowYrPicker] = useState(false);
  const wrapRef = useRef(null);
  const dropRef = useRef(null);
  // The dropdown itself renders through a portal (see below) — positioned
  // in viewport coordinates, computed from the trigger's own rect, rather
  // than a plain `position: absolute` child of wrapRef. Every other place
  // this picker is used sits inside a plain, non-scrolling fieldset (already
  // carved out with `overflow: visible`, see that CSS rule's own comment),
  // but the Sanction Terms table's Tentative/Actual Disb. Date columns sit
  // inside .br-table-wrap, which is deliberately overflow-x: auto for its
  // own horizontal scrollbar — an absolutely-positioned child of a cell in
  // there gets silently clipped the moment the calendar grid would extend
  // past that scroll box. A portal to document.body has no such ancestor.
  const [dropPos, setDropPos] = useState(null);

  const reposition = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) });
  };

  useEffect(() => {
    const onOutside = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setShow(false);
    };
    if (show) {
      document.addEventListener('mousedown', onOutside);
      // Capture phase: catches scroll on ANY ancestor (the table wrap, the
      // modal body, the window itself), not only window-level scrolling.
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
    }
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const open = () => {
    if (value) { setCalMo(parseInt(value.slice(5, 7), 10) - 1); setCalYr(parseInt(value.slice(0, 4), 10)); }
    setShowYrPicker(false);
    reposition();
    setShow(true);
  };

  const daysInMonth = new Date(calYr, calMo + 1, 0).getDate();
  const firstWeekday = new Date(calYr, calMo, 1).getDay();
  const displayFmt = (iso) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };

  return (
    // This whole widget sits inside a bare `<label>` (no htmlFor) in the form
    // grid. With no explicit target, a browser forwards any click inside the
    // label to the first focusable control it contains — the trigger button
    // below — as a second, synthetic click right after the real one. Picking
    // a day already closes the calendar via its own onClick, but that forwarded
    // click lands on the trigger a moment later and, since `show` just flipped
    // to false, reopens it. preventDefault() on the real click is what the
    // label checks before forwarding, so stopping it here (once, for every
    // click this widget receives) is enough — no need to repeat it on each
    // button/cell inside.
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }} onClick={(e) => e.preventDefault()}>
      <button
        type="button"
        className={`po-dtp-trigger${show ? ' po-dtp--open' : ''}${value ? ' po-dtp--set' : ''}`}
        onClick={show ? () => setShow(false) : open}
        style={warn ? { borderColor: 'var(--c-f59e0b, #f59e0b)' } : undefined}
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {value
          ? <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{displayFmt(value)}</span>
          : <span className="po-dtp-ph">{placeholder}</span>}
        {value ? (
          <span className="po-dtp-x" onClick={(e) => { e.stopPropagation(); onChange(''); }}>
            <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        ) : (
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            style={{ marginLeft: 'auto', transform: show ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {show && dropPos && createPortal(
        <div
          ref={dropRef} className="po-dtp-dropdown"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: 280, zIndex: 2000 }}
        >
          <div className="po-dtp-cal-head">
            <button type="button" className="po-cal-nav"
              onClick={() => { if (calMo === 0) { setCalMo(11); setCalYr((y) => y - 1); } else setCalMo((m) => m - 1); }}>
              <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button type="button" className="po-dtp-month" onClick={() => setShowYrPicker((p) => !p)}>
              {CAL_MONTHS[calMo]} <span className="po-cal-yr-num">{calYr}</span>
            </button>
            <button type="button" className="po-cal-nav"
              onClick={() => { if (calMo === 11) { setCalMo(0); setCalYr((y) => y + 1); } else setCalMo((m) => m + 1); }}>
              <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {showYrPicker ? (
            <div className="po-yr-grid">
              {Array.from({ length: 16 }, (_, i) => {
                const yr = new Date().getFullYear() - 4 + i;
                return (
                  <div key={yr} className={`po-yr-cell${yr === calYr ? ' po-yr-sel' : ''}`}
                    onClick={() => { setCalYr(yr); setShowYrPicker(false); }}>
                    {yr}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="po-dtp-grid">
              {CAL_WEEKDAYS.map((d) => <div key={d} className="po-cal-dl">{d}</div>)}
              {Array.from({ length: firstWeekday }).map((_, i) => <div key={`e${i}`} className="po-cal-cell po-cal-empty" />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const iso = `${calYr}-${String(calMo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const disabled = (minDate && iso < minDate) || (maxDate && iso > maxDate);
                return (
                  <div key={day}
                    className={`po-cal-cell${value === iso ? ' po-dtp-sel' : ''}${disabled ? ' po-cal-cell-disabled' : ''}`}
                    onClick={disabled ? undefined : () => { setShow(false); onChange(iso); }}>
                    {day}
                  </div>
                );
              })}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

// Money fields get a fixed "Rs." shown beside the input rather than typed
// into it — a letter parsed as "Rs. 372.00 Crore" and a user typing "372.00"
// should look the same, not one with the unit baked in and one without.
//
// "Crore" also gets shortened to "Cr" here — once a sanction is saved, every
// page shows it that way regardless (the amount is stored as a plain number
// and always re-rendered via formatCrore/SanctionValueParser.formatCrore,
// which only ever prints "Cr"); a letter parsed as "...Crore" shouldn't look
// different from that on this screen, before it's even been saved once.
const RS_PREFIX = /^\s*(rs\.?|inr|₹)\s*/i;
const CRORE_WORD = /\bcrores?\b/i;
const stripRs = (v) => String(v ?? '').replace(RS_PREFIX, '').replace(CRORE_WORD, 'Cr');
const withRs = (v) => {
  const t = String(v ?? '').trim();
  return t ? `Rs. ${stripRs(t)}` : t;
};

// Project Cost & Means of Finance: a letter states these in crore or in
// rupees depending on the document, sometimes inconsistently between rows of
// the same table. Whichever way it came in, show it the same way the saved
// record eventually will — a single "X.XX Cr" figure — rather than leaving a
// full rupee count sitting next to a properly-scaled crore figure in the
// same review screen.
const MEANS_OF_FINANCE_KEYS = new Set(['projectCost', 'debtAmount', 'equityAmount', 'sanctionedAmount', 'limitAmount']);
// Only a bare figure (with an optional unit/₹-sign/trailing "/-") is safe to
// rescale — a cell that also carries free text ("(approx. Rs. 5.09 Crore/MW)")
// is left exactly as extracted, so that context isn't silently dropped from
// the review screen.
const CLEAN_AMOUNT_RE = /^-?[\d,]+(?:\.\d+)?\s*(?:crs?\.?|crores?|lakhs?|lacs?|l|lk)?\s*\/?-?$/i;
// A trailing "(Rupees ... only)" is just the same figure spelled out in
// words — a standard Indian banking convention, not new information — so
// it's safe to drop once the leading figure itself parses cleanly. A
// genuinely informative note like Project Cost's "(approx. Rs. 5.09
// Crore/MW)" doesn't start with "Rupees" and so is left alone, same as ever.
const TRAILING_SPELLED_OUT_RE = /^(.*?)\s*\(\s*rupees\b[^)]*\)\s*$/i;
const normalizeMoneyValue = (key, v) => {
  const stripped = stripRs(v);
  if (!MEANS_OF_FINANCE_KEYS.has(key)) return stripped;
  let trimmed = stripped.trim();
  if (!trimmed) return stripped;
  const spelledOut = trimmed.match(TRAILING_SPELLED_OUT_RE);
  if (spelledOut) trimmed = spelledOut[1].trim();
  if (!trimmed || !CLEAN_AMOUNT_RE.test(trimmed)) return stripped;
  const rupees = parseMoneyCrore(trimmed);
  if (rupees === null) return stripped;
  return stripRs(formatCrore(rupees));
};

// "Interest Terms" is the descriptive text sitting next to the (now
// separate, computed) Rate of Interest field — the percentage no longer
// needs to also live in this sentence, so the first one found is dropped,
// wherever in the sentence it falls. Only the first: a letter occasionally
// mentions a rate more than once ("not exceeding 12.00% p.a., presently
// 10.75%") and only the leading figure is the one Rate of Interest already
// shows.
const RATE_IN_TEXT = /\s*\(?-?\d+(?:\.\d+)?\s*%\)?\s*/;
const stripRoiFromText = (v) => String(v ?? '').replace(RATE_IN_TEXT, ' ').replace(/\s+/g, ' ').trim();

const numFrom = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

/**
 * Product section, "Sanction Terms" table — splits the Limit above across
 * one or more facility tranches. Purely a `terms` array in/out (the parent
 * owns the state, same "controlled" shape as every other field on this
 * form) — the two Save-blocking rules it enforces (sum = Limit, every
 * Actual Disb. Date before COD) are computed by the caller (sanctionTermsError
 * in SanctionFormModal) and simply displayed here as `error`.
 */
const SanctionTermsCard = ({ terms, limitAmount, onChange, minDate, maxDate }) => {
  const limit = numFrom(limitAmount);
  const total = terms.reduce((t, term) => t + numFrom(term.termLimit), 0);
  const remaining = limit - total;
  const balanced = terms.length > 0 && Math.abs(remaining) < 0.01;

  // The rules below used to sit as an always-visible banner under the
  // table; moved behind an (i) beside the title instead, same click-to-show
  // pattern already used for the modal's own "Why review this" hint, so
  // they're available without permanently taking up space.
  const [showHint, setShowHint] = useState(false);
  const hintRef = useRef(null);
  useEffect(() => {
    const onOutside = (e) => { if (hintRef.current && !hintRef.current.contains(e.target)) setShowHint(false); };
    if (showHint) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showHint]);

  const handleAdd = () => {
    const next = [...terms, {
      termLimit: '', facilityType: '', tentativeDisbursementDate: '', actualDisbursementDate: '',
      repaymentProfileJson: '',
    }];
    const amounts = equalSplitTermLimits(limitAmount, next.length);
    onChange(next.map((t, i) => ({ ...t, termLimit: amounts[i] })));
  };
  // Sanction Terms must always keep at least Term 1 (see withDerivedTerm1) —
  // deleting the only remaining row would leave no Actual Disb. Date for
  // the repayment schedule (or the backend's own required-field check) to
  // anchor on, so the last row's delete action is simply unavailable.
  // Removing a term also re-splits the Limit evenly across whatever's left,
  // same as Add — Term Limit is never a value a reviewer types, only ever
  // an equal share of the Limit (see the read-only cell below), so it can
  // never end up wrong or unbalanced after either action.
  const handleRemove = (idx) => {
    if (terms.length <= 1) return;
    const next = terms.filter((_, i) => i !== idx);
    const amounts = equalSplitTermLimits(limitAmount, next.length);
    onChange(next.map((t, i) => ({ ...t, termLimit: amounts[i] })));
  };
  const updateTerm = (idx, patch) => onChange(terms.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  // Picking a term's Tentative Disb. Date while its OWN Actual Disb. Date is
  // still blank also seeds Actual with that same date — same rule the
  // sanction-level Tentative/Actual pair used to apply, now per term (see
  // withDerivedTerm1's own comment on where that pair moved to).
  const setTentative = (idx) => (iso) => updateTerm(
    idx, terms[idx]?.actualDisbursementDate ? { tentativeDisbursementDate: iso } : { tentativeDisbursementDate: iso, actualDisbursementDate: iso },
  );

  return (
    <div className="br-terms-card">
      <div className="br-terms-head">
        <div>
          <span className="br-terms-title-row">
            <h4 className="br-terms-title">Sanction Terms</h4>
            <span className="br-info-wrap" ref={hintRef}>
              <button
                type="button"
                className="br-info-btn"
                onClick={() => setShowHint((v) => !v)}
                aria-label="Sanction Terms rules"
                aria-expanded={showHint}
              >
                <BsInfoCircle size={14} aria-hidden="true" />
              </button>
              {showHint && (
                <div className="br-info-popover br-info-popover-wide" role="tooltip">
                  <ul className="br-terms-info-list">
                    <li>Term Limit is always an equal share of the Limit above, split across every term — adding or removing a term re-splits it automatically. It isn't a typed value, so no term can end up bigger or smaller than its equal allocation.</li>
                    <li>The sum of all term limits must be equal to the overall limit (100%).</li>
                    <li>Disbursement for all terms must be completed on or before the day before the COD date
                      (e.g., if COD is 01-02-2027, latest disbursement date is 31-01-2027).</li>
                    <li>Each term will have its own repayment schedule, generated based on the Actual Disb. Date.</li>
                  </ul>
                </div>
              )}
            </span>
          </span>
        </div>
        <button type="button" className="br-btn br-btn-primary br-btn-sm" onClick={handleAdd}>
          <Plus size={14} aria-hidden="true" /> Add Term
        </button>
      </div>

      {terms.length > 0 && (
        <div className="br-table-wrap br-scroll-body">
          <table className="br-table-list br-terms-table">
            <thead>
              <tr>
                <th className="br-center">#</th>
                <th className="br-right">Term Limit (₹ Cr)</th>
                <th>Facility Type <span className="br-req" aria-hidden="true">*</span></th>
                <th className="br-right">% of Limit</th>
                <th className="br-center">Tentative Disb. Date <span className="br-req" aria-hidden="true">*</span></th>
                <th className="br-center">Actual Disb. Date <span className="br-req" aria-hidden="true">*</span></th>
                <th className="br-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {terms.map((term, i) => {
                const pct = limit > 0 ? (numFrom(term.termLimit) / limit) * 100 : 0;
                return (
                  <tr key={i}>
                    <td className="br-center">{i + 1}</td>
                    <td className="br-right">
                      {/* Term Limit is computed (equalSplitTermLimits), never
                          typed — see handleAdd/handleRemove and the Limit-sync
                          effect above the table's parent. */}
                      <div className="br-input-group">
                        <span className="br-input-prefix" aria-hidden="true">Rs.</span>
                        <input type="text" className="br-input br-input-readonly" readOnly value={term.termLimit} />
                      </div>
                    </td>
                    <td>
                      <select
                        className="br-input" value={term.facilityType || ''}
                        onChange={(e) => updateTerm(i, { facilityType: e.target.value })}
                      >
                        {FACILITY_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="br-right">
                      <input type="text" className="br-input br-input-readonly" readOnly value={`${pct.toFixed(2)}%`} />
                    </td>
                    <td>
                      <SanctionDatePicker
                        value={toIsoDate(term.tentativeDisbursementDate)}
                        onChange={setTentative(i)}
                      />
                    </td>
                    <td>
                      <SanctionDatePicker
                        value={toIsoDate(term.actualDisbursementDate)}
                        onChange={(iso) => updateTerm(i, { actualDisbursementDate: iso })}
                        minDate={minDate}
                        maxDate={maxDate}
                      />
                    </td>
                    <td className="br-center">
                      <button
                        type="button" className="br-icon-btn br-terms-delete"
                        onClick={() => handleRemove(i)} aria-label={`Delete term ${i + 1}`}
                        disabled={terms.length <= 1}
                        title={terms.length <= 1 ? 'At least one term is required' : undefined}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {terms.length > 0 && (
        <div className="br-terms-summary">
          <div className="br-terms-summary-tile">
            <span className="br-terms-summary-label">Total Term Limit</span>
            <span className="br-terms-summary-value">Rs. {total.toFixed(2)} Cr</span>
          </div>
          <div className="br-terms-summary-tile">
            <span className="br-terms-summary-label">Total Percentage</span>
            <span className={`br-terms-summary-value ${balanced ? 'br-tone-ok' : 'br-tone-warn'}`}>
              {(limit > 0 ? (total / limit) * 100 : 0).toFixed(2)}%
            </span>
          </div>
          <div className="br-terms-summary-tile">
            <span className="br-terms-summary-label">Overall Limit</span>
            <span className="br-terms-summary-value">Rs. {limit.toFixed(2)} Cr</span>
          </div>
          <div className="br-terms-summary-tile">
            <span className="br-terms-summary-label">Remaining Limit</span>
            <span className={`br-terms-summary-value ${balanced ? 'br-tone-ok' : 'br-tone-warn'}`}>
              Rs. {remaining.toFixed(2)} Cr
            </span>
          </div>
        </div>
      )}

    </div>
  );
};

const SanctionFormModal = ({
  mode = 'create',
  initial = null,        // parsed field map (import) or saved wrapper (edit)
  borrowerId = null,     // set when adding a sanction to a known, already-existing borrower
  borrowerName = null,   // pre-fills the borrower field for a known borrower
  // Set when this sanction is associated directly with a known, already-
  // existing Parent Group or Sub Group instead of any company — { groupId,
  // groupName, type: 'GROUP' | 'SUB_GROUP' }. Mutually exclusive with
  // borrowerId/borrowerName: no company is resolved or created, and the
  // save goes to borrowerApi.saveGroupSanction instead.
  groupTarget = null,
  // Set instead of borrowerId/groupTarget when NEITHER exists yet —
  // CompanyMatchModal's "Confirm and continue" no longer resolves/creates
  // anything itself (see its own handleConfirm comment); it hands the
  // reviewer's raw choice through here as one of:
  //   { kind: 'MATCH',   identity }                       — an existing company, matched
  //   { kind: 'COMPANY', identity, hierarchy }             — a new (or by-name-matched) company, +/- a group
  //   { kind: 'GROUP',   hierarchy, groupName, type }      — the Parent/Sub Group itself is the target
  // Save is the ONLY place any of this is written — see handleSave below —
  // so cancelling this screen for a `pending` sanction leaves nothing
  // behind at all; there is nothing for handleCancel to clean up.
  pending = null,
  file = null,           // the uploaded File, for preview and post-save storage
  allowAttach = false,   // offer to attach a letter while entering by hand
  onClose,
  onSaved,
}) => {
  const { pagePermissions } = useAuth();
  const showDsra = !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS');
  const showIsra = !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS');
  const [form, setForm] = useState({ ...EMPTY });
  // The letter's own stated ROI (if any), captured once when the form is
  // (re)populated from an outside source — never the live form.roiPct, which
  // the sync effect below keeps overwriting with the resolved figure. Reading
  // the live value back into deriveSanction would create a loop where a real
  // letter-vs-buildup mismatch gets silently erased the render after it's
  // first detected, because by then form.roiPct already agrees with itself.
  const [statedRoiPct, setStatedRoiPct] = useState('');
  // The last value the sync effect below itself wrote into dsraAmount/
  // israAmount/actualCod — not what the reviewer typed. Distinguishes "still
  // showing what we auto-filled, safe to refresh as ROI/other inputs
  // change" from "the reviewer typed/picked their own value over it, leave
  // it alone" — the same distinction a plain "only fill while empty" check
  // can't make once the box already has *something* in it, auto-filled or
  // not.
  const autoDsraRef = useRef(null);
  const autoIsraRef = useRef(null);
  const autoActualCodRef = useRef(null);
  const autoRepaymentStartRef = useRef(null);
  const autoRepaymentEndRef = useRef(null);
  const autoScheduledCodRef = useRef(null);
  const [saving, setSaving] = useState(false);
  // A validation error (e.g. "Still needed: Disb. Date") stays visible until
  // the reviewer fixes it and saves again — handleSave clears it at the top
  // of every attempt. It used to auto-dismiss after 3 seconds, which on a
  // field a letter simply doesn't state (Disbursement Date is the common
  // case) made Save look like it silently did nothing: the banner had
  // already vanished by the time anyone read it, leaving the same blank
  // form with no visible reason Save wasn't going through.
  const [error, setError] = useState('');
  // A Sanction Terms validation failure (Term 1's Actual Disb. Date missing,
  // terms not summing to the Limit, a COD violation) is only shown at the
  // moment Save is actually clicked — not as a persistent banner the reviewer
  // sees by default while still filling the form in — via this brief,
  // center-of-screen, self-dismissing toast rather than the ordinary `error`
  // banner. See centerToastMessage below and its own portal render.
  const [centerToast, setCenterToast] = useState('');
  useEffect(() => {
    if (!centerToast) return undefined;
    const t = setTimeout(() => setCenterToast(''), 3000);
    return () => clearTimeout(t);
  }, [centerToast]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [attached, setAttached] = useState(null);   // File chosen in this form
  const [reading, setReading] = useState(false);
  const [compare, setCompare] = useState(null);     // { parsed, file }
  const attachRef = useRef(null);
  // The import-mode reminder ("Check every value...") used to sit as a
  // permanent line under the header; it's now click-to-reveal off the info
  // icon next to the title instead, so it stops competing with the title
  // for attention on every review.
  const [showReviewHint, setShowReviewHint] = useState(false);
  const reviewHintRef = useRef(null);
  // Which tab the modal shows, and the id of the sanction this session has
  // actually saved (if any) — a saved sanction (edit mode, or the first Save
  // in create/import mode) gets the tab strip; before that there's nothing
  // to show a Repayment Schedule for yet.
  const [activeTab, setActiveTab] = useState('details');
  // The Sanction Details tab's scrollable body — root for the section-nav's
  // scroll-spy (useSectionNav), and the target of each nav link's
  // scrollIntoView jump.
  const sectionBodyRef = useRef(null);
  const { activeId: activeSectionId, setSectionRef, jumpTo: jumpToSection } = useSectionNav(
    NAV_SECTION_IDS, { rootRef: sectionBodyRef },
  );
  // Which Sanction Term's own repayment schedule the Repayment Schedule tab
  // shows — one at a time, picked from a dropdown, rather than every term's
  // schedule stacked one below the other.
  const [selectedTermIndex, setSelectedTermIndex] = useState(0);
  const [savedSanctionId, setSavedSanctionId] = useState(initial?.id || null);

  useEffect(() => {
    const onOutside = (e) => {
      if (reviewHintRef.current && !reviewHintRef.current.contains(e.target)) setShowReviewHint(false);
    };
    if (showReviewHint) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showReviewHint]);

  // The letter to store on save: the one passed in (import) or picked here.
  const documentFile = file || attached;

  // True whether the group target is already known (groupTarget prop) or
  // still deferred to Save (pending.kind === 'GROUP') — every place that
  // used to check `groupTarget` alone for "no company is involved here"
  // needs to react the same way before that group actually exists yet.
  const isGroupTarget = !!groupTarget || pending?.kind === 'GROUP';
  const displayGroupName = groupTarget?.groupName || pending?.groupName || '';
  const displayGroupType = groupTarget?.type || pending?.type || 'GROUP';

  const lowConfidence = useMemo(
    () => new Set(initial?._lowConfidenceFields || []),
    [initial],
  );
  const duplicateRef = Boolean(initial?._duplicateRefNo);
  const engine = initial?._extractionEngine;
  const interestMoratoriumDefaulted = Boolean(initial?._interestMoratoriumDefaulted);

  useEffect(() => {
    if (!initial) return;
    const next = { ...EMPTY };
    FIELDS.forEach(({ key, kind }) => {
      if (initial[key] !== undefined && initial[key] !== null) {
        const v = String(initial[key]);
        next[key] = kind === 'money' ? normalizeMoneyValue(key, v)
          : key === 'interestRateText' ? stripRoiFromText(v)
          : FIELD_NORMALIZE[key] ? FIELD_NORMALIZE[key](v) : v;
      }
    });
    setStatedRoiPct(initial.roiPct != null ? String(initial.roiPct) : '');
    // Not a flat FIELDS scalar (see the EMPTY comment above), so the
    // FIELDS.forEach loop above never copies it — only a genuinely saved
    // sanction (edit mode, or reopening after this session's own earlier
    // save) has any; a freshly parsed letter never states Terms itself
    // (extraction is unchanged — this is a reviewer-only construct), so
    // `initial.terms` is simply absent there and this defaults to [].
    // termLimit arrives from the backend as SanctionValueParser.formatCrore's
    // own output ("₹135.02 Cr") — stripped here the same way every other
    // money field already is (normalizeMoneyValue/stripRs above), so it
    // reads as a plain "135.02" in the input, same shape numFrom/handleSave's
    // own withRs expect. Left un-stripped, the leading "₹" made every
    // numFrom() parse of a reloaded term's amount come back NaN → 0 — the
    // Total Term Limit / % of Limit / Total Percentage tiles all silently
    // read 0.00 despite real values sitting in every row.
    next.terms = Array.isArray(initial.terms)
      ? initial.terms.map((t) => ({ ...t, termLimit: stripRs(t.termLimit) }))
      : [];
    // A freshly (re)loaded record's dsraAmount/israAmount/actualCod are the
    // letter's own printed figures (or a previous session's override) — not
    // something this effect just wrote — so the resync above must treat
    // them as a reviewer-owned value until it writes one itself again.
    autoDsraRef.current = null;
    autoIsraRef.current = null;
    autoActualCodRef.current = null;
    autoRepaymentStartRef.current = null;
    autoRepaymentEndRef.current = null;
    autoScheduledCodRef.current = null;
    setForm(withDerivedTerm1(
      withDerivedLimit(withDerivedMoratorium(next)),
      initial.tentativeDisbursementDate, initial.disbursementDate, initial.repaymentProfileJson,
    ));
  }, [initial]);

  // Adding a sanction to a borrower we already know — no reason to make the
  // user retype the company name.
  useEffect(() => {
    if (borrowerName) setForm((f) => (f.borrowerName ? f : { ...f, borrowerName }));
  }, [borrowerName]);

  /**
   * A letter attached while entering values by hand. Read it and, if anything
   * has already been typed, compare rather than overwrite — the typed value
   * may be the deliberate one. On an empty form there is nothing to disagree
   * with, so the parsed values simply fill it.
   */
  const handleAttach = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;

    setAttached(picked);
    setError('');
    setReading(true);
    try {
      const parsed = await borrowerApi.parseSanction(picked);
      const hasTypedValues = FIELDS.some(({ key }) => String(form[key] || '').trim());
      if (!hasTypedValues) {
        const next = { ...EMPTY };
        FIELDS.forEach(({ key, kind }) => {
          if (parsed[key] != null) {
            const v = String(parsed[key]);
            next[key] = kind === 'money' ? normalizeMoneyValue(key, v)
              : key === 'interestRateText' ? stripRoiFromText(v)
              : FIELD_NORMALIZE[key] ? FIELD_NORMALIZE[key](v) : v;
          }
        });
        setStatedRoiPct(parsed.roiPct != null ? String(parsed.roiPct) : '');
        setForm(withDerivedTerm1(
          withDerivedLimit(withDerivedMoratorium(next)),
          parsed.tentativeDisbursementDate, parsed.disbursementDate, parsed.repaymentProfileJson,
        ));
      } else {
        setCompare({ parsed, file: picked });
      }
    } catch (err) {
      // Unreadable documents are still worth storing against the record.
      setError(`${err.message} The file will still be attached when you save.`);
    } finally {
      setReading(false);
    }
  };

  const applyCompare = (updates) => {
    const clean = {};
    Object.entries(updates).forEach(([key, v]) => {
      clean[key] = FIELD_KIND[key] === 'money' ? normalizeMoneyValue(key, v)
        : key === 'interestRateText' ? stripRoiFromText(v)
        : FIELD_NORMALIZE[key] ? FIELD_NORMALIZE[key](v) : v;
    });
    setForm((f) => ({ ...f, ...clean }));
    setCompare(null);
  };

  // Preview only makes sense for PDFs — no browser renders .docx.
  useEffect(() => {
    if (!documentFile || !/pdf$/i.test(documentFile.name)) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(documentFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [documentFile]);

  // Term 1 is now where Tentative/Actual Disb. Date are actually typed (see
  // SanctionTermsCard below) — but deriveSanction, resolveRepaymentWindow,
  // the "Updates as you type" panel, and the save payload all still read
  // `form.disbursementDate`/`form.tentativeDisbursementDate` directly, by
  // design (see the EMPTY comment above): keeping those two plain form keys
  // mirrored from Term 1 means every one of those keeps working completely
  // unchanged, rather than needing to learn about Sanction Terms itself.
  useEffect(() => {
    const term1 = (form.terms || [])[0];
    const nextActual = term1?.actualDisbursementDate || '';
    const nextTentative = term1?.tentativeDisbursementDate || '';
    if (nextActual === form.disbursementDate && nextTentative === form.tentativeDisbursementDate) return;
    setForm((f) => ({ ...f, disbursementDate: nextActual, tentativeDisbursementDate: nextTentative }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.terms]);

  // Term Limit is never typed directly (see SanctionTermsCard) — it's always
  // an equal share of the Limit above, re-split whenever the Limit itself
  // changes so existing terms never drift from the current figure. Skips a
  // no-op re-render when every term already holds its correct share (string
  // comparison, same shape equalSplitTermLimits already returns).
  useEffect(() => {
    const terms = form.terms || [];
    if (!terms.length) return;
    const amounts = equalSplitTermLimits(form.limitAmount, terms.length);
    if (terms.every((t, i) => t.termLimit === amounts[i])) return;
    setForm((f) => ({ ...f, terms: f.terms.map((t, i) => ({ ...t, termLimit: amounts[i] })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.limitAmount, form.terms.length]);

  const derived = useMemo(
    () => deriveSanction({ ...form, roiPct: statedRoiPct }),
    [form, statedRoiPct],
  );

  // Same live-recalculation contract as `derived` above — the Repayment
  // Schedule tab reflects every edit immediately, whether or not it's the
  // tab currently showing, via this same useMemo dependency array.
  const scheduleView = useMemo(
    () => deriveRepaymentSchedule({ ...form, roiPct: statedRoiPct }),
    [form, statedRoiPct],
  );

  // One schedule per Sanction Term, each computed by the exact same
  // deriveRepaymentSchedule this file already uses for the whole-sanction
  // case above — reused as-is, just fed a per-term override of
  // disbursementDate/debtAmount/repaymentProfileJson, with
  // repaymentStartDate/repaymentEndDate cleared so they're freshly resolved
  // from THIS term's own Actual Disb. Date rather than inherited from the
  // parent sanction's own dates. Every other input (ROI, tenor, moratorium
  // treatment, frequency) is the parent sanction's own — Sanction Terms
  // carry none of their own. Each term's own repaymentProfileJson (blank =
  // no override yet, same equal-split default as before) is what makes the
  // percentage editable per term, same as the sanction-level schedule
  // always was.
  const termScheduleViews = useMemo(
    () => (form.terms || []).map((term) => deriveRepaymentSchedule({
      ...form,
      roiPct: statedRoiPct,
      disbursementDate: term.actualDisbursementDate,
      debtAmount: term.termLimit,
      repaymentStartDate: '',
      repaymentEndDate: '',
      repaymentProfileJson: term.repaymentProfileJson || '',
    })),
    [form, statedRoiPct],
  );

  // Two distinct ways the schedule's percentages can be wrong — checked
  // live off the same scheduleView the tab renders (not only at Save), for
  // both new (create/import) and existing (edit) sanctions, so either is
  // visible and Save is blocked the moment it's true rather than only
  // after a failed Save click:
  //
  // 1. The final amortizing term (RepaymentScheduleTab computes it as
  //    100 - sum of every other term) has gone negative — the terms
  //    before it were over-allocated past 100%. This is what an edit
  //    produces the instant it becomes invalid.
  // 2. The whole schedule simply doesn't sum to exactly 100%, with the
  //    final term still positive — this can't happen from an edit made
  //    this session (the residual math guarantees exactly 100 whenever
  //    it runs), but a sanction can carry a *stored* percentage profile
  //    from an earlier save whose length still matches the current
  //    schedule yet whose values were never actually valid.
  //
  // Neither ever changes how many terms exist — buildQuarterEndSchedule
  // sizes the schedule purely from the repayment dates/frequency, never
  // from the percentage profile — this only ever flags an invalid split
  // among the terms that already exist.
  // Checked once per Sanction Term now (each has its own independently
  // editable repayment-percentage profile — see termScheduleViews above),
  // falling back to the single whole-sanction scheduleView only for the
  // (now defensive-only — withDerivedTerm1 always seeds Term 1) zero-terms
  // case, same as the Repayment Schedule tab's own render does.
  const perScheduleViews = (form.terms || []).length ? termScheduleViews : [scheduleView];
  const repaymentPctError = perScheduleViews.reduce((msg, view, idx) => {
    if (msg) return msg;
    const amortSchedule = view.schedule.filter((p) => p.repaymentPct !== undefined);
    if (!amortSchedule.length) return '';
    const finalAmortPeriod = amortSchedule[amortSchedule.length - 1];
    const totalAmortPct = amortSchedule.reduce((t, p) => t + (p.repaymentPct || 0), 0);
    const label = perScheduleViews.length > 1 ? `Term ${idx + 1}: ` : '';
    return finalAmortPeriod.repaymentPct < 0
      ? `${label}Total repayment percentage cannot exceed 100%. Please adjust the repayment percentage in one or more existing terms so that the total is exactly 100%.`
      : Math.abs(100 - totalAmortPct) >= 0.01
        ? `${label}Total repayment percentage must equal exactly 100%. Current total: ${Math.round(totalAmortPct * 100) / 100}%. Please adjust the repayment percentage in one or more existing terms so that the total is exactly 100%.`
        : '';
  }, '');

  // Sanction Terms (Product section): same "computed live, blocks Save"
  // pattern as repaymentPctError above. Every term's own Actual Disb. Date
  // is required — not just Term 1's — since each one anchors that term's
  // own repayment schedule; Term 1's was what "Disbursement date is
  // required" used to mean at the sanction level before Sanction Terms
  // existed (see withDerivedTerm1), now generalized to whichever term (or
  // terms) still need it. Not living in `missingRequired` since
  // disbursementDate is no longer a FIELDS scalar at all (see
  // sanctionFields.js). An empty terms list shouldn't normally happen
  // (withDerivedTerm1 always seeds Term 1), but is guarded defensively
  // rather than assumed away.
  const termsTotal = (form.terms || []).reduce(
    (t, term) => t + (parseFloat(String(term.termLimit ?? '').replace(/,/g, '')) || 0), 0,
  );
  const termsLimit = parseFloat(String(form.limitAmount ?? '').replace(/,/g, '')) || 0;
  const termsMissingActual = (form.terms || []).findIndex((term) => !term.actualDisbursementDate);
  const termsCodViolation = (form.terms || []).find((term) => {
    if (!term.actualDisbursementDate || !form.scheduledCod) return false;
    const disb = parseDate(term.actualDisbursementDate);
    const cod = parseDate(form.scheduledCod);
    return disb && cod && disb.getTime() >= cod.getTime();
  });
  const sanctionTermsError = !(form.terms || []).length
    ? 'At least one Sanction Term is required.'
    : termsMissingActual !== -1
      ? `Term ${termsMissingActual + 1} Actual Disb. Date is required.`
      : termsCodViolation
        ? `Each Sanction Term's Actual Disb. Date must fall before the Scheduled COD date (${form.scheduledCod}).`
        : Math.abs(termsTotal - termsLimit) >= 0.01
          ? `The Sanction Terms must add up to the Limit (₹${termsLimit.toFixed(2)} Cr). Current total: ₹${termsTotal.toFixed(2)} Cr.`
          : '';

  // Project Cost = Debt (the sanctioned amount) + Equity, so any one of
  // Debt / Equity / Debt % / Equity % that the letter left blank follows
  // arithmetically from what it did print — deriveSanction already works
  // these out for the read-only preview panel; this writes the same numbers
  // into the actual fields so what gets saved isn't blank, matching the
  // backend's own SanctionDerivedCalculator.fillGaps (which would compute
  // and store the identical values on the next read regardless — this just
  // means the reviewer sees them here rather than after a round trip).
  // Printed still wins: a field the letter (or the reviewer) already gave a
  // value for is never touched.
  useEffect(() => {
    const updates = {};
    if (derived.computed.has('debtAmount') && !form.debtAmount) {
      updates.debtAmount = stripRs(derived.debtAmount);
    }
    if (derived.computed.has('equityAmount') && !form.equityAmount) {
      updates.equityAmount = stripRs(derived.equityAmount);
    }
    if (derived.computed.has('debtPct') && !form.debtPct) {
      updates.debtPct = derived.debtPct;
    }
    if (derived.computed.has('equityPct') && !form.equityPct) {
      updates.equityPct = derived.equityPct;
    }
    // Repayment Start/End Date, Scheduled COD date and Actual COD Date: same
    // "sync outright, but only while the field still holds exactly what this
    // effect itself last wrote" contract as ROI/DSRA/ISRA below. Deliberately
    // NOT read off `derived.repaymentStart`/`derived.repaymentEnd` here —
    // resolveRepaymentWindow treats a non-blank repaymentStartDate/repaymentEndDate
    // as the contractual date itself and echoes it straight back, so once this
    // effect has written a value into the field, `derived` keeps reporting
    // that same value forever regardless of Disb. Date — it can never fall
    // back to null on its own to signal "clear this." Instead this recomputes
    // the window with both fields blanked, which is the auto-computed
    // baseline uncontaminated by whatever the fields currently hold, and uses
    // THAT to decide both fills and clears.
    const pureWindow = resolveRepaymentWindow({ ...form, repaymentStartDate: '', repaymentEndDate: '' });
    if (pureWindow.repaymentEnd) {
      const computed = formatDate(pureWindow.repaymentEnd);
      if (!form.repaymentEndDate || form.repaymentEndDate === autoRepaymentEndRef.current) {
        if (form.repaymentEndDate !== computed) updates.repaymentEndDate = computed;
      }
      autoRepaymentEndRef.current = computed;
    } else if (form.repaymentEndDate && form.repaymentEndDate === autoRepaymentEndRef.current) {
      updates.repaymentEndDate = '';
      autoRepaymentEndRef.current = null;
    }
    if (pureWindow.repaymentStart) {
      const computed = formatDate(pureWindow.repaymentStart);
      if (!form.repaymentStartDate || form.repaymentStartDate === autoRepaymentStartRef.current) {
        if (form.repaymentStartDate !== computed) updates.repaymentStartDate = computed;
      }
      autoRepaymentStartRef.current = computed;
    } else if (form.repaymentStartDate && form.repaymentStartDate === autoRepaymentStartRef.current) {
      updates.repaymentStartDate = '';
      autoRepaymentStartRef.current = null;
    }
    // Scheduled COD date has no calculation of its own — defaulted to
    // Moratorium End (construction/ramp-up ends, repayment capacity begins)
    // only when the letter didn't state one.
    if (derived.moratoriumEnd) {
      const computed = derived.moratoriumEnd;
      if (!form.scheduledCod || form.scheduledCod === autoScheduledCodRef.current) {
        if (form.scheduledCod !== computed) updates.scheduledCod = computed;
      }
      autoScheduledCodRef.current = computed;
    } else if (form.scheduledCod && form.scheduledCod === autoScheduledCodRef.current) {
      updates.scheduledCod = '';
      autoScheduledCodRef.current = null;
    }
    // Actual COD Date defaults to Scheduled COD date until the reviewer picks
    // a real one — reads the value Scheduled COD date is ABOUT to become this
    // same pass (updates.scheduledCod, if it was just touched above) rather
    // than the stale pre-update form.scheduledCod, so clearing Scheduled COD
    // date (because Disb. Date was removed) cascades into clearing Actual COD
    // Date in the same pass instead of one render behind.
    const scheduledCodNow = updates.scheduledCod !== undefined ? updates.scheduledCod : form.scheduledCod;
    if (scheduledCodNow) {
      const target = scheduledCodNow;
      if (!form.actualCod || form.actualCod === autoActualCodRef.current) {
        if (form.actualCod !== target) updates.actualCod = target;
      }
      autoActualCodRef.current = target;
    } else if (form.actualCod && form.actualCod === autoActualCodRef.current) {
      updates.actualCod = '';
      autoActualCodRef.current = null;
    }
    // Rate of Interest is never typed (see sanctionFields.js `readOnly`), so
    // unlike the gap-fills above this keeps the field in sync outright
    // rather than only filling it once — Base Rate + Spread is meant to win
    // over whatever roiPct already holds (a figure the letter stated
    // separately) once both are known, not just top up a blank box.
    if (derived.roi) {
      const current = parsePct(form.roiPct);
      const target = parsePct(derived.roi);
      if (current === null || Math.abs(current - target) > 0.001) {
        updates.roiPct = derived.roi;
      }
    }
    // DSRA/ISRA Amount are editable, not purely derived (see sanctionFields.js)
    // — but still start from the calculated figure and keep tracking it as
    // ROI/other inputs change, same "sync outright" contract as roiPct
    // above. Unlike roiPct, this box can genuinely hold a reviewer's own
    // typed override though, so it only refreshes while it still holds
    // exactly what this effect last wrote itself (autoDsraRef/autoIsraRef)
    // — otherwise a Base Rate/Spread edit after import would leave DSRA/ISRA
    // (and whatever gets saved) silently pinned to the letter's original ROI.
    if (derived.dsraAmount) {
      const computed = stripRs(derived.dsraAmount);
      if (!form.dsraAmount || form.dsraAmount === autoDsraRef.current) {
        if (form.dsraAmount !== computed) updates.dsraAmount = computed;
      }
      autoDsraRef.current = computed;
    }
    if (derived.israAmount) {
      const computed = stripRs(derived.israAmount);
      if (!form.israAmount || form.israAmount === autoIsraRef.current) {
        if (form.israAmount !== computed) updates.israAmount = computed;
      }
      autoIsraRef.current = computed;
    }
    if (Object.keys(updates).length) setForm((f) => ({ ...f, ...updates }));
  }, [derived, form.debtAmount, form.equityAmount, form.debtPct, form.equityPct, form.roiPct,
    form.dsraAmount, form.israAmount, form.repaymentStartDate, form.repaymentEndDate,
    form.scheduledCod, form.actualCod]);

  const set = (key) => (e) => {
    const raw = e.target.value;
    const value = FIELD_KIND[key] === 'money' ? stripRs(raw)
      : FIELD_NORMALIZE[key] ? FIELD_NORMALIZE[key](raw) : raw;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // The picker hands back an ISO string (or '' when cleared) directly, not an
  // input change event — stored as-is, since the backend's date parser reads
  // ISO natively. Picking Tentative Disb. Date while Actual Disb. Date is
  // still blank also seeds Actual with that same date — the repayment
  // schedule (which always calculates off Actual, never Tentative) needs a
  // value to work from right away. Only a still-BLANK Actual is seeded: once
  // Actual holds any value of its own, picking/changing Tentative again never
  // touches it, and changing Actual afterward is the reviewer's own edit and
  // never flows back to Tentative.
  const setDate = (key) => (iso) => setForm((f) => ({ ...f, [key]: iso }));

  const missingRequired = FIELDS
    .filter((f) => f.required && !(isGroupTarget && f.key === 'borrowerName') && !String(form[f.key] || '').trim())
    .map((f) => f.label);

  const handleSave = async () => {
    setError('');
    if (missingRequired.length) {
      setError(`Still needed: ${missingRequired.join(', ')}`);
      return;
    }
    // CIN is optional (a borrower may genuinely have none on file) but, if
    // present, must be a well-formed 21-character CIN — checked here too,
    // not just server-side (saveSanction's requireValidCin would reject it
    // anyway), so a mode="import" correction gets an immediate, specific
    // message rather than a round-trip. toCin's own normalize already
    // strips anything that isn't A-Z/0-9 as the reviewer types, so this
    // only ever catches a genuinely wrong length/shape.
    if (mode === 'import' && form.cin && !CIN_REGEX.test(form.cin)) {
      setError('Enter a valid 21-character CIN, e.g. U40106MH2026PTC223978');
      return;
    }
    // "Other" with nothing entered has no interval to schedule against —
    // reject it explicitly here rather than letting it silently fall back
    // to some other frequency.
    if (form.repaymentFrequency === 'OTHER'
      && !(parseInt(form.repaymentFrequencyOtherMonths, 10) > 0)) {
      setError('Enter a custom interval (in months) for the Other repayment frequency, or pick a listed one.');
      return;
    }
    // The per-period repayment percentages (Repayment Schedule tab) must
    // total exactly 100 — for a brand-new sanction and an existing one
    // being edited alike — a partially-edited profile is fine to look at
    // live, but never to save, since it would silently under- or
    // over-repay the loan. repaymentPctError (computed live off the same
    // scheduleView, see above — covers both a negative final term and a
    // stored profile that simply doesn't sum to 100) already has its own
    // persistent banner and disabled Save button, so this is purely a
    // defensive backstop, not the normal way a reviewer encounters it.
    if (repaymentPctError) return;
    // Sanction Terms must add up to the Limit and clear COD — same "computed
    // live, block Save" contract as repaymentPctError just above.
    if (sanctionTermsError) { setCenterToast(sanctionTermsError); return; }
    setSaving(true);
    try {
      // The sanction payload, built once regardless of which path below
      // sends it — either nested inside identity.sanctions[]/embedded in a
      // group-create call (the `pending` path — see the prop's own comment
      // above), or posted directly via saveSanction/saveGroupSanction
      // (every other, already-resolved path — unchanged from before).
      // Built from FIELDS rather than a hand-written literal, so a field
      // added to the array is posted without a second edit here. Money
      // fields are typed without "Rs." (it's shown as a fixed prefix beside
      // the input), so it's put back on here — the stored value stays the
      // same shape it always was, whether typed by hand or read off a letter.
      const sanctionCore = {
        // Prefer this session's own saved id over the prop it opened with —
        // a second Save after the first (create/import mode) must update
        // that same row, not post id: null again and create a duplicate.
        id: savedSanctionId || initial?.id || null,
        ...FIELDS.filter((f) => f.persisted !== false).reduce((p, f) => ({
          ...p,
          [f.key]: f.kind === 'money' ? withRs(form[f.key]) : form[f.key],
        }), {}),
        // Neither is a FIELDS scalar any more (see the EMPTY comment above)
        // — sent alongside the rest by hand. disbursementDate/
        // tentativeDisbursementDate are kept in sync from Term 1 (see the
        // sync effect above), so the backend's existing required/date-range
        // check on disbursementDate keeps working completely unchanged.
        disbursementDate: form.disbursementDate,
        tentativeDisbursementDate: form.tentativeDisbursementDate,
        // Same "Rs." shape every other money value on this form already
        // gets from withRs, so the backend's SanctionValueParser parses it
        // identically.
        terms: (form.terms || []).map((t) => ({ ...t, termLimit: withRs(t.termLimit) })),
        status: mode === 'import' ? 'IMPORTED' : (initial?.status || 'DRAFT'),
        source: mode === 'import' ? 'IMPORTED' : (initial?.source || 'MANUAL'),
        extractionEngine: engine || initial?.extractionEngine || null,
      };
      const rawExtracted = mode === 'import' ? initial : null;

      let saved;
      let bId = borrowerId;
      let gTarget = groupTarget;

      if (pending) {
        // NOTHING has been created yet — see the prop's own comment. Each
        // branch is ONE backend call that creates the company/group AND the
        // sanction together (BorrowerService's maybePersistAttachedSanction,
        // same transaction) — a failure here (a duplicate ref no., a
        // missing required field) leaves nothing behind at all, so
        // handleCancel below has nothing to clean up for this path.
        const rawExtractedJson = rawExtracted ? JSON.stringify(rawExtracted) : null;
        if (pending.kind === 'MATCH') {
          // resolve() only ever fills blanks on the existing borrower — its
          // hierarchy, company type, and every other saved field are left
          // exactly as they are.
          saved = await borrowerApi.resolve({
            ...pending.identity, sanctions: [sanctionCore], rawExtractedJson,
          });
          bId = saved.id;
        } else if (pending.kind === 'COMPANY') {
          saved = await borrowerApi.resolveWithHierarchy(
            { ...pending.identity, sanctions: [sanctionCore], rawExtractedJson },
            {
              parentGroupId: pending.hierarchy.parentGroupId,
              newParentGroupName: pending.hierarchy.newParentName,
              newParentGroupCin: pending.hierarchy.newParentCin,
              newParentGroupAddress: pending.hierarchy.newParentAddress,
              subGroupId: pending.hierarchy.subGroupId,
              newSubGroupName: pending.hierarchy.newSubName,
              newSubGroupCin: pending.hierarchy.newSubCin,
              newSubGroupAddress: pending.hierarchy.newSubAddress,
              isSubsidiary: !!pending.hierarchy.isSubsidiary,
              isSpv: !!pending.hierarchy.isSpv,
            },
          );
          bId = saved.id;
        } else if (pending.kind === 'GROUP') {
          // The group itself (if a new name was typed) is still created via
          // its own call before the sanction — same sequence
          // CompanyMatchModal used to run at "Confirm and continue" time —
          // just moved here, to Save time, so nothing is created until this
          // click. Reuses resolveHierarchyGroupId exactly as every other
          // screen that turns this same picker's state into a concrete
          // group id does.
          const groupId = await resolveHierarchyGroupId(pending.hierarchy);
          if (!groupId) throw new Error('Select or create a Parent Group');
          gTarget = { groupId, groupName: pending.groupName, type: pending.type };
          saved = await borrowerApi.saveGroupSanction(groupId, sanctionCore, rawExtracted);
        }
      } else if (!gTarget && !bId) {
        // Plain "attach a sanction to a borrower found/created by typed
        // name" — this form opened directly with no CompanyMatchModal step
        // (and so no `pending`) at all. The borrower-level values the
        // letter carried (promoter, guarantor, group, Cat / Sub Cat, SL
        // ref.) ride along; the server fills only blank fields with them,
        // so an import never overwrites something typed.
        const identity = { borrowerName: form.borrowerName.trim() };
        BORROWER_IMPORT_KEYS.forEach((k) => {
          // Prefer the live form value for a key this form actually renders
          // (form[k] is only ever undefined for a BORROWER_IMPORT_KEYS entry
          // with no field in SANCTION_FIELDS, e.g. promoterName) — so a
          // reviewer's correction to a rendered field (e.g. CIN) is what
          // actually gets saved, not the original parsed value it started from.
          const v = form[k] !== undefined ? form[k] : initial?.[k];
          if (v != null && String(v).trim()) identity[k] = String(v);
        });
        const b = await borrowerApi.resolve(identity);
        bId = b.id;
      }

      if (!saved) {
        // Every already-resolved path — a known borrowerId/groupTarget prop,
        // or the plain typed-name fallback just above — unchanged from
        // before.
        //
        // A one-time chance to correct a misread CIN/registered address —
        // editable only in import mode (see sanctionFields.js
        // `editableOnImport`). Sent as part of the sanction save itself (not
        // a separate call beforehand) so the identity correction and the
        // sanction row commit or fail together in one transaction — see
        // BorrowerService#saveSanction (2026-09-02 save-flow atomicity fix).
        // Blank fields are simply omitted; the backend never uses a blank
        // value to erase what's on file. Meaningless for a Group/Sub-Group-level
        // sanction — a Group's own CIN/address is managed via its own Edit
        // action, never through a sanction import.
        const identityCin = !gTarget && mode === 'import' ? form.cin.trim() : '';
        const identityRegisteredAddress = !gTarget && mode === 'import' ? form.registeredAddress.trim() : '';
        const payload = { ...sanctionCore, ...(gTarget ? {} : { borrowerId: bId }) };
        saved = gTarget
          ? await borrowerApi.saveGroupSanction(gTarget.groupId, payload, rawExtracted)
          : await borrowerApi.saveSanction(payload, rawExtracted, identityCin, identityRegisteredAddress);
      }

      // Store the letter against the row we just created. Matched by id, not
      // refNo — the backend cleans/normalizes refNo on the way in
      // (SanctionValueParser.clean, e.g. collapsing double spaces), so a
      // string comparison against what was typed here isn't guaranteed to
      // line up, and silently falling back to sanctions[0] on a mismatch
      // could pick the wrong row for a borrower with more than one sanction.
      // The id we already know (this session's own previous save, or an
      // edit's starting id) is unambiguous; only a session's first-ever save
      // of a brand-new sanction has no id yet, and that new row is
      // guaranteed to have the highest id among this borrower's sanctions.
      // A group-level save returns the saved sanction wrapper directly
      // (there's no borrower to nest a `.sanctions` list under).
      const knownId = savedSanctionId || initial?.id;
      let target = null;
      if (gTarget) {
        target = saved;
      } else if (saved?.sanctions?.length) {
        target = knownId
          ? saved.sanctions.find((s) => String(s.id) === String(knownId))
          : saved.sanctions.reduce((max, s) => (Number(s.id) > Number(max.id) ? s : max));
      }
      if (documentFile && target?.id) {
        try {
          await borrowerApi.uploadDoc(target.id, documentFile);
        } catch (e) {
          // The record is saved; a failed attachment shouldn't lose it.
          console.warn('Sanction saved but the document could not be stored:', e);
        }
      }

      // Every successful save closes the modal, create/import included —
      // this used to stay open on the Repayment Schedule tab to show what
      // was just computed, but whenever that schedule wasn't actually
      // computable yet (most often a blank Disbursement Date), the modal
      // sat on the unchanged Sanction Details tab instead, which reads as
      // "the save didn't work, it's asking me again" even though it saved
      // fine. Closing unconditionally, the same way an edit already does,
      // removes that ambiguity entirely: the modal going away IS the
      // confirmation. The saved sanction (and its schedule, once it has
      // enough to compute one) is one click away on the Sanction Letters /
      // Repayment Schedule tabs of the page underneath — import mode's tab
      // strip is already available before Save too, for anyone who wants to
      // preview the schedule first.
      if (target?.id) setSavedSanctionId(target.id);
      onSaved?.(saved);
      onClose?.();
    } catch (e) {
      setError(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  // Backing out (backdrop click, the X button, or Cancel) without saving —
  // as opposed to handleSave's own onClose above, which only runs once a
  // sanction has actually been written. Nothing to clean up here any more:
  // a `pending` sanction (see that prop's own comment) never created
  // anything in the first place — persistence happens ONLY inside
  // handleSave now — and an already-known borrowerId/groupTarget prop
  // points at a company/group that already existed before this screen ever
  // opened, so it was never this screen's to delete.
  const handleCancel = () => {
    onClose?.();
  };

  const title = mode === 'import'
    ? 'Review what was read'
    : mode === 'edit' ? 'Edit sanction' : 'Add sanction';

  return (
    <div className="br-modal-backdrop" onMouseDown={handleCancel}>
      {reading && <CrmPreloader text="Reading sanction letter…" />}
      {centerToast && createPortal(
        <div className="br-center-toast" role="alert">{centerToast}</div>,
        document.body,
      )}
      {/* Wide in every mode now: thirty-odd fields in a single narrow column
          is unusable, whether they arrived from a letter or by hand. */}
      <div
        className="br-modal br-modal-wide"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="br-modal-head">
          <div className="br-viewer-title">
            {documentFile && <FileText size={18} className="br-viewer-icon" aria-hidden="true" />}
            <div className="br-viewer-title-text">
              <span className="br-modal-title-row">
                <h3 className="br-modal-title">{title}</h3>
                {mode === 'import' && (
                  <span className="br-info-wrap" ref={reviewHintRef}>
                    <button
                      type="button"
                      className="br-info-btn"
                      onClick={() => setShowReviewHint((v) => !v)}
                      aria-label="Why review this"
                      aria-expanded={showReviewHint}
                    >
                      <BsInfoCircle size={14} aria-hidden="true" />
                    </button>
                    {showReviewHint && (
                      <div className="br-info-popover" role="tooltip">
                        Check every value against the letter before saving. Nothing is stored yet.
                      </div>
                    )}
                  </span>
                )}
              </span>
              {/* The file being reviewed, named at the top — the reviewer needs
                  to know which letter these values came from before trusting
                  them, especially when importing several in a row. */}
              {documentFile && (
                <p className="br-modal-sub br-modal-file">
                  <span className="br-modal-filename">{documentFile.name}</span>
                  <span className="br-modal-filesize">
                    {Math.round(documentFile.size / 1024)} KB
                  </span>
                </p>
              )}
              {isGroupTarget && (
                <p className="br-modal-sub">
                  Associated with: <strong>{displayGroupName}</strong>
                  {' — '}{displayGroupType === 'SUB_GROUP' ? 'Sub Group' : 'Parent Group'}
                  {pending?.kind === 'GROUP' && !groupTarget?.groupId && ' (new)'}
                </p>
              )}
            </div>
          </div>
          <button type="button" className="br-icon-btn" onClick={handleCancel} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {mode === 'import' && duplicateRef && (
          <div className="br-banner br-banner-danger">
            A sanction with this reference number has already been imported. Saving will
            be blocked until the reference is corrected.
          </div>
        )}

        {mode === 'import' && lowConfidence.size > 0 && (
          <div className="br-banner br-banner-warn">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>
              {lowConfidence.size} field{lowConfidence.size === 1 ? ' was' : 's were'} read by
              the AI rather than matched from the document's tables. Those are marked below —
              check them first.
            </span>
          </div>
        )}

        {/* scheduleView is computed live off the form (see the useMemo above),
            not off a saved record, so import mode has a real schedule to show
            the moment a letter's been read — same as edit mode, which starts
            with one already. create mode starts from a blank form, though,
            so it still waits for a first save before there's anything worth
            a second tab for. Reuses .br-tabstrip/.br-tab/.br-tab-on, already
            defined in BorrowerRegistry.css but unused until now. */}
        {(mode !== 'create' || savedSanctionId) && (
          <div className="br-tabstrip">
            <button
              type="button"
              className={`br-tab ${activeTab === 'details' ? 'br-tab-on' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              <FileText size={15} aria-hidden="true" />
              Sanction Details
            </button>
            <button
              type="button"
              className={`br-tab ${activeTab === 'schedule' ? 'br-tab-on' : ''}`}
              onClick={() => setActiveTab('schedule')}
            >
              <Calendar size={15} aria-hidden="true" />
              Repayment Schedule
            </button>
          </div>
        )}

        {activeTab === 'schedule' && (mode !== 'create' || savedSanctionId) ? (
          (form.terms || []).length > 0 ? (
            <div className="br-term-schedule-body">
              {(() => {
                const i = Math.min(selectedTermIndex, form.terms.length - 1);
                const term = form.terms[i];
                return (
                  <div className="br-term-schedule-section">
                    <div className="br-term-schedule-heading">
                      {form.terms.length > 1 && (
                        <select
                          className="br-input br-term-schedule-select"
                          value={i}
                          onChange={(e) => setSelectedTermIndex(Number(e.target.value))}
                        >
                          {form.terms.map((t, idx) => (
                            <option key={idx} value={idx}>
                              {`Term ${idx + 1}`}{t.facilityType ? ` — ${t.facilityType}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      <span className="br-term-schedule-title">
                        Term {i + 1}
                        {term.facilityType ? ` — ${term.facilityType}` : ''}
                      </span>
                      <span className="br-term-schedule-sub">
                        {term.termLimit ? `Rs. ${term.termLimit} Cr` : '—'}
                        {' · Actual Disb. Date: '}
                        {formatDate(parseDate(term.actualDisbursementDate)) || '—'}
                      </span>
                    </div>
                    <RepaymentScheduleTab
                      view={termScheduleViews[i]}
                      form={{ ...form, disbursementDate: term.actualDisbursementDate, debtAmount: term.termLimit }}
                      onProfileChange={(json) => setForm((f) => ({
                        ...f,
                        terms: f.terms.map((t, idx) => (idx === i ? { ...t, repaymentProfileJson: json } : t)),
                      }))}
                      tableHeading={null}
                    />
                  </div>
                );
              })()}
            </div>
          ) : (
          <RepaymentScheduleTab
            view={scheduleView}
            form={form}
            onProfileChange={(json) => setForm((f) => ({ ...f, repaymentProfileJson: json }))}
            tableHeading={null}
          />
          )
        ) : (
        <div
          className={`br-modal-body sr-modal-body${(previewUrl || allowAttach) ? '' : ' sr-modal-body--no-side'}`}
          ref={sectionBodyRef}
        >
          <nav className="sr-nav" aria-label="Sanction section navigation">
            {NAV_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                className={`sr-nav-link${activeSectionId === sec.id ? ' sr-nav-link--active' : ''}`}
                onClick={() => jumpToSection(sec.id)}
              >
                <span className="sr-nav-num">{sec.num}</span>
                <span>{sec.group}</span>
              </button>
            ))}
          </nav>

          <div className="sr-content">
            {NAV_SECTIONS.map((sec) => (
              <fieldset
                key={sec.id}
                id={sec.id}
                ref={setSectionRef(sec.id)}
                data-section-id={sec.id}
                className="br-fieldset sr-section"
              >
                <legend className="br-fieldset-legend sr-section-legend">
                  <span className="sr-section-num">{sec.num}</span>{sec.group}
                </legend>

                {sec.group === 'Project Details' && (
                  <TechnologyGroupDropdowns
                    groupValue={form.projectGroup}
                    subGroupValue={form.projectSubGroup}
                    onGroupChange={(v) => setForm((f) => ({ ...f, projectGroup: v, projectSubGroup: '' }))}
                    onSubGroupChange={(v) => setForm((f) => ({ ...f, projectSubGroup: v }))}
                  />
                )}

                {sec.fields && (
                  <div className="br-form-grid">
                    {sec.fields
                      .filter((f) => !f.formHidden)
                      // A Group/Sub-Group-level sanction has no company: the
                      // Borrower field is replaced by the "Associated With"
                      // line in the header, and CIN/Registered Address are a
                      // company's own identity fields, not this Group's own
                      // (managed separately, on the Group's own Edit action).
                      .filter((f) => !(isGroupTarget && (f.key === 'borrowerName' || f.key === 'cin' || f.key === 'registeredAddress')))
                      // Only meaningful once Repayment Frequency is actually
                      // Other — showing it unconditionally would invite a
                      // custom interval nobody asked for.
                      .filter((f) => f.key !== 'repaymentFrequencyOtherMonths' || form.repaymentFrequency === 'OTHER')
                      .map((f) => {
                      // A field marked editableOnImport is a plain typeable box
                      // only while mode === 'import' — the one moment a
                      // borrower-identity value just extracted from this same
                      // letter can still turn out wrong and be worth fixing
                      // before Save (see handleSave's updateImportedIdentity
                      // call). Locked everywhere else, same as any other
                      // displayOnly field.
                      const locked = f.displayOnly && !(f.editableOnImport && mode === 'import');
                      // The ISRA-amount hint swaps to a longer, more specific
                      // explanation once it's clear the letter never stated
                      // ISRA separately — same override handleSave's derived
                      // panel used to apply below the field, now just what
                      // the field's own (i) icon shows.
                      const moratoriumDefaulted = f.key === 'interestDuringMoratorium'
                        && mode === 'import' && interestMoratoriumDefaulted;
                      const hintText = f.key === 'israAmount' && derived.israIsContractual === false
                        ? 'This is the interest component of the DSRA calculation. It does not indicate '
                          + 'a separate contractual ISRA requirement unless ISRA is explicitly stated in '
                          + 'the sanction letter.'
                        : moratoriumDefaulted
                          // Folded into the same (i) icon as the field's ordinary
                          // hint, rather than a permanently-visible warning line —
                          // still surfaced (via the icon's warn tone below), just
                          // not taking up its own row under every import.
                          ? `${f.hint} Not specified in sanction letter — defaulted to Interest Served.`
                          : f.hint;
                      return (
                      <label
                        key={f.key}
                        className={`br-field ${f.wide ? 'br-field-wide' : ''}`}
                      >
                        <span className="br-field-label">
                          {f.formLabel || f.label}
                          {f.required && <span className="br-req" aria-hidden="true"> *</span>}
                          {/* The unit the column is quoted in. Without it a user
                              typing 205 into "Project Cost" has no way to know
                              whether that means rupees or crore. */}
                          {f.suffix && <span className="br-field-suffix">{f.suffix}</span>}
                          <FieldInfoHint text={hintText} tone={moratoriumDefaulted ? 'warn' : ''} />
                          {lowConfidence.has(f.key) && (
                            <span className="br-chip br-chip-warn">check</span>
                          )}
                        </span>
                        {locked ? (
                          <input
                            type="text"
                            value={form[f.key] || ''}
                            readOnly
                            placeholder={f.placeholder}
                            className={[
                              'br-input',
                              'br-input-readonly',
                              f.mono ? 'br-input-mono' : '',
                            ].filter(Boolean).join(' ')}
                          />
                        ) : f.readOnly ? (
                          <input
                            type="text"
                            value={derived[f.derivedKey] || ''}
                            readOnly
                            placeholder="—"
                            className={[
                              'br-input',
                              'br-input-readonly',
                              derived[f.derivedKey] === 'Not Calculated' ? 'br-input-warn' : '',
                            ].filter(Boolean).join(' ')}
                          />
                        ) : f.kind === 'select' ? (
                          <select value={form[f.key] || f.options[0].value} onChange={set(f.key)} className="br-input">
                            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : f.kind === 'money' ? (
                          <div className="br-input-group">
                            <span className="br-input-prefix" aria-hidden="true">Rs.</span>
                            <input
                              type="text"
                              value={form[f.key]}
                              onChange={set(f.key)}
                              placeholder={f.placeholder}
                              className={[
                                'br-input',
                                (lowConfidence.has(f.key) || form[f.key] === 'Not Calculated') ? 'br-input-warn' : '',
                              ].filter(Boolean).join(' ')}
                            />
                          </div>
                        ) : f.kind === 'date' ? (
                          // The min/max validity-window constraint that used
                          // to apply here for `disbursementDate` now lives on
                          // SanctionTermsCard's own Actual Disb. Date column
                          // instead — that field no longer renders through
                          // this generic loop at all (see sanctionFields.js).
                          <SanctionDatePicker
                            value={toIsoDate(form[f.key])}
                            onChange={setDate(f.key)}
                            placeholder={f.placeholder}
                            warn={lowConfidence.has(f.key)}
                          />
                        ) : f.textarea ? (
                          <textarea
                            rows={3}
                            value={form[f.key]}
                            onChange={set(f.key)}
                            placeholder={f.placeholder}
                            className={[
                              'br-input',
                              'br-textarea',
                              lowConfidence.has(f.key) ? 'br-input-warn' : '',
                            ].filter(Boolean).join(' ')}
                          />
                        ) : (
                          <input
                            type="text"
                            value={form[f.key]}
                            onChange={set(f.key)}
                            placeholder={f.placeholder}
                            maxLength={f.maxLength}
                            className={[
                              'br-input',
                              lowConfidence.has(f.key) ? 'br-input-warn' : '',
                              f.mono ? 'br-input-mono' : '',
                            ].filter(Boolean).join(' ')}
                          />
                        )}
                      </label>
                      );
                    })}
                  </div>
                )}

                {sec.group === 'Sanction Terms' && (
                  <SanctionTermsCard
                    terms={form.terms || []}
                    limitAmount={form.limitAmount}
                    onChange={(terms) => setForm((f) => ({ ...f, terms }))}
                    // Same constraint the sanction-level Actual Disb. Date
                    // field used to carry (min = Sanction Date, max = the
                    // date the sanction lapses) — now applied to every
                    // term's own Actual Disb. Date column.
                    minDate={toIsoDate(form.sanctionDate)}
                    maxDate={derived.sanctionValidTillIso || ''}
                  />
                )}

                {sec.group === 'Derived Values' && (
                  <div className="sr-derived-grid">
                    {/* Debt / Equity / Debt % / Equity % / Rate of Interest aren't
                        shown here — they're written straight into their own fields
                        on the left the moment they're worked out (see the effects
                        above), so a second, delayed copy of the same number in
                        this panel would just be a place for the two to fall out
                        of sync. */}
                    <Row label="Moratorium ends" value={derived.moratoriumEnd} />
                    <Row label="Repayment starts" value={derived.repaymentStart} />
                    <Row label="Repayment ends" value={derived.repaymentEnd} />
                    <Row label="Total tenor" value={derived.totalTenorMonths} />
                    <Row label="First-year interest" value={derived.firstYearInterest} />
                    {showDsra && <Row label="DSRA (calculated)" value={derived.dsraAmount} />}
                    {showIsra && <Row label="ISRA (calculated)" value={derived.israAmount} />}
                    <Row label="Sanction valid till" value={derived.sanctionValidTill} />
                    <Row
                      label="Disb. Date check"
                      value={derived.disbDateCheck}
                      tone={derived.disbDateOk === false ? 'warn' : derived.disbDateOk ? 'ok' : ''}
                    />
                    <Row label="COD status" value={derived.codStatus} />
                  </div>
                )}

                {sec.group === 'Status' && (
                  <div className="sr-derived-grid">
                    <Row
                      label="Sanction Status"
                      value={mode === 'import' ? 'Imported' : statusLabel(initial?.status || 'DRAFT')}
                    />
                    <Row
                      label="Source"
                      value={mode === 'import' ? 'Imported' : sourceLabel(initial?.source || 'MANUAL')}
                    />
                  </div>
                )}
              </fieldset>
            ))}
          </div>

          {(previewUrl || allowAttach) && (
            <div className="br-side-col">
              {previewUrl && (
                <iframe className="br-preview" src={previewUrl} title="Sanction letter" />
              )}

              {allowAttach && (
                <div className="br-attach-box">
                  <p className="br-attach-title">Sanction letter</p>
                  <p className="br-attach-help">
                    {documentFile
                      ? 'Attached. It will be stored when you save.'
                      : 'Optional. If you attach one, its values are checked against '
                        + 'what you have entered and any differences are shown.'}
                  </p>
                  <button
                    type="button"
                    className="br-btn br-btn-sm"
                    onClick={() => attachRef.current?.click()}
                    disabled={reading}
                  >
                    <Paperclip size={14} aria-hidden="true" />
                    {reading ? 'Reading…' : documentFile ? 'Choose a different file' : 'Attach letter'}
                  </button>
                  <input
                    ref={attachRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleAttach}
                    hidden
                  />
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {compare && (
          <SanctionCompareModal
            current={form}
            parsed={compare.parsed}
            fileName={compare.file?.name}
            onCancel={() => setCompare(null)}
            onConfirm={applyCompare}
          />
        )}

        {/* Persistent, not the 3s auto-dismissing `error` banner below — this
            reflects the live state of the schedule (see repaymentPctError
            above), so it stays up for as long as the allocation actually is
            invalid and disappears the moment the reviewer fixes it,
            regardless of whether they've attempted Save yet. */}
        {repaymentPctError && <div className="br-banner br-banner-danger">{repaymentPctError}</div>}
        {error && <div className="br-banner br-banner-danger">{error}</div>}

        <div className="br-modal-foot">
          <button type="button" className="br-btn" onClick={handleCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="br-btn br-btn-primary"
            onClick={handleSave}
            disabled={saving || duplicateRef || !!repaymentPctError}
          >
            <Check size={15} aria-hidden="true" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * The (i) icon a field label carries when it has explanatory hint text —
 * click to reveal, same pattern already used for "Why review this" and the
 * Sanction Terms rules popover, just once per field instead of once per
 * section. Keeps every field's caption out of the layout by default; a
 * reviewer who wants it clicks for it instead of it always taking a line.
 */
const FieldInfoHint = ({ text, tone = '' }) => {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    if (show) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [show]);
  if (!text) return null;
  return (
    <span className="br-info-wrap" ref={ref}>
      <button
        type="button"
        className={`br-info-btn${tone ? ` br-tone-${tone}` : ''}`}
        onClick={() => setShow((v) => !v)}
        aria-label="More about this field"
        aria-expanded={show}
      >
        <BsInfoCircle size={12} aria-hidden="true" />
      </button>
      {show && <div className="br-info-popover" role="tooltip">{text}</div>}
    </span>
  );
};

const Row = ({ label, value, tone = '' }) => (
  <div className="br-derived-row">
    <span className="br-derived-label">{label}</span>
    <span className={`br-derived-value ${tone ? `br-tone-${tone}` : ''}`}>
      {value || '—'}
    </span>
  </div>
);

export default SanctionFormModal;