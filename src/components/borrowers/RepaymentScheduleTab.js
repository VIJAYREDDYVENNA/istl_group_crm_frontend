// src/components/borrowers/RepaymentScheduleTab.js
//
// The second tab in SanctionFormModal, shown once a sanction has been saved
// at least once this session. Every figure here comes from `view`
// (deriveRepaymentSchedule(form)) — the same live-recalculation contract as
// the "Updates as you type" side panel on the Sanction Details tab, so
// switching tabs after editing a field never shows a stale schedule.
//
// EOMONTH-style instalment dates, per-period repayment percentages and
// interest-capitalization all come from the same engine
// (buildQuarterEndSchedule) that also prices the point DSRA/ISRA figures in
// this summary and the Sanction Details tab — one calculation, so the two
// screens can never silently disagree.

import React, { useEffect, useRef, useState } from 'react';
import { Hourglass, TrendingUp, Info } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { formatCrore, formatDate, parseMoneyCrore, REPAYMENT_FREQUENCIES } from './sanctionDerive';
import { SANCTION_FIELDS as FIELDS } from './sanctionFields';
import Pagination from './Pagination';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const MORATORIUM_OPTIONS = FIELDS.find((f) => f.key === 'interestDuringMoratorium')?.options || [];
export const moratoriumLabel = (value) =>
  MORATORIUM_OPTIONS.find((o) => o.value === value)?.label || value || '—';

export const frequencyLabel = (form) => {
  const found = REPAYMENT_FREQUENCIES.find((f) => f.value === form.repaymentFrequency);
  if (!found) return '—';
  if (found.value === 'OTHER') {
    const n = parseInt(form.repaymentFrequencyOtherMonths, 10);
    return n > 0 ? `Other (every ${n} month${n === 1 ? '' : 's'})` : 'Other (interval not set)';
  }
  return found.label;
};

// A compact label-over-value cell used by both the Primary Loan Information
// grid and the DSRA/ISRA reserve panel's detail columns. span2 gives a value
// two grid tracks instead of one at the 4-up desktop width, for values that
// need the extra room.
export const ScheduleItem = ({ label, value, tone = '', span2 = false }) => (
  <div className={`br-schedule-item${span2 ? ' br-schedule-item-span2' : ''}`}>
    <span className="br-schedule-item-label">{label}</span>
    <span className={`br-schedule-item-value ${tone ? `br-tone-${tone}` : ''}`}>{value || '—'}</span>
  </div>
);

// A balance this close to zero is rounding dust, not a real outstanding
// amount — never displayed as e.g. "-₹0.00 Cr" on the final row.
const ZERO_EPSILON = 1e-6;

// Accepts a value already fully typed, or any prefix of one — "", "-",
// "0", "0.", "0.1" — everything a user's keystrokes pass through on the
// way to a finished decimal. Rejecting anything else (letters, a second
// ".", ...) is what keeps the field from ever showing garbage, without
// needing the committed numeric value to round-trip through every
// keystroke.
const PARTIAL_DECIMAL = /^-?\d*\.?\d*$/;

// Repayment % is a controlled field, but its "true" value is always the
// *recomputed* percentage (this cell's edit redistributes onto the final
// row and comes back through the schedule engine) — displaying that number
// directly, on every keystroke, is what made a decimal point impossible to
// type: the instant you typed "0", the field re-rendered showing the
// number 0, and the next keystroke (".") had nothing to attach to, since
// Number(0) stringifies back to "0" with no trailing dot. This keeps its
// own local text state instead, echoing exactly what's been typed while
// focused, and only resyncs from the real computed value on blur (or when
// it changes from elsewhere, e.g. another row's edit shifting this one) —
// same onChange contract as before, still calling onChange(rawText) on
// every keystroke, just no longer using the recomputed value as the
// field's own displayed text while the user is actively typing it.
const PctInput = ({ value, onChange }) => {
  const display = () => `${Math.round(value * 1e6) / 1e6}`;
  const [text, setText] = useState(display);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(display());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className="br-input br-input-pct"
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(display()); }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '' || PARTIAL_DECIMAL.test(raw)) {
          setText(raw);
          onChange(raw);
        }
      }}
    />
  );
};

