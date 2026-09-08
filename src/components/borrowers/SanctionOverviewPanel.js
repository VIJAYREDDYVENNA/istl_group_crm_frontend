// src/components/borrowers/SanctionOverviewPanel.js
//
// One sanction's full read-only picture, as independently reusable pieces —
// the Sanction Details card, the Derived Values card, and the Repayment
// Schedule section (plus a document strip card, DocumentCard, kept here as a
// self-contained document-actions component even though Entity Detail
// currently renders those actions per-row in its Sanction Letters table
// instead) — extracted out of BorrowerDetail.js so Entity Detail's Overview
// tab (which lays the identity card alongside these in one grid) never
// drifts from how a sanction's own figures are calculated or displayed.
// Nothing here owns data: every action (open/download/replace/attach the
// document) is a callback prop, and every piece of state that needs to
// survive a click (the attach-and-compare flow, the edit modal, the delete
// confirm) stays with whichever page renders these. Only presentational
// "show all"/"expand" toggles live in here, since those never need to be
// seen outside one card instance.

import React, { useEffect, useRef, useState } from 'react';
import {
  FileText, Eye, Download, Paperclip, ChevronDown, ChevronUp,
  FileSpreadsheet, FileType2,
} from 'lucide-react';
import { BsInfoCircle } from 'react-icons/bs';
import borrowerApi from '../../services/borrowerApi';
import { useAuth } from '../../hooks/useAuth';
import RepaymentScheduleTab from './RepaymentScheduleTab';
import { SANCTION_FIELDS } from './sanctionFields';
import { REPAYMENT_FREQUENCIES } from './sanctionDerive';
import { exportSchedulePDF, exportScheduleWord, exportScheduleExcel } from './scheduleExport';

// Field/row keys that carry DSRA or ISRA detail — hidden from the read-only
// Sanction Details / Derived Values cards for a user without the matching
// VIEW_DSRA_DETAILS / VIEW_ISRA_DETAILS permission. The underlying sanction
// record and its calculations are untouched; only these cards' row lists
// are filtered before rendering.
export const DSRA_DETAIL_KEYS = new Set(['dsra', 'dsraAmount', 'derivedDsraAmount']);
export const ISRA_DETAIL_KEYS = new Set(['isra', 'israAmount', 'derivedIsraAmount']);

// Free-text covenant fields read as sentences, not numbers — left-aligning
// just these keeps every other field's right-aligned number/date look intact.
export const LEFT_ALIGN_KEYS = new Set(['cashSweep', 'dsra', 'isra']);

// Compact-card default: how many already-filled fields a Sanction Details /
// Derived Values card shows before "show all" is needed.
const CARD_ROW_CAP = 7;

// ROI (detailHidden) doesn't get its own row here — it's stitched onto the
// front of "Rate of interest" instead (see the interestRateText special case
// below), since SanctionFormModal strips the percentage out of that field on
// import specifically so it isn't typed twice across the two form fields.
const DETAIL_FIELDS = SANCTION_FIELDS.filter((f) => !f.detailHidden);

export const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/** Same friendly labelling the sanction form's dropdown uses, for the read-only view. */
const repaymentFrequencyLabel = (active) => {
  const found = REPAYMENT_FREQUENCIES.find((f) => f.value === active.repaymentFrequency);
  if (!found) return active.repaymentFrequency;
  if (found.value === 'OTHER') {
    const n = parseInt(active.repaymentFrequencyOtherMonths, 10);
    return n > 0 ? `Other (every ${n} month${n === 1 ? '' : 's'})` : found.label;
  }
  return found.label;
};

/** The derived panel, as data — so it can be filtered like the card beside it. */
export const DERIVED_ROWS = [
  { key: 'derivedEquityContribution', label: 'Equity contribution' },
  { key: 'derivedMoratoriumEnd', label: 'Moratorium ends' },
  { key: 'derivedRepaymentStart', label: 'Repayment starts (modelled)' },
  { key: 'derivedRepaymentEnd', label: 'Repayment ends (modelled)' },
  { key: 'derivedTotalTenorMonths', label: 'Total tenor' },
  { key: 'derivedFirstYearInterest', label: 'First-year interest' },
  { key: 'derivedDsraAmount', label: 'DSRA (calculated)', tone: (v) => (v === 'Not Calculated' ? 'warn' : '') },
  { key: 'derivedIsraAmount', label: 'ISRA (calculated)', tone: (v) => (v === 'Not Calculated' ? 'warn' : '') },
  { key: 'derivedSanctionValidTill', label: 'Sanction valid till' },
  { key: 'derivedCodStatus', label: 'COD status' },
];

export const statusLabel = (s) => ({
  DRAFT: 'Draft',
  IMPORTED: 'Imported',
  REVIEW: 'Review',
  ONBOARDED: 'Onboarded',
}[s] || s || '—');

