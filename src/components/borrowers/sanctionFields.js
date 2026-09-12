// src/components/borrowers/sanctionFields.js
//
// Every field on a sanction letter, in the order the lender's registry sheet
// prints them. One array, four consumers — SanctionFormModal, SanctionCompareModal,
// BorrowerDetail and the registry table — so adding a column is one line here
// rather than four edits that drift apart.
//
// Per entry:
//   key         wrapper property name, identical on the Java DTO
//   group       the sheet's header band; drives form sections and table groups
//   label       exactly as the sheet prints it
//   kind        text | money | pct | multiple | date | ratio | select — how
//               the value is compared and what unit hint the form shows.
//               Inputs stay type="text" regardless (select is a real
//               <select>); see the note at the bottom.
//   suffix      unit hint rendered beside the input
//   align       'right' for numerics in the registry table
//   width       column width in the registry table, px
//   readOnly    the form shows this field but never as a typeable box — its
//               value is always worked out from others (e.g. roiPct)
//   derivedKey  for a readOnly field, the deriveSanction() output property
//               its display value comes from
//   persisted   false excludes a field from the save payload entirely — for
//               a readOnly field with no entity column of its own (e.g. the
//               calculated DSRA/ISRA amounts). Defaults to true.
//   displayOnly the form shows this field's own loaded value but never as a
//               typeable box — unlike readOnly, its value comes straight from
//               form/initial, not a deriveSanction() calculation. For a
//               borrower-level value (e.g. CIN) shown here for context that
//               this form doesn't own and has no path to persist.
//   editableOnImport combined with displayOnly: true, the field is a typeable
//               box only in mode="import" (SanctionFormModal checks this
//               against its own `mode` prop) — a one-time chance to correct
//               a misread borrower-identity value before/as it's first
//               written — sent as part of the same saveSanction() call, not
//               a separate one, so the correction and the sanction commit
//               or fail together. Stays locked in create/edit mode, where
//               correcting an already-established borrower's identity
//               belongs on its own Identity screen, not here.
//   options     for kind: 'select' — [{ value, label }] shown in the dropdown
//   formLabel   overrides `label` on the sanction form only — the detail
//               page and registry table keep showing `label`
//   hint        short caption explaining what the value means (e.g. which
//               period it covers); shown under the value on the sanction
//               form and the detail page, never in the registry table
//   textarea    render as a multi-line box on the sanction form instead of
//               a single-line input — for a value long enough to need
//               wrapping (a full clause, not a phrase)
//   rows        textarea row count on the sanction form — defaults to 3 when
//               omitted; only worth overriding for a field whose values run
//               noticeably longer than the rest (e.g. Cash Sweep)
//   normalize   (v) => v — reshapes every keystroke before it lands in form
//               state, same convention as borrowerFields.js (e.g. toCin).
//   maxLength   HTML maxlength on the typeable box, alongside normalize —
//               belt-and-braces so a value can't grow past it either way.

import { REPAYMENT_FREQUENCIES } from './sanctionDerive';
import { toCin } from './borrowerFields';

// The registry's fixed facility-type vocabulary — mirrors the backend's own
// SanctionDocExtractor.INSTRUMENT_CANON exactly (same values), so whatever a
// letter's Instrument auto-fill picked always lands on a real option here.
// Shared, one definition, by both the Product section's Instrument dropdown
// and the Sanction Terms table's own Facility Type column.
export const FACILITY_TYPE_OPTIONS = [
  { value: '', label: 'Select' },
  { value: 'Term Loan', label: 'Term Loan' },
  { value: 'FCTL', label: 'Foreign Currency Term Loan (FCTL)' },
  { value: 'ECB', label: 'External Commercial Borrowing (ECB)' },
  { value: 'NCD', label: 'Non-Convertible Debenture (NCD)' },
  { value: 'Bridge Loan', label: 'Bridge Loan' },
  { value: 'Bank Guarantee', label: 'Bank Guarantee' },
  { value: 'LC', label: 'Letter of Credit (LC)' },
  { value: 'Cash Credit', label: 'Cash Credit' },
  { value: 'Overdraft (OD)', label: 'Overdraft (OD)' },
  { value: 'Letter of Comfort (LoC)', label: 'Letter of Comfort (LoC)' },
  { value: 'Working Capital Loan', label: 'Working Capital Loan' },
];