// Everything the table body and the Primary Loan Information grid are built
// from — pulled out of the component so the schedule export (PDF/Word/Excel)
// can compute the exact same rows and moratorium figures instead of a second,
// possibly-drifting copy of this logic.
export const buildScheduleData = (view, form) => {
  const schedule = view.schedule || [];
  const debt = parseMoneyCrore(form.debtAmount) ?? parseMoneyCrore(form.sanctionedAmount);
  const capitalized = form.interestDuringMoratorium === 'CAPITALIZED';

  // The interest-only leg of the schedule — every period before the first
  // one that carries a principal instalment. Empty when there's no
  // moratorium at all (repayment begins in the schedule's very first
  // period). Distinguished by repaymentPct being present, not by
  // principalDue === 0 — buildQuarterEndSchedule only ever sets
  // repaymentPct on amortizing periods, regardless of what value it holds,
  // whereas principalDue legitimately reaches exactly 0 on a real
  // amortizing term the reviewer has edited to 0% (or whose principal
  // happens to round to 0.00) — checking principalDue instead would
  // misclassify that term as moratorium: wrong shading, folded into the
  // "Moratorium Period" summary/interest figures, and worst, its Repayment
  // % cell would stop rendering an input at all, locking the reviewer out
  // of ever correcting it back.
  const moratoriumPeriods = schedule.filter((p) => p.repaymentPct === undefined);
  const moratoriumInterest = moratoriumPeriods.reduce((t, p) => t + p.interestDue, 0);
  const moratoriumStart = schedule[0]?.start || null;
  // view.moratoriumEnd (Disbursement Date + Moratorium Period, already a
  // formatted string — see resolveRepaymentWindow) rather than
  // view.repaymentStart: the two can now genuinely differ, since Repayment
  // Start may be a contractual date from the sanction letter that falls
  // later than the moratorium's own nominal end.
  const moratoriumEnd = moratoriumPeriods.length ? view.moratoriumEnd : null;

  // Loan Opening / Closing aren't stored on a Period — reconstructed here by
  // walking the schedule, exactly mirroring what buildQuarterEndSchedule
  // does internally: balance holds flat through the interest-only
  // (principalDue === 0) periods, then — if capitalized — jumps up once by
  // the moratorium's own accrued interest right as the amortizing phase
  // begins, before declining by each period's principal from there.
  // amortIndex additionally tracks each amortizing row's position within
  // the flat repayment-percentage profile array (moratorium rows carry no
  // percentage at all, so they're skipped rather than numbered).
  //
  // termNo/no/periodLabel/periodType exist for the one period that
  // straddles the moratorium boundary — buildQuarterEndSchedule already
  // emits that as two consecutive schedule rows (splitPart: 'moratorium'
  // then 'repayment') rather than creating a new term, so the two need to
  // read as ONE term here too: termNo only advances on the first of the
  // pair (or on any ordinary row), giving "3A"/"3B" (no) and
  // "3 (Part 1)"/"3 (Part 2)" (periodLabel) that both still belong to
  // term 3 — the next ordinary row is still "4", never "5".
  let balance = debt;
  let alreadyCapitalized = false;
  let amortCount = 0;
  let termNo = 0;
  const rows = schedule.map((p, i) => {
    // Same repaymentPct-based test as moratoriumPeriods above, not
    // principalDue > 0 — otherwise capitalizing at the first amortizing
    // period silently skips a row a reviewer has edited to 0%, folding the
    // moratorium interest in one period late instead.
    const isAmortizing = p.repaymentPct !== undefined;
    if (capitalized && isAmortizing && !alreadyCapitalized) {
      balance += moratoriumInterest;
      alreadyCapitalized = true;
    }
    const opening = balance;
    let closing = opening - p.principalDue;
    const last = i === schedule.length - 1;
    if (last && Math.abs(closing) < ZERO_EPSILON) closing = 0;
    balance = closing;
    const amortIndex = isAmortizing ? amortCount++ : null;

    if (p.splitPart !== 'repayment') termNo += 1; // the 'repayment' half reuses the pair's termNo
    const periodType = p.splitPart === 'moratorium' ? 'split-moratorium'
      : p.splitPart === 'repayment' ? 'split-repayment'
        : isAmortizing ? 'repayment' : 'moratorium';
    const no = p.splitPart === 'moratorium' ? `${termNo}A`
      : p.splitPart === 'repayment' ? `${termNo}B`
        : `${termNo}`;
    const periodLabel = p.splitPart === 'moratorium' ? `${termNo} (Part 1)`
      : p.splitPart === 'repayment' ? `${termNo} (Part 2)`
        : `${termNo}`;

    // The moratorium half's own `end` is the split boundary itself (needed
    // for its own day-count), but the "Repayment Date" column must show
    // the SAME date on both halves — the term's actual, final repayment
    // date — since 3A and 3B are one term, not two; the repayment half
    // (immediately next in `schedule`, by construction) already carries
    // that date as its own `end`.
    const displayEnd = p.splitPart === 'moratorium' ? schedule[i + 1].end : p.end;

    return {
      ...p, no, periodLabel, termNo, periodType, isFirstRow: i === 0, displayEnd, opening, closing, amortIndex,
    };
  });

  // One sentence per split term, e.g. "Term 3 is split into two portions:
  // 61 days under Moratorium (Interest Only) and 31 days under Actual
  // Repayment (Principal + Interest)." — day counts always read off the
  // actual rows, never hardcoded, and this is empty (nothing rendered)
  // whenever no term happens to straddle the boundary.
  const splitNotes = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (rows[i].periodType === 'split-moratorium' && rows[i + 1].periodType === 'split-repayment') {
      const morDays = Math.round((rows[i].end.getTime() - rows[i].start.getTime()) / 86400000);
      const repDays = Math.round((rows[i + 1].end.getTime() - rows[i + 1].start.getTime()) / 86400000);
      splitNotes.push(
        `Term ${rows[i].termNo} is split into two portions: ${morDays} day${morDays === 1 ? '' : 's'} under `
        + `Moratorium (Interest Only) and ${repDays} day${repDays === 1 ? '' : 's'} under Actual Repayment `
        + '(Principal + Interest).',
      );
    }
  }

  const totalPct = rows.reduce((t, r) => t + (r.repaymentPct || 0), 0);
  // totalPct alone can no longer catch an invalid allocation: once the
  // final amortizing term is always computed as the residual (100 - sum of
  // every other term), the sum nets to exactly 100 by construction even
  // when that residual is negative — the terms before it were
  // over-allocated, and the "100%" is only true because a negative number
  // absorbed the excess, not because the split is actually valid. The
  // footer's ok/green tone has to check the final term's own sign too, or
  // it keeps reading as "100% ✓" in the exact situation Save is blocked.
  const finalAmortRow = amortCount > 0 ? rows.find((r) => r.amortIndex === amortCount - 1) : null;
  const pctValid = Math.abs(100 - totalPct) < 0.01 && !(finalAmortRow && finalAmortRow.repaymentPct < 0);
  // What the reviewer has actually entered across every OTHER term — the
  // footer shows this against the 100% target instead of totalPct itself,
  // since totalPct always reads exactly 100 by construction (the final
  // term is defined as its residual) and so can never visibly reflect an
  // over-allocation. This can, e.g. "105.00% / 100%" — the whole point.
  const filledPct = finalAmortRow ? totalPct - finalAmortRow.repaymentPct : totalPct;

  const contractualIsra = view.israIsContractual === true ? 'Contractual'
    : view.israIsContractual === false ? 'Not specified in sanction letter — showing calculated interest component of DSRA'
      : '—';

  return {
    schedule, debt, capitalized, moratoriumPeriods, moratoriumInterest,
    moratoriumStart, moratoriumEnd, rows, amortCount, totalPct, pctValid, filledPct, contractualIsra, splitNotes,
  };
};