export const sourceLabel = (s) => ({
  MANUAL: 'Entered manually',
  IMPORTED: 'Imported',
  IMPORTED_EDITED: 'Imported, edited',
}[s] || s);

export const Row = ({
  label, value, strong = false, tone = '', empty = '—',
  mono = false, icon = null, align = '', caption = null,
}) => (
  <div className="br-dl-row">
    <dt className="br-dl-label">
      {icon && <span className="br-dl-icon">{icon}</span>}
      {label}
    </dt>
    <dd className={[
      'br-dl-value',
      strong ? 'br-strong' : '',
      mono && value ? 'br-mono' : '',
      value ? (tone ? `br-tone-${tone}` : '') : 'br-muted',
      align === 'left' ? 'brx-dl-value-left' : '',
    ].filter(Boolean).join(' ')}>
      {value || empty}
      {value && caption && <span className="br-dl-caption">{caption}</span>}
    </dd>
  </div>
);

/** The "N of M fields available — show all" / "Hide empty fields" link under a compact card's row list. */
export const ExpandToggle = ({ expanded, onToggle, filledCount, totalCount }) => (
  <button type="button" className="br-link br-link-block" onClick={onToggle}>
    {expanded ? (
      <>Hide empty fields <ChevronUp size={13} aria-hidden="true" /></>
    ) : (
      <>{filledCount} of {totalCount} fields available — show all <ChevronDown size={13} aria-hidden="true" /></>
    )}
  </button>
);