// Sanction Terms table row label — Term 1 is always "Fund Based Limit",
// every term after it is "Non Fund Based Limit - <roman numeral>" (I, II,
// III, ...), derived purely from the term's own array position so it
// updates automatically as terms are added/removed. Never stored — same
// "computed on every render" treatment as % of Limit above.
const toRoman = (num) => {
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let n = num;
  let out = '';
  table.forEach(([value, symbol]) => {
    while (n >= value) { out += symbol; n -= value; }
  });
  return out;
};
export const getSanctionLimitLabel = (index) => (
  index === 0 ? 'Fund Based Limit' : `Non Fund Based Limit - ${toRoman(index)}`
);

// Declaration order below drives the section-nav order in SanctionFormModal
// (via sanctionFieldGroups()) — 01 Number … 12 Additional Information, with
// Sanction Terms/Derived Values/Status inserted between these FIELDS-backed
// groups by SanctionFormModal itself (they have no scalar fields of their
// own: Sanction Terms is the `terms` array/SanctionTermsCard, Derived Values
// is computed by deriveSanction, Status is the sanction's status/source).
export const SANCTION_FIELDS = [
  // ── 01 Number ──
  // The registry sheet heads this column "SL Ref. No"; the letter calls it the
  // reference number. One field, labelled for wherever it is being read.
  { key: 'refNo', group: 'Number', label: 'Reference number', required: true,
    kind: 'text', placeholder: 'VIFL/PF/2025/1007', width: 160, mono: true },

  // ── 02 Borrower Details (letter-level, mirrored onto the borrower on save) ──
  { key: 'borrowerName', group: 'Borrower Details', label: 'Borrower', required: true,
    kind: 'text', placeholder: 'Company name in full', width: 220 },
  { key: 'lenderName', group: 'Borrower Details', label: 'Lender',
    kind: 'text', placeholder: 'Vindhya Infra Finance Ltd.', width: 180 },
  // Borrower-owned, not a sanction column — mirrored in from BorrowerEntity.cin
  // (via BorrowerService.toWrapper for edit mode, or straight from the parsed
  // letter for import mode). persisted: false keeps it out of the *sanction*
  // fields in the save payload — a correction rides along as the separate
  // identityCin key on the same saveSanction() call instead (see handleSave),
  // applied to the borrower in the same backend transaction as the sanction
  // itself. editableOnImport: only this one review, right after a fresh
  // extraction, gets a typeable box; an established borrower's CIN is
  // corrected on its own Identity details, not through a sanction.
  { key: 'cin', group: 'Borrower Details', label: 'CIN',
    kind: 'text', mono: true, placeholder: 'Not on file', width: 180,
    persisted: false, displayOnly: true, editableOnImport: true,
    normalize: toCin, maxLength: 21,
    hint: "The borrower's own CIN, from its company record." },
  { key: 'projectName', group: 'Borrower Details', label: 'Project',
    kind: 'text', placeholder: '50 MWac ground-mounted solar', width: 200 },
  // Borrower-owned, not a sanction column — same treatment as `cin` above.
  // Deliberately NOT bound to borrower_sanctions.location: that's a
  // separate, genuinely independent per-sanction/project value (it can
  // legitimately differ from the borrower's own registered address) and is
  // left untouched by this — nothing here reads it or writes to it.
  { key: 'registeredAddress', group: 'Borrower Details', label: 'Registered Address',
    kind: 'text', placeholder: 'Not provided', width: 160,
    persisted: false, displayOnly: true, editableOnImport: true,
    hint: "The borrower's own registered address, from its company record." },
  // No longer shown in the form — it was confusingly displayed as "Location"
  // under Borrower Details, but is genuinely a separate, independent
  // per-sanction/project value (BorrowerSanctionEntity.location) that can
  // legitimately differ from the borrower's own Registered Address above,
  // and has no other consumer anywhere in the app today. formHidden only
  // drops it from the rendered grid — it stays in FIELDS/the save payload
  // so an existing sanction's stored value keeps round-tripping unchanged
  // (applySanction() sets it unconditionally on every save; dropping this
  // key entirely would silently null out whatever was already saved there
  // the next time someone edits and re-saves that sanction).
  { key: 'location', group: 'Borrower Details', label: 'Project Location',
    kind: 'text', width: 160, formHidden: true },

  // ── 03 Project Details ──
  // Group / Sub Group: rendered by TechnologyGroupDropdowns (SanctionFormModal),
  // not the generic field loop — formHidden keeps them out of it while still
  // participating in EMPTY/load/save via the FIELDS-driven reduce.
  { key: 'projectGroup', group: 'Project Details', label: 'Category',
    kind: 'text', formHidden: true },
  { key: 'projectSubGroup', group: 'Project Details', label: 'Sub Category',
    kind: 'text', formHidden: true },

  // State is the borrower's, not the sanction's — the registry column reads it
  // off the borrower row, so there is no field for it here.
  { key: 'technology', group: 'Project Details', label: 'Technology',
    kind: 'text', textarea: true, wide: true, placeholder: 'Solar PV', width: 300 },

  // ── 04 Project Cost & Finance ──
  // Money is quoted in crore on this sheet, so the inputs say so and a bare
  // number scales. An explicit unit still wins.
  { key: 'projectCost', group: 'Project Cost & Finance', label: 'Project Cost',
    kind: 'money', placeholder: '205.00', suffix: 'in ₹ Cr', align: 'right', width: 120 },
  { key: 'debtAmount', group: 'Project Cost & Finance', label: "Debt (Rs. Cr's)",
    kind: 'money', placeholder: '153.75', suffix: 'in ₹ Cr', align: 'right', width: 120 },
  { key: 'equityAmount', group: 'Project Cost & Finance', label: "Equity (Rs. Cr's)",
    kind: 'money', placeholder: '51.25', suffix: 'in ₹ Cr', align: 'right', width: 130 },
  { key: 'debtPct', group: 'Project Cost & Finance', label: 'Debt (%)',
    kind: 'pct', placeholder: '75', align: 'right', width: 90 },
  { key: 'equityPct', group: 'Project Cost & Finance', label: 'Equity (%)',
    kind: 'pct', placeholder: '25', align: 'right', width: 100 },
  { key: 'sanctionedAmount', group: 'Project Cost & Finance', label: 'Sanctioned amount',
    required: true, kind: 'money', placeholder: '153.75', suffix: 'in ₹ Cr',
    align: 'right', width: 140, listHidden: true },
  { key: 'debtEquityRatio', group: 'Project Cost & Finance', label: 'Debt : equity',
    kind: 'ratio', placeholder: '75:25', width: 110, listHidden: true },

  // ── 05 Product ──
  // Options mirror the backend's own fixed vocabulary — SanctionDocExtractor
  // (INSTRUMENT_CANON) only ever auto-fills one of these exact strings, so
  // whatever the letter picked always lands on a real option here, selected
  // by default; a blank first option covers a letter that named none of them.
  // Shared with the Sanction Terms table's own Facility Type column (rendered
  // in the 06 Sanction Terms section, right after this one) — one
  // definition, so the two dropdowns can never drift apart.
  { key: 'limitAmount', group: 'Product', label: 'Limit',
    required: true, kind: 'money', placeholder: '270.04', suffix: 'in ₹ Cr',
    align: 'right', width: 140,
    hint: 'Auto-filled from Debt amount. This is the total sanctioned limit.' },
  { key: 'instrument', group: 'Product', label: 'Instrument',
    kind: 'select', width: 190,
    options: FACILITY_TYPE_OPTIONS },

  // ── 07 Interest & Repayment ──
  // Base Rate and Spread default their box to "0" (via placeholder, not a
  // real stored value) rather than sitting empty — see the placeholder note
  // on each. A blank box still parses to null, so a letter that states a
  // fixed rate with no base/spread breakdown at all is never zeroed out by
  // this default; it only takes effect once both are genuinely known.
  { key: 'baseRatePct', group: 'Interest & Repayment', label: 'Base Rate (%)',
    kind: 'pct', placeholder: '0', align: 'right', width: 100 },
  { key: 'spreadPct', group: 'Interest & Repayment', label: 'Spread (%)',
    kind: 'pct', placeholder: '0', align: 'right', width: 90 },
  // Not a box to type into — its value is always worked out: Base Rate +
  // Spread once both are known (even overriding a figure the letter states
  // separately, flagged via the reconcile check below rather than trusted
  // outright), else whatever the letter states directly. Kept out of the
  // borrower detail page — Rate of interest already carries the number in
  // full there — but shown here, read-only, since this is where Base
  // Rate/Spread are actually entered and the resulting rate needs to be
  // visible as they change. Still shown as its own column in the registry
  // table, under its usual "ROI" heading — `formLabel` only changes what the
  // sanction form itself calls it, not the table or the detail page.
  { key: 'roiPct', group: 'Interest & Repayment', label: 'ROI', formLabel: 'Rate of Interest (%)',
    kind: 'pct', placeholder: '9.75', align: 'right', width: 90,
    readOnly: true, detailHidden: true, derivedKey: 'roi' },
  // The letter's own wording — kept as the full sentence rather than having
  // the rate number surgically cut out of it, so the original phrasing stays
  // intact for anyone checking this against the document itself. Still
  // labelled "Rate of interest" on the detail page; `formLabel` only renames
  // it on the sanction form, next to the new Rate of Interest (%) figure,
  // where the two sitting side by side under the same name would be confusing.
  { key: 'interestRateText', group: 'Interest & Repayment', label: 'Rate of interest',
    formLabel: 'Interest Terms',
    kind: 'text', placeholder: 'p.a. (floating, linked to 1-yr MCLR + spread)',
    width: 200, listHidden: true },
  // Tentative/Actual Disb. Date used to live here as their own boxes. They
  // now live on Sanction Terms instead — Term 1 carries exactly the same two
  // dates, same behavior/validation/repayment-schedule logic, just per-term
  // rather than one shared pair — see SanctionFormModal's withDerivedTerm1
  // and SanctionTermsCard. Removed from here entirely (not just hidden) so
  // there's no duplicate disbursement-date field anywhere in this group;
  // `disbursementDate`/`tentativeDisbursementDate` still exist as plain
  // (non-FIELDS) `form` keys in SanctionFormModal, kept in sync from Term 1,
  // since every other derived calculation (deriveSanction,
  // resolveRepaymentWindow, the "Updates as you type" panel, the backend's
  // own validateSanction) already reads those exact field names and is
  // deliberately left untouched.
  { key: 'tenorText', group: 'Interest & Repayment', label: 'Tenor',
    kind: 'text', placeholder: '16 years including moratorium of 6 months', width: 300 },
  // Some letters state Tenor and Moratorium as two separate clauses instead
  // of one combined sentence ("Tenor: 204 months ... inclusive of
  // moratorium" / "Moratorium: 6 months..."). This box carries that count
  // when the letter split it out — see the equivalent precedence in
  // resolveRepaymentWindow (sanctionDerive.js) and BorrowerService (Java):
  // an explicit value here always wins over what would otherwise be parsed
  // out of the Tenor text. Blank simply falls back to that parse, exactly
  // as every record before this field existed already behaves.
  { key: 'moratoriumMonths', group: 'Interest & Repayment', label: 'Moratorium (Months)',
    kind: 'text', placeholder: 'e.g. 6', width: 150, listHidden: true,
    hint: 'Only needed when the letter states Tenor and Moratorium separately — overrides what would otherwise be parsed out of the Tenor text above.' },
  { key: 'interestDuringMoratorium', group: 'Interest & Repayment', label: 'Interest During Moratorium',
    kind: 'select', width: 190,
    options: [
      { value: 'SERVICED', label: 'Interest Served' },
      { value: 'CAPITALIZED', label: 'Interest Capitalized' },
    ],
    hint: 'How interest accrued during the moratorium is treated once repayment begins.' },
  // Drives the interval between generated repayment dates (see
  // REPAYMENT_FREQUENCIES/repaymentFrequencyMonths in sanctionDerive.js) —
  // defaults to Quarterly, the interval every schedule used before this
  // field existed, so a record that predates it keeps generating the same
  // schedule it always did.
  { key: 'repaymentFrequency', group: 'Interest & Repayment', label: 'Repayment Frequency',
    kind: 'select', width: 190, listHidden: true, defaultValue: 'QUARTERLY',
    options: REPAYMENT_FREQUENCIES.map(({ value, label }) => ({ value, label })),
    hint: 'How often repayment instalments fall — drives the generated repayment schedule.' },
  { key: 'repaymentFrequencyOtherMonths', group: 'Interest & Repayment', label: 'Custom Interval (Months)',
    kind: 'text', placeholder: 'e.g. 4', width: 150, listHidden: true,
    hint: 'Only used when Repayment Frequency is Other.' },
  // Not a field anyone types into directly — edited via the per-period
  // inputs on the Repayment Schedule tab itself (see RepaymentScheduleTab.js),
  // which read/write this same JSON array. formHidden keeps it out of the
  // field grid; still persisted/loaded through the ordinary FIELDS-driven
  // save/load pipeline like every other field here.
  { key: 'repaymentProfileJson', group: 'Interest & Repayment', label: 'Repayment Percentage Profile',
    kind: 'text', width: 0, formHidden: true, listHidden: true, detailHidden: true },
  { key: 'repaymentStartDate', group: 'Interest & Repayment', label: 'Repayment Start Date',
    kind: 'date', placeholder: '30 September 2026', width: 170 },
  { key: 'repaymentEndDate', group: 'Interest & Repayment', label: 'Repayment End date',
    kind: 'date', placeholder: '30 September 2041', width: 170 },

  // ── 08 Important Dates ──
  { key: 'sanctionDate', group: 'Important Dates', label: 'Sanction Date',
    kind: 'date', placeholder: '14 March 2025', width: 130 },
  { key: 'scheduledCod', group: 'Important Dates', label: 'Scheduled COD date',
    kind: 'date', placeholder: '14 February 2026', width: 150, listHidden: true },
  { key: 'actualCod', group: 'Important Dates', label: 'Actual COD Date',
    kind: 'date', placeholder: '20 September 2025', width: 150, listHidden: true },

  // ── 09 Conditions & Covenants ──
  { key: 'coObligators', group: 'Conditions & Covenants', label: 'Co Obligators',
    kind: 'text', placeholder: 'Names of any co-obligators', width: 190 },
  { key: 'pledgeOfSharesPct', group: 'Conditions & Covenants', label: 'Pledge of share of borrower (%)',
    kind: 'pct', placeholder: '75', align: 'right', width: 150 },
  // DSRA, ISRA and cash sweep are phrases in real letters, not numbers, so they
  // stay free text and are compared as text.
  { key: 'minDscr', group: 'Conditions & Covenants', label: 'Min. DSCR (x)',
    kind: 'multiple', placeholder: '1.12x', align: 'right', width: 100,
    hint: 'The floor for any individual year, not the average.' },
  { key: 'avgDscr', group: 'Conditions & Covenants', label: 'Avg. DSCR (x)',
    kind: 'multiple', placeholder: '1.15x', align: 'right', width: 100,
    hint: 'The average across the complete loan tenor, not any single year.' },
  // Auto-filled from the DSRA requirement below and the repayment schedule
  // (see the gap-fill effect in SanctionFormModal, mirroring how
  // debtAmount/equityAmount pre-fill), but a real, persisted, editable
  // field — not derived-only — so a reviewer can type over it with the
  // figure the letter actually states, if that differs from the
  // calculation. Clearing the box back to empty resumes auto-calculation.
  // Placed beside ISRA Amount (both money fields) so the two figures sit
  // side by side, with their own DSRA/ISRA description fields as a second
  // side-by-side pair right after.
  { key: 'dsraAmount', group: 'Conditions & Covenants', label: 'DSRA Amount (Cr)',
    kind: 'money', align: 'right', width: 140, listHidden: true,
    hint: 'Auto-filled from the DSRA requirement below and the repayment schedule — edit to override.' },
  // Same auto-fill/editable split as DSRA Amount above. When the letter has
  // no separate ISRA clause, the auto-filled suggestion is the interest
  // component of the DSRA calculation instead — never implying a separate
  // contractual requirement unless the letter actually states one (see
  // israIsContractual on the derived panel / SanctionFormModal's hint
  // override for this field).
  { key: 'israAmount', group: 'Conditions & Covenants', label: 'ISRA Amount (Cr)',
    kind: 'money', align: 'right', width: 140, listHidden: true,
    hint: 'Auto-filled. If ISRA is not separately stated, this is the interest component of the DSRA calculation.' },
  { key: 'dsra', group: 'Conditions & Covenants', label: 'DSRA',
    kind: 'text', textarea: true, placeholder: "One quarter's debt service", width: 170 },
  { key: 'isra', group: 'Conditions & Covenants', label: 'ISRA',
    kind: 'text', textarea: true, placeholder: 'As printed in the letter', width: 170 },
  { key: 'cashSweep', group: 'Conditions & Covenants', label: 'Cash Sweep',
    kind: 'text', textarea: true, wide: true, rows: 6, placeholder: '100% above 1.30x DSCR', width: 300 },

  // ── 12 Additional Information ──
  { key: 'plfPct', group: 'Additional Information', label: 'PLF (%)',
    kind: 'pct', placeholder: '24.5', align: 'right', width: 90 },
  { key: 'tariffPerUnit', group: 'Additional Information', label: 'Tariff',
    kind: 'text', placeholder: '2.53', suffix: '₹ / kWh', align: 'right', width: 110 },
];

/** The latest letter on a registry row, or an empty object so accessors are safe. */
export const latestSanction = (row) => (row && row.sanctions && row.sanctions[0]) || {};

/** Field definitions bucketed by their sheet band, in declaration order. */
export const sanctionFieldGroups = () => {
  const out = [];
  const index = new Map();
  SANCTION_FIELDS.forEach((f) => {
    if (!index.has(f.group)) {
      index.set(f.group, out.length);
      out.push({ group: f.group, fields: [] });
    }
    out[index.get(f.group)].fields.push(f);
  });
  return out;
};

export const SANCTION_KEYS = SANCTION_FIELDS.map((f) => f.key);

// Inputs stay type="text" on purpose, including the date ones. The backend
// returns dates formatted "14 Mar 2025" via formatDate, which a native
// <input type="date"> cannot consume — opening a saved record for edit would
// silently blank every date. `kind` is used for placeholders, unit hints and
// comparison only.

export default SANCTION_FIELDS;