// Without VIEW_DETAILED_INTEREST_BREAKDOWN, a term that straddles the
// moratorium boundary (rendered elsewhere as two rows — the moratorium leg
// and the repayment leg) is shown as the single ordinary row it logically
// is, with Interest and Total Debt Service equal to the two legs' own
// exact combined amounts (formatCrore displays full precision rather than
// rounding to 2dp of crore, so summing the two legs' raw figures and
// formatting once is both the mathematically correct total and — since
// nothing is truncated along the way — the same figure the two detail
// rows already add up to). Every other figure (opening/closing balance,
// repayment %, DSRA/ISRA, dates) is exactly one leg's already-calculated
// value, not recomputed. Shared by the on-screen table and the PDF/Word/
// Excel exports so a hidden export column can never leak what the table
// itself is hiding.
export const mergeSplitInterestRows = (rows) => {
  const merged = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const next = rows[i + 1];
    if (r.periodType === 'split-moratorium' && next?.periodType === 'split-repayment') {
      merged.push({
        ...next,
        no: `${r.termNo}`,
        periodLabel: `${r.termNo}`,
        periodType: 'repayment',
        start: r.start,
        opening: r.opening,
        isFirstRow: r.isFirstRow || next.isFirstRow,
        principalDue: r.principalDue + next.principalDue,
        interestDue: r.interestDue + next.interestDue,
      });
      i += 1;
    } else {
      merged.push(r);
    }
  }
  return merged;
};