// Export button for the Repayment Schedule card — picks PDF / Word / Excel,
// closing on an outside click same as any other small popover menu here.
export const ScheduleExportMenu = ({ view, form, meta }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { pagePermissions } = useAuth();
  const perm = {
    showDsra: !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS'),
    showIsra: !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS'),
    showDetailedInterest: !!pagePermissions?.BARROWER?.includes('VIEW_DETAILED_INTEREST_BREAKDOWN'),
  };

  useEffect(() => {
    const onOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const pick = (fn) => { setOpen(false); fn(view, form, meta, perm); };

  return (
    <div className="br-export-menu" ref={ref}>
      <button
        type="button"
        className="br-btn br-btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download size={14} aria-hidden="true" />
        Export
      </button>
      {open && (
        <div className="br-export-menu-panel" role="menu">
          <button type="button" role="menuitem" onClick={() => pick(exportSchedulePDF)}>
            <FileType2 size={14} aria-hidden="true" />
            PDF (A4)
          </button>
          <button type="button" role="menuitem" onClick={() => pick(exportScheduleWord)}>
            <FileText size={14} aria-hidden="true" />
            Word (A4)
          </button>
          <button type="button" role="menuitem" onClick={() => pick(exportScheduleExcel)}>
            <FileSpreadsheet size={14} aria-hidden="true" />
            Excel
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Every SANCTION_FIELDS row, shaped to its display value exactly as the
 * "Sanction details" card always has (borrowerName's borrower fallback, the
 * combined ROI + interest-terms sentence, the planned-COD-until-actual
 * fallback, the moratorium/repayment-frequency labels), DSRA/ISRA-permission
 * filtered — but WITHOUT the card's own cap/expand/section-flattening, so a
 * caller that wants these grouped into their own SANCTION_FIELDS `group`
 * bands (SanctionDetailView's per-section rendering) can do so without
 * re-deriving any of these values itself.
 */
export const buildDetailRows = (borrower, sanction, { hasDsraPermission = false, hasIsraPermission = false } = {}) => {
  if (!sanction) return [];
  return DETAIL_FIELDS.map((f) => ({
    ...f,
    value: f.key === 'borrowerName'
      ? (sanction[f.key] || borrower?.borrowerName)
      : f.key === 'interestRateText'
        ? [sanction.roiPct, sanction.interestRateText].filter((v) => !isBlank(v)).join(' ')
        // Until a real Actual COD Date is entered, the planned date stands
        // in for it (see SanctionDerivedCalculator).
        : f.key === 'actualCod'
          ? sanction.derivedActualCod
          : f.key === 'interestDuringMoratorium'
            ? (sanction[f.key] === 'CAPITALIZED' ? 'Interest Capitalized'
              : sanction[f.key] === 'SERVICED' ? 'Interest Served' : sanction[f.key])
            : f.key === 'repaymentFrequency'
              ? repaymentFrequencyLabel(sanction)
              : sanction[f.key],
  })).filter((f) => (
    (hasDsraPermission || !DSRA_DETAIL_KEYS.has(f.key))
    && (hasIsraPermission || !ISRA_DETAIL_KEYS.has(f.key))
  ));
};

/** The "Sanction details" card — every field on the letter, in sheet order. */
export const SanctionDetailsCard = ({ borrower, sanction }) => {
  const [expanded, setExpanded] = useState(false);
  const { pagePermissions } = useAuth();
  const hasDsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS');
  const hasIsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS');
  if (!sanction) {
    return (
      <section className="br-card">
        <header className="br-card-head">
          <span className="br-dot br-dot-read" aria-hidden="true" />
          <h2 className="br-card-title">Sanction details</h2>
        </header>
        <p className="br-muted">These fill in once a sanction is recorded.</p>
      </section>
    );
  }
  const allRows = buildDetailRows(borrower, sanction, { hasDsraPermission, hasIsraPermission });
  const filledRows = allRows.filter((f) => !isBlank(f.value));
  const visibleRows = expanded ? allRows : filledRows.slice(0, CARD_ROW_CAP);
  const canToggle = expanded || filledRows.length > CARD_ROW_CAP || filledRows.length < allRows.length;
  return (
    <section className="br-card">
      <header className="br-card-head">
        <span className="br-dot br-dot-read" aria-hidden="true" />
        <h2 className="br-card-title">Sanction details</h2>
        {sanction.source && <span className="br-chip">{sourceLabel(sanction.source)}</span>}
      </header>
      <dl className="br-dl br-scroll-body">
        {visibleRows.map((f) => (
          <Row
            key={f.key}
            label={f.label}
            value={f.value}
            strong={f.key === 'sanctionedAmount'}
            mono={f.mono}
            align={LEFT_ALIGN_KEYS.has(f.key) ? 'left' : ''}
            caption={f.hint}
          />
        ))}
      </dl>
      {canToggle && (
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          filledCount={filledRows.length}
          totalCount={allRows.length}
        />
      )}
    </section>
  );
};

/** The "Derived values" card — every figure the app works out on its own. */
export const DerivedValuesCard = ({ sanction }) => {
  const [expanded, setExpanded] = useState(false);
  const { pagePermissions } = useAuth();
  const hasDsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS');
  const hasIsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS');
  const derivedRows = DERIVED_ROWS.filter((d) => (
    (hasDsraPermission || !DSRA_DETAIL_KEYS.has(d.key))
    && (hasIsraPermission || !ISRA_DETAIL_KEYS.has(d.key))
  ));
  if (!sanction) {
    return (
      <section className="br-card">
        <header className="br-card-head">
          <span className="br-dot br-dot-calc" aria-hidden="true" />
          <h2 className="br-card-title">Derived values</h2>
        </header>
        <p className="br-muted">These fill in once a sanction is recorded.</p>
      </section>
    );
  }
  const filledRows = derivedRows.filter((d) => !isBlank(sanction[d.key]));
  const visibleRows = expanded ? derivedRows : filledRows.slice(0, CARD_ROW_CAP);
  const canToggle = expanded || filledRows.length > CARD_ROW_CAP || filledRows.length < derivedRows.length;
  return (
    <section className="br-card">
      <header className="br-card-head">
        <span className="br-dot br-dot-calc" aria-hidden="true" />
        <h2 className="br-card-title">Derived values</h2>
      </header>
      <dl className="br-dl br-scroll-body">
        {visibleRows.map((d) => (
          <Row key={d.key} label={d.label} value={sanction[d.key]} tone={d.tone ? d.tone(sanction[d.key]) : ''} />
        ))}
        {filledRows.length === 0 && (
          <p className="br-muted br-dl-note">
            Nothing to work these out from yet. They fill in as the
            amounts, rate and dates are recorded.
          </p>
        )}
      </dl>
      {canToggle && (
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          filledCount={filledRows.length}
          totalCount={derivedRows.length}
        />
      )}
    </section>
  );
};

/** The document strip — view / download / replace / attach the stored letter. */
export const DocumentCard = ({ sanction, onOpenDocument, onStartAttach, attaching }) => {
  if (!sanction) {
    return (
      <section className="br-card">
        <header className="br-card-head"><h2 className="br-card-title">Sanction letter</h2></header>
        <p className="br-muted">Nothing to show until a sanction is recorded.</p>
      </section>
    );
  }
  return (
    <section className="br-card">
      <header className="br-card-head">
        <h2 className="br-card-title">Sanction letter</h2>
      </header>
      <div className="br-docstrip br-docstrip-inset">
        <FileText size={20} className="br-docstrip-icon" aria-hidden="true" />
        <div className="br-docstrip-text">
          <strong>{sanction.hasDocument ? 'Sanction letter' : 'No letter attached'}</strong>
          <span>
            {sanction.hasDocument ? (
              <>
                {sanction.sanctionDocName}
                {sanction.sanctionDocSize ? ` · ${Math.round(sanction.sanctionDocSize / 1024)} KB` : ''}
              </>
            ) : (
              'Attach the letter and its values will be checked against this record.'
            )}
          </span>
        </div>
        <div className="br-docstrip-actions">
          {sanction.hasDocument ? (
            <>
              <button type="button" className="br-btn br-btn-sm" onClick={onOpenDocument}>
                <Eye size={14} aria-hidden="true" />
                View
              </button>
              <button
                type="button"
                className="br-btn br-btn-sm"
                onClick={() => borrowerApi.downloadDocFile(sanction.id, sanction.sanctionDocName)}
              >
                <Download size={14} aria-hidden="true" />
                Download
              </button>
            </>
          ) : (
            <button type="button" className="br-btn br-btn-sm br-btn-primary" onClick={onStartAttach} disabled={attaching}>
              <Paperclip size={14} aria-hidden="true" />
              {attaching ? 'Reading…' : 'Attach letter'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

/**
 * The Repayment Schedule section — info popover, export menu, the full
 * instalment table. `scheduleView` is `deriveRepaymentSchedule(sanction)`,
 * computed by the caller so this component never needs to know about
 * sanctionDerive.js itself. `termScheduleViews` (also caller-computed, via
 * sanctionDerive's buildTermScheduleViews) is one such view per Sanction
 * Term — when the sanction has any, a Term dropdown picks which one this
 * section shows, same as SanctionFormModal's own Repayment Schedule tab;
 * `scheduleView` alone still covers a sanction saved before Sanction Terms
 * existed, so no sanction ever renders with nothing here.
 */
export const RepaymentScheduleSection = ({
  borrower, sanction, scheduleView, termScheduleViews = [],
}) => {
  const [expanded, setExpanded] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [selectedTermIndex, setSelectedTermIndex] = useState(0);
  if (!sanction || !scheduleView) {
    return (
      <section className="br-card br-schedule-section">
        <header className="br-card-head br-schedule-section-head">
          <span className="br-dot br-dot-schedule" aria-hidden="true" />
          <h2 className="br-card-title">Repayment schedule</h2>
        </header>
        <p className="br-muted">Nothing to show until a sanction is recorded.</p>
      </section>
    );
  }
  const terms = sanction.terms || [];
  const hasTerms = terms.length > 0;
  const i = hasTerms ? Math.min(selectedTermIndex, terms.length - 1) : -1;
  const activeTerm = hasTerms ? terms[i] : null;
  const activeView = hasTerms ? termScheduleViews[i] : scheduleView;
  const activeForm = hasTerms
    ? { ...sanction, disbursementDate: activeTerm.actualDisbursementDate, debtAmount: activeTerm.termLimit }
    : sanction;
  return (
    <section className="br-card br-schedule-section">
      <header className="br-card-head br-schedule-section-head">
        <span className="br-dot br-dot-schedule" aria-hidden="true" />
        <h2 className="br-card-title">Repayment schedule</h2>
        {expanded && terms.length > 1 && (
          <div className="br-term-schedule-heading br-schedule-term-picker">
            <select
              className="br-input br-term-schedule-select"
              value={i}
              onChange={(e) => setSelectedTermIndex(Number(e.target.value))}
            >
              {terms.map((t, idx) => (
                <option key={idx} value={idx}>
                  {`Term ${idx + 1}`}{t.facilityType ? ` — ${t.facilityType}` : ''}
                </option>
              ))}
            </select>
            <span className="br-term-schedule-title">
              Term {i + 1}
              {activeTerm.facilityType ? ` — ${activeTerm.facilityType}` : ''}
            </span>
          </div>
        )}
        <span className="br-schedule-header-spacer" aria-hidden="true" />
        <span className="br-info-wrap">
          <button
            type="button"
            className="br-info-btn"
            onClick={() => setShowInfo((v) => !v)}
            aria-label="About this section"
            aria-expanded={showInfo}
          >
            <BsInfoCircle size={14} aria-hidden="true" />
          </button>
          {showInfo && (
            <div className="br-info-popover" role="tooltip">
              Computed from the sanction details, ROI, repayment frequency, moratorium
              and DSRA/ISRA requirement recorded above — not a separate source of truth.
            </div>
          )}
        </span>
        <div className="br-schedule-section-actions">
          <ScheduleExportMenu
            view={activeView}
            form={activeForm}
            meta={{ borrowerName: borrower?.borrowerName, refNo: sanction.refNo }}
          />
          <button
            type="button"
            className="br-icon-btn"
            aria-label={expanded ? 'Collapse repayment schedule' : 'Expand repayment schedule'}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {expanded && (
        <RepaymentScheduleTab view={activeView} form={activeForm} readOnly paginated tableHeading={null} />
      )}
    </section>
  );
};