/**
 * @param onProfileChange(jsonString) — called with the full, updated
 *                    per-period percentage profile (as the same JSON string
 *                    shape form.repaymentProfileJson already stores)
 *                    whenever the reviewer edits one period's percentage.
 *                    Only the edited period's value changes — every other
 *                    period keeps exactly what it already had, whether that
 *                    was auto-generated or a previous edit. Repayment % is
 *                    editable here in both "Edit sanction" and "Review what
 *                    was read" — every other field on the review screen is
 *                    already editable before the first save, so this one
 *                    shouldn't be the exception. Ignored when `readOnly`.
 * @param readOnly    true for the page-level, already-saved-sanction display
 *                    (Borrower Detail page) — Repayment % renders as plain
 *                    text instead of an input.
 * @param paginated   true for the page-level display — pages the table body
 *                    instead of relying on the modal's own internal scroll.
 *                    Total Repayment % always reflects every row, not just
 *                    the visible page.
 * @param tableHeading text shown above the table ("Repayment Schedule" by
 *                    default, matching the modal); pass null to omit it when
 *                    an outer wrapper already supplies its own heading.
 */
const RepaymentScheduleTab = ({
  view, form, onProfileChange, readOnly = false, paginated = false, tableHeading = 'Repayment Schedule',
}) => {
  const {
    debt, capitalized, moratoriumPeriods, moratoriumInterest, moratoriumStart, moratoriumEnd,
    rows, amortCount, totalPct, pctValid, filledPct, contractualIsra, splitNotes,
  } = buildScheduleData(view, form);

  // Applies everywhere this component renders — the read-only Borrower
  // Detail view, the editable Sanction Form modal, and that modal's
  // "Review what was read" import-review step alike — since the DSRA/ISRA/
  // interest-breakdown permissions gate the data itself, not just one
  // particular screen showing it.
  const { pagePermissions } = useAuth();
  const showDsra = !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS');
  const showIsra = !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS');
  const showDetailedInterest = !!pagePermissions?.BARROWER?.includes('VIEW_DETAILED_INTEREST_BREAKDOWN');

  const displayRows = showDetailedInterest ? rows : mergeSplitInterestRows(rows);

  // Pages the already-computed rows for display only — every aggregate
  // below (filledPct, amortCount, the Total Repayment % footer) keeps
  // reading the full `rows` array, so paging never changes what those
  // figures show.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const pageCount = paginated ? Math.max(1, Math.ceil(displayRows.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount);
  const pageRows = paginated
    ? displayRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : displayRows;

  // Editing one period leaves every OTHER period exactly as it was (default
  // or previously edited) and recalculates only the final amortizing
  // period as the residual, 100% minus everything before it — never a
  // redistribution across the rest of the schedule. The final period isn't
  // independently editable (see its cell render below), so it's always
  // exactly this residual, the same "last one absorbs the remainder" idea
  // defaultRepaymentPercents uses for the untouched default.
  const handlePctChange = (amortIndex, raw) => {
    if (!onProfileChange) return;
    const n = parseFloat(raw);
    const edited = Number.isFinite(n) ? n : 0;
    const current = rows.filter((r) => r.amortIndex !== null).map((r) => r.repaymentPct);
    const lastIndex = current.length - 1;
    if (lastIndex < 0 || amortIndex === lastIndex) return;
    const updated = [...current];
    updated[amortIndex] = edited;
    let sumOthers = 0;
    for (let i = 0; i < lastIndex; i++) sumOthers += updated[i];
    updated[lastIndex] = 100 - sumOthers;
    onProfileChange(JSON.stringify(updated));
  };

  // Disb. Date alone is called out by name, in plain language, since it's
  // the one field most likely to be the sole blocker (every other required
  // input already has a red * on the form) — "Please select" only reads
  // naturally for a date, so it's not reused for the other single-field
  // cases below. scheduleMissing (sanctionDerive.js) covers every reason
  // the schedule can come back empty, so the last branch here is a safety
  // net that should never actually be seen.
  const missing = view.scheduleMissing || [];
  const emptyMessage = missing.length === 1 && missing[0] === 'Disb. Date'
    ? 'Please select a Disbursement Date to view the Repayment Schedule.'
    : missing.length === 1
      ? `Please provide ${missing[0]} to view the Repayment Schedule.`
      : missing.length
        ? `Please provide the following to view the Repayment Schedule: ${missing.join('; ')}.`
        : 'The repayment schedule could not be generated from the values entered — check the dates on the Sanction Details tab.';

  return (
    <div className="br-schedule-panel">
      <div className="br-schedule-primary">
        <ScheduleItem label="Sanctioned Amount" value={debt !== null ? formatCrore(debt) : null} />
        {/* Always shown, moratorium or not — previously the only place this
            date appeared was folded into "Moratorium Period" below, which
            prints "None — repayment begins immediately" when there's no
            moratorium, so the date just picked on the Sanction Details tab
            would vanish the moment Save lands here on the schedule. */}
        <ScheduleItem label="Disbursement Date" value={formatDate(moratoriumStart)} />
        <ScheduleItem label="Repayment Start Date" value={formatDate(view.repaymentStart)} />
        <ScheduleItem label="Repayment End Date" value={formatDate(view.repaymentEnd)} />
        <ScheduleItem label="ROI" value={view.roi} />
        <ScheduleItem label="Repayment Frequency" value={frequencyLabel(form)} />
        <ScheduleItem label="Interest During Moratorium" value={moratoriumLabel(form.interestDuringMoratorium)} />
        <ScheduleItem
          label="Moratorium Period"
          value={moratoriumPeriods.length
            ? `${formatDate(moratoriumStart)} – ${moratoriumEnd}`
            : 'None — repayment begins immediately'}
        />
      </div>

      <div className="br-schedule-reserve">
        <div className="br-schedule-reserve-col">
          <span className="br-schedule-reserve-heading">Interest Accrued During Moratorium</span>
          <p className="br-schedule-reserve-text">
            {moratoriumPeriods.length
              ? `${formatCrore(moratoriumInterest)} — ${capitalized
                ? 'added to principal at the start of repayment'
                : 'serviced separately, never added to principal'}`
              : '—'}
          </p>
        </div>
        {showDsra && (
          <div className="br-schedule-reserve-col">
            <span className="br-schedule-reserve-heading">DSRA Requirement</span>
            <p className="br-schedule-reserve-text">{form.dsra || '—'}</p>
          </div>
        )}
        {showDsra && (
          <div className="br-schedule-reserve-col">
            <span className="br-schedule-reserve-heading">DSRA Details</span>
            <ScheduleItem
              label="DSRA Amount"
              value={view.dsraAmount}
              tone={view.dsraAmount === 'Not Calculated' ? 'warn' : ''}
            />
            <div className="br-schedule-item-pair">
              <ScheduleItem
                label="Min. DSRA"
                value={view.minDsraAmount}
                tone={view.minDsraAmount === 'Not Calculated' ? 'warn' : ''}
              />
              <ScheduleItem
                label="Max. DSRA"
                value={view.maxDsraAmount}
                tone={view.maxDsraAmount === 'Not Calculated' ? 'warn' : ''}
              />
            </div>
          </div>
        )}
        {showIsra && (
          <div className="br-schedule-reserve-col">
            <span className="br-schedule-reserve-heading">ISRA Details</span>
            <ScheduleItem
              label="ISRA Amount (Calculated)"
              value={view.israAmount}
              tone={view.israAmount === 'Not Calculated' ? 'warn' : ''}
            />
            <ScheduleItem label="Contractual ISRA" value={contractualIsra} />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="br-schedule-empty">
          <p className="br-schedule-empty-text">{emptyMessage}</p>
        </div>
      ) : (
        <div className="br-schedule-table-area">
          {(tableHeading || moratoriumPeriods.length > 0) && (
            <div className="br-schedule-table-heading-row">
              {tableHeading && <h4 className="br-schedule-table-heading">{tableHeading}</h4>}
              {moratoriumPeriods.length > 0 && (
                <span className="br-schedule-moratorium-legend">
                  <Hourglass size={12} className="br-schedule-moratorium-legend-icon" aria-hidden="true" />
                  <span className="br-schedule-moratorium-legend-swatch" aria-hidden="true" />
                  <strong>Moratorium Period</strong> ({formatDate(moratoriumStart)} – {moratoriumEnd})
                </span>
              )}
              {/* Explains the green repayment-row color the moment both
                  colors are actually on screen (a moratorium period AND at
                  least one repayment row) — always shown alongside
                  Moratorium Period above, same as that chip, never gated
                  behind the DSRA/ISRA or detailed-interest-breakdown
                  permissions: it's just naming a row color, not revealing a
                  restricted figure. */}
              {moratoriumPeriods.length > 0 && rows.length > moratoriumPeriods.length && (
                <span className="br-schedule-period-legend-item br-schedule-table-heading-legend-item">
                  <TrendingUp size={13} className="br-period-badge-repayment" aria-hidden="true" />
                  <span className="br-schedule-repayment-swatch" aria-hidden="true" />
                  <strong>Repayment (P+I)</strong> — Principal + Interest
                </span>
              )}
              {/* Only when this schedule actually has a term crossing the
                  boundary — explains the amber split-row color that pairs
                  with the two legend items above in that case, rather than
                  making the reviewer scroll to the bottom legend to learn
                  what the split row they're about to see means. */}
              {showDetailedInterest && splitNotes.length > 0 && (
                <span className="br-schedule-period-legend-item br-schedule-table-heading-legend-item">
                  <span className="br-schedule-split-swatch" aria-hidden="true" />
                  <strong>Partially in Moratorium</strong> — One repayment term crosses the moratorium boundary
                </span>
              )}
            </div>
          )}
          {showDetailedInterest && splitNotes.length > 0 && (
            <div className="br-schedule-split-notes">
              <Info size={13} className="br-schedule-split-notes-icon" aria-hidden="true" />
              <div className="br-schedule-split-notes-text">
                {splitNotes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </div>
          )}
          <div className="br-table-wrap br-scroll-body br-schedule-table-wrap">
            <table className="br-table-list br-schedule-table">
              <thead>
                <tr>
                  <th className="br-center">Period</th>
                  <th className="br-center">Repayment Date</th>
                  <th className="br-right">No. of Days</th>
                  <th className="br-right">Loan Opening</th>
                  <th className="br-right">Repayment %</th>
                  <th className="br-right">Disbursement</th>
                  <th className="br-right">Principal Repayment</th>
                  <th className="br-right">Interest</th>
                  <th className="br-right">Total Debt Service</th>
                  <th className="br-right">Loan Closing</th>
                  {showDsra && <th className="br-right">DSRA Amount</th>}
                  {showIsra && <th className="br-right">ISRA Amount</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const days = Math.round((r.end.getTime() - r.start.getTime()) / 86400000);
                  const rowClass = r.periodType === 'moratorium' ? 'br-schedule-row-moratorium'
                    : r.periodType === 'split-moratorium' || r.periodType === 'split-repayment' ? 'br-schedule-row-split'
                      : 'br-schedule-row-repayment';
                  const isSplitHalf = r.periodType === 'split-moratorium' || r.periodType === 'split-repayment';
                  return (
                    <tr key={r.no} className={rowClass}>
                      <td className={`br-center${isSplitHalf ? ' br-schedule-split-edge' : ''}`}>{r.periodLabel}</td>
                      <td className="br-center">{formatDate(r.displayEnd)}</td>
                      <td className="br-right">{days}</td>
                      <td className="br-right">{formatCrore(r.opening)}</td>
                      <td className="br-right">
                        {r.amortIndex === null ? '—'
                          : (readOnly || r.amortIndex === amortCount - 1)
                            ? (
                              <span className={r.repaymentPct < 0 ? 'br-tone-warn' : ''}>
                                {Math.round(r.repaymentPct * 1e6) / 1e6}%
                              </span>
                            )
                            : (
                              <PctInput
                                value={r.repaymentPct}
                                onChange={(raw) => handlePctChange(r.amortIndex, raw)}
                              />
                            )}
                      </td>
                      <td className="br-right">{r.isFirstRow && debt !== null ? formatCrore(debt) : '—'}</td>
                      <td className="br-right">{formatCrore(r.principalDue)}</td>
                      <td className="br-right">{formatCrore(r.interestDue)}</td>
                      <td className="br-right">{formatCrore(r.principalDue + r.interestDue)}</td>
                      <td className="br-right">{formatCrore(r.closing)}</td>
                      {showDsra && (
                        <td className="br-right">
                          {r.amortIndex !== null && view.dsraByPeriod
                            ? formatCrore(view.dsraByPeriod[r.amortIndex])
                            : (view.dsraAmount || '—')}
                        </td>
                      )}
                      {showIsra && (
                        <td className="br-right">
                          {r.amortIndex !== null && view.israByPeriod
                            ? formatCrore(view.israByPeriod[r.amortIndex])
                            : (view.israAmount || '—')}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {amortCount > 0 && (
                <tfoot>
                  <tr className="br-schedule-total-row">
                    <td colSpan={4}>Total Repayment %</td>
                    <td className={`br-right ${pctValid ? 'br-tone-ok' : 'br-tone-warn'}`}>
                      {/* A correctly-filled schedule always shows a plain
                          100% — totalPct is exactly 100 by construction
                          whenever the final term is a sensible value, so
                          this is both true and the expected reading.
                          filledPct (sum of every editable term, excluding
                          the auto-computed final one) only takes over when
                          something's actually wrong — e.g. "110.00% /
                          100%" once the terms before the last one have
                          been over-allocated past 100%. */}
                      {pctValid
                        ? `${Math.round(totalPct * 100) / 100}%`
                        : `${(Math.round(filledPct * 100) / 100).toFixed(2)}% / 100%`}
                    </td>
                    <td colSpan={5 + (showDsra ? 1 : 0) + (showIsra ? 1 : 0)} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {paginated && displayRows.length > 0 && (
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalRows={displayRows.length}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default RepaymentScheduleTab;
