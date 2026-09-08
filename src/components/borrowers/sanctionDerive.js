// src/components/borrowers/sanctionDerive.js
//
// Client-side mirror of the backend SanctionDerivedCalculator, so the review
// screen can update the derived panel live as the user corrects a figure —
// correcting the sanctioned amount should move the equity contribution
// immediately, not after a save round-trip.
//
// The backend remains authoritative: what the detail page shows is what Java
// computed. If a rule changes in SanctionDerivedCalculator.java — in either
// apply() or fillGaps() — change it here too. This file and that one are the
// highest drift risk in the module.

const CRORE = 10000000;
const LAKH = 100000;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * A unit word only qualifies the number it immediately follows — a little
 * punctuation ("/-", ",", ".") and whitespace is tolerated between them, but
 * nothing else. Indian sanction letters routinely restate a rupee figure in
 * words a few characters later — "5,22,24,00,000/- (Rupees Five Hundred
 * Twenty Two Crore Twenty Four Lakh only)" — and that restatement always
 * contains "crore"/"lakh" too; scanning the whole remainder of the string
 * (rather than just the text touching the number) would read that
 * restatement as the number's own unit and double-scale an already-correct
 * rupee figure. Mirrors SanctionValueParser.UNIT_TAIL (Java).
 */
const UNIT_TAIL_RE = /^[\s/,.-]*(crore|crs?|lakhs?|lacs?|lk|l)\b/;

/** "Rs. 205.00 Crore", "205 Cr", "2050000000" → 2050000000 */
export const parseMoney = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\u00A0/g, ' ').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/(-?\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  const tail = s.slice(m.index + m[1].length);
  const unit = tail.match(UNIT_TAIL_RE);
  if (unit) return unit[1].startsWith('cr') ? n * CRORE : n * LAKH;
  return n;
};

// Renders plain rupees back as "₹153.75 Cr" for display — always exactly 2
// decimals. `rupees` itself is never touched here (a computed value like
// first-year interest or a DSRA/ISRA amount keeps its full, unrounded
// precision everywhere it's actually used in a calculation); only the
// string this function hands to the UI is rounded, the same "at most 2
// decimals" shape every entered money field already showed. This is also
// what SanctionFormModal's normalizeMoneyValue round-trips a typed amount
// through (parseMoneyCrore → formatCrore) before saving — no change there
// either, since the backend's own parseMoneyCrore already rounds to 2
// decimals on save regardless of what this function displays.
export const formatCrore = (rupees) => {
  if (rupees === null || rupees === undefined || Number.isNaN(rupees)) return null;
  return `₹${(rupees / CRORE).toFixed(2)} Cr`;
};

/** Accepts "14 March 2025", "14 Mar 2025", "14/03/2025", "2025-03-14". */
export const parseDate = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim().replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');

  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,12})\s+(\d{4})$/);
  if (m) {
    const idx = MONTHS.findIndex((mo) => mo.startsWith(m[2].toLowerCase()));
    if (idx >= 0) return new Date(Number(m[3]), idx, Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (d) => {
  if (!d) return null;
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${String(d.getDate()).padStart(2, '0')} ${mo} ${d.getFullYear()}`;
};

/**
 * EDATE-style month arithmetic (mirrors java.time.LocalDate.plusMonths, what
 * the backend uses): if the day-of-month doesn't exist in the target month,
 * clamp to that month's last day instead of rolling over — 31 Jan + 1 month
 * lands on 28/29 Feb, not 3 Mar. Date.setMonth() alone rolls over, which is
 * why this can't just be `d.setMonth(d.getMonth() + n)`.
 */
const addMonths = (d, n) => {
  const targetIndex = d.getMonth() + n;
  const targetYear = d.getFullYear() + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDayOfTargetMonth);
  return new Date(targetYear, targetMonth, day);
};

/** "16 years including moratorium of 6 months" → 192 */
export const parseTenorMonths = (raw) => {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const y = s.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/);
  if (y) return Math.round(parseFloat(y[1]) * 12);
  const mo = s.match(/(\d+)\s*months?/);
  if (mo && !s.slice(0, mo.index).includes('moratorium')) return parseInt(mo[1], 10);
  return null;
};

export const parseMoratoriumMonths = (raw) => {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const i = s.indexOf('moratorium');
  if (i < 0) return null;
  const m = s.slice(i).match(/(\d+(?:\.\d+)?)\s*(months?|years?|yrs?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].startsWith('y') ? Math.round(n * 12) : Math.round(n);
};

// A letter that states both the spread and the all-in rate in one sentence
// ("...spread of 2.32% p.a., ... presently working out to 9.88% p.a.
// floating") must not have the spread mistaken for the rate itself just
// because it's printed first. A phrase anchoring the all-in figure wins;
// only a letter with no such phrase (and, typically, only one percentage in
// the sentence to begin with) falls back to "the first % in the text".
// Mirrors SanctionDocExtractor.deriveRoiFromInterestText (Java).
const ROI_ANCHORED_RE =
  /(?:presently\s+working\s+out\s+to|effective\s+rate(?:\s+of\s+interest)?|all[\s-]?in\s+rate)[^0-9%]{0,20}(\d+(?:\.\d+)?)\s*%/i;

export const parseRatePct = (raw) => {
  if (!raw) return null;
  const s = String(raw);
  const anchored = s.match(ROI_ANCHORED_RE);
  if (anchored) return parseFloat(anchored[1]);
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
};

/**
 * A percentage that may arrive with or without its sign: "75", "75%", "9.75 %".
 * Not parseRatePct — that one requires the "%" and returns null for a bare
 * number, which is exactly what a value copied off the registry sheet is.
 */
export const parsePct = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? null : n;
};

/** "1.12x", "1.12 times", "1.12" → 1.12 */
export const parseMultiple = parsePct;

/** Trim trailing zeros so 9.750 renders as "9.75%". */
const pct = (n) => (n === null || n === undefined || Number.isNaN(n)
  ? null
  : `${parseFloat(n.toFixed(3))}%`);

/**
 * Money quoted in crore. A bare number scales; an explicit unit wins; and a
 * bare figure of a lakh or more is left alone, because nothing in this book
 * costs a hundred thousand crore and a number that large was plainly already
 * pasted in rupees. Mirrors SanctionValueParser.parseMoneyCrore.
 */
export const parseMoneyCrore = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/ /g, ' ').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/(-?\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const tail = s.slice(m.index + m[1].length);
  if (UNIT_TAIL_RE.test(tail)) return parseMoney(raw);
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  return Math.abs(n) >= LAKH ? n : n * CRORE;
};

/**
 * Repayment cycle options, in the order the dropdown shows them. The single
 * source of truth for the length of one repayment period — no schedule/
 * DSRA/ISRA call site hardcodes "3" (a quarter) directly anymore. Exactly one
 * of months/days is set per entry: Bi-Monthly is a true 15-day cycle (twice a
 * month), not a whole-month one, so it carries `days` instead of `months` —
 * everything else steps in whole months. Mirrors
 * SanctionDerivedCalculator.resolveRepaymentPeriod (Java) 1:1.
 */
export const REPAYMENT_FREQUENCIES = [
  { value: 'BI_MONTHLY', label: 'Bi-Monthly (15 Days)', months: null, days: 15 },
  { value: 'MONTHLY', label: 'Monthly', months: 1, days: null },
  { value: 'QUARTERLY', label: 'Quarterly', months: 3, days: null },
  { value: 'HALF_YEARLY', label: 'Half-Yearly / Semi-Annual', months: 6, days: null },
  { value: 'YEARLY', label: 'Yearly / Annual', months: 12, days: null },
  { value: 'OTHER', label: 'Other', months: null, days: null },
];

/**
 * The length of one repayment period for the given frequency (+ custom
 * interval, for OTHER) — `{ months, days }` with exactly one of the two set.
 * Returns null for OTHER with no valid custom months set yet — callers must
 * skip generating a schedule rather than silently treating it as quarterly.
 * Returns `{ months: 3, days: null }` for an unset/unrecognised frequency,
 * matching the interval every schedule used before this field existed, so
 * old records without it keep generating exactly the schedule they always
 * did.
 */
export const resolveRepaymentPeriod = (freq, otherMonths) => {
  if (freq === 'OTHER') {
    const n = parseInt(otherMonths, 10);
    return Number.isFinite(n) && n > 0 ? { months: n, days: null } : null;
  }
  const found = REPAYMENT_FREQUENCIES.find((f) => f.value === freq);
  return found ? { months: found.months, days: found.days } : { months: 3, days: null };
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const RESERVE_NIL = /\b(nil|none|not\s+required|waived|not\s+applicable|n\/?a)\b/i;
const RESERVE_PERIOD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+(?:\.\d+)?)\s*(?:quarters?|months?|years?)\b/i;

/**
 * Reads a reserve-covenant phrase like "equivalent to the next two quarters'
 * Scheduled Debt Service" and returns how many *scheduled repayment periods*
 * it names — "quarters" here means the loan's own repayment cycle, not a
 * calendar quarter, so "two quarters" is always 2 rolling schedule periods
 * (current + next), whatever the selected Repayment Frequency actually is.
 * Previously converted the stated unit to months and divided by the
 * frequency's own period length — correct-looking for a Quarterly schedule
 * (where it happened to land on 2), but wrong everywhere else: it collapsed
 * to a single period for Half-Yearly/Yearly (losing "current + next"
 * entirely) and ballooned past 2 for Monthly/Bi-Monthly. The sanction
 * letter's own Excel reference always sums exactly two consecutive schedule
 * rows regardless of frequency, so this no longer takes monthsPerPeriod at
 * all. Returns 0 for a clause that explicitly states no reserve ("Nil"), or
 * null if the field is blank or the phrase states no recognisable count —
 * this never guesses a number the letter didn't state.
 */
export const parseReservePeriods = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (RESERVE_NIL.test(s)) return 0;

  const m = s.match(RESERVE_PERIOD);
  if (!m) return null;

  const numToken = m[1].toLowerCase();
  const n = Object.prototype.hasOwnProperty.call(NUMBER_WORDS, numToken)
    ? NUMBER_WORDS[numToken]
    : parseFloat(numToken);

  return Math.max(1, Math.round(n));
};

const round2 = (n) => Math.round(n * 100) / 100;

/** EOMONTH-equivalent: last day of the month n months after d. */
const addMonthsEndOfMonth = (d, n) => {
  const stepped = addMonths(d, n);
  return new Date(stepped.getFullYear(), stepped.getMonth() + 1, 0);
};

/** Plain calendar-day arithmetic — Bi-Monthly's 15-day cycle, no EOM snapping. */
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const QUARTER_END_MONTHS = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-indexed)

/**
 * Next calendar quarter-end (31 Mar / 30 Jun / 30 Sep / 31 Dec) STRICTLY
 * after d — Quarterly's own anchor rule, distinct from every other
 * frequency's plain "step forward N months, then EOM" (addMonthsEndOfMonth
 * above). If d itself already IS a quarter-end, that counts as the current
 * quarter and this returns the one after it, never d itself — so a
 * moratorium ending exactly on 31 Mar doesn't make 31 Mar the first
 * repayment date too. Once anchored here, ordinary quarterly
 * addMonthsEndOfMonth stepping stays on calendar quarter-ends on its own
 * for every subsequent period (31 Mar → 30 Jun → 30 Sep → 31 Dec → 31 Mar
 * ...), so this is only ever needed once, at the anchor.
 */
const nextCalendarQuarterEnd = (d) => {
  for (const m of QUARTER_END_MONTHS) {
    const eom = new Date(d.getFullYear(), m + 1, 0);
    if (eom.getTime() > d.getTime()) return eom;
  }
  return new Date(d.getFullYear() + 1, QUARTER_END_MONTHS[0] + 1, 0);
};

/**
 * Stage 1 of the two-stage schedule model: the full calendar-anchored
 * sequence of period-end dates from `start` (Disbursement Date) through
 * `end` (Repayment End) — generated in one continuous pass, entirely
 * independent of the moratorium. Quarterly anchors only its very first step
 * to the next calendar quarter-end (nextCalendarQuarterEnd); every
 * subsequent step, and every step for every other frequency, is a plain
 * addMonthsEndOfMonth step — which, once Quarterly is anchored, stays on
 * calendar quarter-ends on its own (31 Mar → 30 Jun → 30 Sep → 31 Dec →
 * 31 Mar ...). Stage 2 (in buildQuarterEndSchedule) classifies each of
 * these periods as moratorium or amortizing by comparing its end to
 * Moratorium End — never via a separately-stepped moratorium loop, which is
 * what previously let an extra, mis-anchored period slip in between the
 * moratorium and the first real repayment.
 *
 * `period` is `{ months, days }` with exactly one set — Bi-Monthly's 15-day
 * cycle steps by plain calendar days (never EOM-snapped, since a 15-day
 * period isn't anchored to month boundaries); every other frequency steps
 * in whole months as before.
 */
const periodEndDates = (start, end, period, isQuarterly) => {
  const dates = [];
  let cursor = start;
  let first = true;
  while (cursor.getTime() < end.getTime()) {
    const next0 = (first && isQuarterly) ? nextCalendarQuarterEnd(cursor)
      : period.days ? addDays(cursor, period.days) : addMonthsEndOfMonth(cursor, period.months);
    const next = next0.getTime() > end.getTime() ? end : next0;
    dates.push(next);
    cursor = next;
    first = false;
  }
  return dates;
};

/**
 * The Moratorium window and the final Repayment Start/End dates — the single
 * calculation deriveSanction() (twice — the side panel's display values and
 * the DSRA/ISRA pricing schedule) and deriveRepaymentSchedule() (the tab's
 * own schedule) all build off, so the three can never resolve these dates
 * differently for the same sanction.
 *
 * Repayment End is resolved first, independent of Repayment Start: a
 * contractual value always wins; otherwise it's the full stated Tenor
 * (already inclusive of the moratorium) counted from Disbursement Date,
 * EOMONTH-adjusted. Repayment Start is then purely a *display* figure —
 * "the date the first real repayment falls due" — derived by walking Stage
 * 1's calendar period sequence (periodEndDates) from Disbursement Date and
 * taking the first period whose end falls after Moratorium End; the actual
 * schedule (buildQuarterEndSchedule) redoes this exact classification
 * itself from the same inputs rather than trusting this derived date, so
 * the two can never disagree. A contractual repaymentStartDate still wins
 * outright here too, used exactly as given. Moratorium Start is always the
 * Disbursement Date, never the Sanction Date (a holiday measured from when
 * the project was actually funded, not from when the lender merely signed).
 */
export const resolveRepaymentWindow = (form) => {
  const moratoriumStart = parseDate(form.disbursementDate);
  // A letter that states Tenor and Moratorium as two separate clauses
  // ("Tenor: 204 months ... inclusive of moratorium" / "Moratorium: 6
  // months...") never puts a month count in the Tenor sentence itself, so
  // parseMoratoriumMonths(tenorText) alone would read it as zero. An
  // explicit moratoriumMonths — read from that separate clause at import —
  // wins when present; mirrors BorrowerService's identical precedence on
  // save (explicit value first, else parsed from tenorText).
  const explicitMora = form.moratoriumMonths != null && String(form.moratoriumMonths).trim() !== ''
    ? parseInt(String(form.moratoriumMonths).replace(/[^0-9]/g, ''), 10)
    : NaN;
  const mora = Number.isNaN(explicitMora) ? parseMoratoriumMonths(form.tenorText) : explicitMora;
  const tenor = parseTenorMonths(form.tenorText);
  const period = resolveRepaymentPeriod(form.repaymentFrequency, form.repaymentFrequencyOtherMonths);
  const isQuarterly = form.repaymentFrequency === 'QUARTERLY';
  const moratoriumEnd = moratoriumStart
    ? (mora ? addMonths(moratoriumStart, mora) : moratoriumStart)
    : null;

  const repaymentEnd = parseDate(form.repaymentEndDate)
    || (moratoriumStart && tenor ? addMonthsEndOfMonth(moratoriumStart, tenor) : null);

  const repaymentStart = parseDate(form.repaymentStartDate)
    || (moratoriumStart && moratoriumEnd && period && repaymentEnd
      ? (periodEndDates(moratoriumStart, repaymentEnd, period, isQuarterly)
        .find((d) => d.getTime() > moratoriumEnd.getTime()) || null)
      : null);

  return {
    moratoriumStart, moratoriumEnd, repaymentStart, repaymentEnd,
  };
};

/**
 * Equal 100/N split: 100/periods for every period except the last, which
 * absorbs whatever remains so the total is always exactly 100 regardless of
 * how evenly periods divides — mirrors the reference Excel's own final-row
 * `=100%-SUM(...)` formula, never a fixed final percentage. Only used when
 * there's no reviewer-entered repayment percentage profile (or one whose
 * length no longer matches the schedule, e.g. after a frequency change).
 * Mirrors LoanReserveCalculator.defaultRepaymentPercents (Java) 1:1.
 */
export const defaultRepaymentPercents = (periods) => {
  if (periods <= 0) return [];
  const share = 100 / periods;
  const arr = Array(periods).fill(share);
  arr[periods - 1] = 100 - share * (periods - 1);
  return arr;
};

/** "[2.5,1.4,2.5,...]" → the same array of numbers, or null for blank/malformed JSON. */
export const parseRepaymentProfile = (json) => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * The single engine both the Repayment Schedule tab and the DSRA/ISRA point
 * figures are priced off — one calculation, not two that could silently
 * disagree. Mirrors LoanReserveCalculator.buildQuarterEndSchedule (Java)
 * 1:1. Two stages: Stage 1 (periodEndDates) generates the full
 * calendar-anchored period sequence from `start` to `repayEnd` in one
 * continuous pass; Stage 2 here classifies each period as moratorium (its
 * end falls at or before `moratoriumEnd`), amortizing (its start falls at
 * or after `moratoriumEnd`), or — when a period genuinely straddles the
 * boundary (starts before, ends after) — split into two schedule rows for
 * that ONE term: a moratorium portion up to `moratoriumEnd` (principal 0,
 * `repaymentPct` omitted, same as any moratorium row) and a repayment
 * portion from there to the period's own end (the term's full principal
 * and `repaymentPct`, interest priced over only its own days). The split
 * never changes the term count: `percents[i]` is indexed by logical term,
 * so a split term consumes exactly one index, same as an unsplit one.
 * Principal is `amortizingBaseAmount × repaymentPercents[i] / 100` for
 * every amortizing term (or its repayment portion) — never a division of
 * the declining balance. amortizingBaseAmount is debtAmount, or the
 * capitalized balance once capitalizeMoratoriumInterest has folded the
 * moratorium's own interest — including any split term's moratorium
 * portion — into it, so a Capitalized sanction's percentages are still
 * applied against what it will actually owe once repayment starts.
 * repaymentPercents is the reviewer's own profile when its length matches
 * the (logical) amortizing term count; otherwise an equal 100/N split is
 * generated here (see defaultRepaymentPercents). isQuarterly controls only
 * Stage 1's very first step (nextCalendarQuarterEnd vs. plain EOMONTH
 * stepping) — see periodEndDates.
 */
export const buildQuarterEndSchedule = (
  debtAmount, annualRoiPct, start, moratoriumEnd, repayEnd, period, capitalizeMoratoriumInterest,
  repaymentPercents = null, isQuarterly = false,
) => {
  const schedule = [];
  if (debtAmount === null || annualRoiPct === null || !start || !moratoriumEnd || !repayEnd
      || repayEnd.getTime() <= start.getTime()) {
    return schedule;
  }

  const rate = annualRoiPct / 100;
  const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

  // Stage 1: the full calendar-anchored period sequence, uninterrupted by
  // the moratorium.
  let cursor = start;
  const periods = periodEndDates(start, repayEnd, period, isQuarterly).map((end) => {
    const p = { start: cursor, end };
    cursor = end;
    return p;
  });

  // Stage 2a: classify each period once — 'moratorium' (fully before the
  // boundary), 'split' (straddles it — one logical term, priced as two
  // portions below), or 'amortizing' (fully after).
  const classified = periods.map((p) => {
    if (p.end.getTime() <= moratoriumEnd.getTime()) return { ...p, kind: 'moratorium' };
    if (p.start.getTime() < moratoriumEnd.getTime()) return { ...p, kind: 'split' };
    return { ...p, kind: 'amortizing' };
  });

  // Stage 2b: every moratorium-priced leg — pure moratorium periods, and
  // the moratorium portion of a split period — is interest-only against
  // the flat pre-repayment balance (debtAmount), since nothing reduces
  // principal until the repayment side of a split term is reached. Order
  // among these doesn't affect the math, only capitalization needs their
  // total, computed before any principal pricing begins.
  const moratoriumInterest = (a, b) => (debtAmount * rate * daysBetween(a, b)) / 365;
  let balance = debtAmount;
  if (capitalizeMoratoriumInterest) {
    const total = classified.reduce((t, p) => {
      if (p.kind === 'moratorium') return t + round2(moratoriumInterest(p.start, p.end));
      if (p.kind === 'split') return t + round2(moratoriumInterest(p.start, moratoriumEnd));
      return t;
    }, 0);
    balance += total;
  }
  const amortizingBaseAmount = balance;

  const amortizingPeriods = classified.filter((p) => p.kind !== 'moratorium').length;
  const percents = (repaymentPercents && repaymentPercents.length === amortizingPeriods)
    ? repaymentPercents : defaultRepaymentPercents(amortizingPeriods);

  // Stage 2c: build the final, chronologically-ordered schedule — each
  // classified period contributes one row (moratorium/amortizing) or two
  // (split), and `amortIdx` advances once per logical term regardless.
  let amortIdx = 0;
  classified.forEach((p) => {
    if (p.kind === 'moratorium') {
      const interest = moratoriumInterest(p.start, p.end);
      schedule.push({ start: p.start, end: p.end, principalDue: 0, interestDue: round2(interest) });
      return;
    }
    if (p.kind === 'split') {
      const morInterest = moratoriumInterest(p.start, moratoriumEnd);
      schedule.push({
        start: p.start, end: moratoriumEnd, principalDue: 0, interestDue: round2(morInterest),
        splitPart: 'moratorium',
      });
      const pct = percents[amortIdx];
      const principal = (amortizingBaseAmount * pct) / 100;
      const closing = balance - principal;
      const avgBalance = (balance + closing) / 2;
      const repInterest = (avgBalance * rate * daysBetween(moratoriumEnd, p.end)) / 365;
      schedule.push({
        start: moratoriumEnd, end: p.end, principalDue: round2(principal), interestDue: round2(repInterest),
        repaymentPct: pct, splitPart: 'repayment',
      });
      balance = closing;
      amortIdx += 1;
      return;
    }
    // pure amortizing
    const pct = percents[amortIdx];
    const principal = (amortizingBaseAmount * pct) / 100;
    const closing = balance - principal;
    const avgBalance = (balance + closing) / 2;
    const interest = (avgBalance * rate * daysBetween(p.start, p.end)) / 365;
    schedule.push({
      start: p.start, end: p.end, principalDue: round2(principal), interestDue: round2(interest),
      repaymentPct: pct,
    });
    balance = closing;
    amortIdx += 1;
  });

  return schedule;
};

/**
 * The interest-only (moratorium) leg of a schedule carries no principal and
 * isn't real debt service yet. Distinguished by repaymentPct being present
 * (only ever set on periods buildQuarterEndSchedule generated in its
 * amortizing loop), not by principalDue > 0 — a reviewer can edit a real
 * amortizing term's own Repayment % down to exactly 0, and that term must
 * still count as one of the N periods a DSRA/ISRA rolling window steps
 * over; testing principalDue instead would silently drop it from the
 * window, compressing it to fewer real calendar periods than the DSRA/ISRA
 * clause actually names.
 */
const amortizingOnly = (schedule) => schedule.filter((p) => p.repaymentPct !== undefined);

/**
 * Sum of Principal + Interest (Scheduled Debt Service) over the first N
 * periods once repayment actually begins — the DSRA input. Mirrors
 * LoanReserveCalculator.sumDebtService: not the first N periods of
 * `schedule` outright, since a moratorium's own periods carry zero
 * principal and would otherwise silently collapse this to the same figure
 * as sumInterest.
 */
export const sumDebtService = (schedule, periods) =>
  amortizingOnly(schedule).slice(0, periods).reduce((t, p) => t + p.principalDue + p.interestDue, 0);

/** Sum of Interest only over the first N periods once repayment actually begins — the ISRA input. */
export const sumInterest = (schedule, periods) =>
  amortizingOnly(schedule).slice(0, periods).reduce((t, p) => t + p.interestDue, 0);

/**
 * DSRA priced at every amortizing period, not just the first — the rolling
 * N-period-ahead debt service the Excel reference computes per row
 * (`M4 = K4+L4+K5+L5`, then `MAX(M4:M83)` / `MIN(M4:M83)`). The window
 * truncates at the schedule's end rather than looking past it (the Excel's
 * own last row has nothing to add a next period's figures to either).
 */
export const dsraSeries = (schedule, periods) => {
  const amort = amortizingOnly(schedule);
  const series = [];
  for (let i = 0; i < amort.length; i++) {
    let sum = 0;
    for (let j = i; j < Math.min(i + periods, amort.length); j++) {
      sum += amort[j].principalDue + amort[j].interestDue;
    }
    series.push(sum);
  }
  return series;
};

/** Same rolling window as dsraSeries, interest only — the ISRA equivalent, per period. */
export const israSeries = (schedule, periods) => {
  const amort = amortizingOnly(schedule);
  const series = [];
  for (let i = 0; i < amort.length; i++) {
    let sum = 0;
    for (let j = i; j < Math.min(i + periods, amort.length); j++) {
      sum += amort[j].interestDue;
    }
    series.push(sum);
  }
  return series;
};

/**
 * Everything the detail page shows under "derived", computed from the form's
 * current values. Fields that can't be computed come back as null so the panel
 * can render a dash rather than a wrong number.
 */
export const deriveSanction = (form) => {
  const cost = parseMoneyCrore(form.projectCost);
  const loan = parseMoneyCrore(form.sanctionedAmount);
  const signed = parseDate(form.sanctionDate);
  const cod = parseDate(form.scheduledCod);
  const actualCod = parseDate(form.actualCod);
  const tenor = parseTenorMonths(form.tenorText);
  // Until a real Actual COD Date is entered, the planned date stands in for
  // it — a deliberate policy choice (see SanctionDerivedCalculator.apply),
  // not a fallback for missing data. Used only for the COD status indicator
  // below — repayment timing is modelled off Disbursement Date instead (see
  // resolveRepaymentWindow), not off COD or the sanction date.
  const effectiveActual = actualCod || cod;

  const out = {
    equityContribution: null,
    ratioCheck: null,
    ratioOk: null,
    moratoriumEnd: null,
    repaymentStart: null,
    repaymentEnd: null,
    totalTenorMonths: null,
    firstYearInterest: null,
    sanctionValidTill: null,
    sanctionValidTillIso: null,
    disbDateCheck: null,
    disbDateOk: null,
    actualCod: null,
    codStatus: null,
    dsraAmount: null,
    israAmount: null,
    israIsContractual: null,
    // Registry-sheet gap-fills. Printed wins; these only appear where the
    // letter was silent, and `computed` names the ones that were worked out.
    debtAmount: null,
    equityAmount: null,
    debtPct: null,
    equityPct: null,
    roi: null,
    roiCheck: null,
    roiOk: null,
    computed: new Set(),
  };

  if (cost !== null && loan !== null) {
    out.equityContribution = formatCrore(cost - loan);
    if (cost > 0) {
      const debtPct = (loan / cost) * 100;
      const printed = String(form.debtEquityRatio || '').split(/[:/]/);
      if (printed.length === 2) {
        const stated = parseFloat(printed[0].replace(/[^0-9.]/g, ''));
        if (!Number.isNaN(stated)) {
          out.ratioOk = Math.abs(stated - debtPct) <= 1;
          out.ratioCheck = out.ratioOk
            ? 'Reconciles'
            : `Does not reconcile — amounts imply ${debtPct.toFixed(1)}% debt`;
        }
      } else {
        out.ratioCheck = `Implies ${debtPct.toFixed(1)} : ${(100 - debtPct).toFixed(1)}`;
      }
    }
  }

  if (signed) {
    const validTill = addMonths(signed, 6);
    out.sanctionValidTill = formatDate(validTill);
    // ISO copy (formatDate above is display-only, "14 Sep 2025") — needed by
    // SanctionDatePicker's min/max props, which compare ISO strings.
    out.sanctionValidTillIso = `${validTill.getFullYear()}-${String(validTill.getMonth() + 1).padStart(2, '0')}-${String(validTill.getDate()).padStart(2, '0')}`;

    // Mirrors the backend's blocking check in BorrowerService.validateSanction
    // — surfaced here too so the user sees the problem while typing instead
    // of only after Save rejects it.
    const disbDate = parseDate(form.disbursementDate);
    if (disbDate) {
      out.disbDateOk = disbDate.getTime() >= signed.getTime() && disbDate.getTime() <= validTill.getTime();
      out.disbDateCheck = out.disbDateOk
        ? 'Within the sanction validity window'
        : `Must fall between ${formatDate(signed)} and ${formatDate(validTill)}`;
    }
  }

  const repaymentWindow = resolveRepaymentWindow(form);
  if (repaymentWindow.moratoriumEnd) out.moratoriumEnd = formatDate(repaymentWindow.moratoriumEnd);
  if (repaymentWindow.repaymentStart) out.repaymentStart = formatDate(repaymentWindow.repaymentStart);
  if (repaymentWindow.repaymentEnd) out.repaymentEnd = formatDate(repaymentWindow.repaymentEnd);

  if (tenor) out.totalTenorMonths = `${tenor} months`;

  // ── registry-sheet gap-fills, mirroring SanctionDerivedCalculator.fillGaps ──
  let debt = parseMoneyCrore(form.debtAmount);
  if (debt === null && loan !== null) {
    debt = loan;                              // one lender, one facility
    out.debtAmount = formatCrore(debt);
    out.computed.add('debtAmount');
  }

  let equity = parseMoneyCrore(form.equityAmount);
  if (equity === null && cost !== null && debt !== null) {
    equity = cost - debt;
    out.equityAmount = formatCrore(equity);
    out.computed.add('equityAmount');
  }

  let debtPctValue = parsePct(form.debtPct);
  if (debtPctValue === null && cost !== null && debt !== null && cost !== 0) {
    debtPctValue = Math.round((debt / cost) * 1000) / 10;
    out.debtPct = pct(debtPctValue);
    out.computed.add('debtPct');
  }

  if (parsePct(form.equityPct) === null) {
    let equityPctValue = null;
    if (equity !== null && cost !== null && cost !== 0) {
      equityPctValue = Math.round((equity / cost) * 1000) / 10;
    } else if (debtPctValue !== null) {
      equityPctValue = 100 - debtPctValue;
    }
    if (equityPctValue !== null) {
      out.equityPct = pct(equityPctValue);
      out.computed.add('equityPct');
    }
  }

  // ── Rate of Interest ──
  // Base + Spread is authoritative once both are genuinely known — that's
  // literally how the rate is charged, so it outranks a figure the letter
  // states separately (a labelled ROI row, or the number in the interest
  // sentence) rather than the other way round. A blank Base Rate/Spread box
  // parses to null even though it *displays* "0" (a placeholder, not a real
  // value — see sanctionFields.js), so a fixed-rate letter with no breakdown
  // is never zeroed out by this: it falls through to whatever the letter
  // itself states. A conflict between the two is flagged via roiCheck below,
  // not silently resolved by trusting the printed number.
  const base = parsePct(form.baseRatePct);
  const spread = parsePct(form.spreadPct);
  const statedRoi = parsePct(form.roiPct);
  const textRoi = parseRatePct(form.interestRateText);
  const printedRoi = statedRoi !== null ? statedRoi : textRoi;
  let roi = null;
  if (base !== null && spread !== null) {
    roi = base + spread;
    out.roi = pct(roi);
    out.computed.add('roiPct');
    if (printedRoi !== null) {
      if (Math.abs(printedRoi - roi) > 0.001) {
        out.roiOk = false;
        out.roiCheck = `Does not reconcile — letter states ${pct(printedRoi)}`;
      } else {
        out.roiOk = true;
        out.roiCheck = 'Reconciles';
      }
    }
  } else if (printedRoi !== null) {
    roi = printedRoi;
    out.roi = pct(roi);
    if (statedRoi === null) out.computed.add('roiPct');
  }

  if (loan !== null && roi !== null) {
    out.firstYearInterest = formatCrore((loan * roi) / 100);
  }

  // ── DSRA / ISRA, priced off the reserve engine ──
  // Same resolved window (moratorium + repayment start/end — contractual
  // dates honoured, disbursement-anchored where they're not) as the display
  // values above and as deriveRepaymentSchedule's own table — one
  // calculation, reused three times, so DSRA/ISRA can never silently
  // disagree with what the Repayment Schedule tab shows for the identical
  // sanction. period is null only for an incomplete "Other" frequency (no
  // valid custom interval yet) — nothing to price a schedule against, so
  // this whole block is skipped rather than guessing quarterly.
  const period = resolveRepaymentPeriod(form.repaymentFrequency, form.repaymentFrequencyOtherMonths);
  if (debt !== null && roi !== null && period
      && repaymentWindow.moratoriumStart && repaymentWindow.moratoriumEnd && repaymentWindow.repaymentEnd) {
    const schedule = buildQuarterEndSchedule(
      debt, roi, repaymentWindow.moratoriumStart, repaymentWindow.moratoriumEnd, repaymentWindow.repaymentEnd,
      period, form.interestDuringMoratorium === 'CAPITALIZED',
      parseRepaymentProfile(form.repaymentProfileJson), form.repaymentFrequency === 'QUARTERLY',
    );

    // Mirrors SanctionDerivedCalculator.applyReserves exactly — DSRA gets
    // "Not Calculated" (not a blank dash) when its text is present but
    // doesn't parse; ISRA falls back to DSRA's own interest component only
    // when there is no ISRA clause at all (blank), never when one exists
    // but doesn't parse.
    const dsraText = String(form.dsra || '').trim();
    const dsraPeriods = parseReservePeriods(form.dsra);
    if (dsraPeriods !== null) {
      out.dsraAmount = dsraPeriods === 0 ? 'Nil' : formatCrore(sumDebtService(schedule, dsraPeriods));
    } else if (dsraText !== '') {
      out.dsraAmount = 'Not Calculated';
    }

    const israText = String(form.isra || '').trim();
    const israPeriods = parseReservePeriods(form.isra);
    if (israPeriods !== null) {
      out.israAmount = israPeriods === 0 ? 'Nil' : formatCrore(sumInterest(schedule, israPeriods));
      out.israIsContractual = true;
    } else if (israText !== '') {
      out.israAmount = 'Not Calculated';
    } else if (dsraPeriods !== null) {
      out.israAmount = dsraPeriods === 0 ? 'Nil' : formatCrore(sumInterest(schedule, dsraPeriods));
      out.israIsContractual = false;
    }
  }

  // Status never reports "Overdue" while a planned date exists (see
  // effectiveActual above); it reads as "on schedule" until someone enters
  // a real Actual COD Date.
  if (effectiveActual) {
    out.actualCod = formatDate(effectiveActual);
    out.codStatus = `Achieved on ${formatDate(effectiveActual)}`;
    if (cod) {
      const variance = Math.round((effectiveActual.getTime() - cod.getTime()) / 86400000);
      if (variance === 0) {
        out.codStatus += ' (on schedule)';
      } else if (variance > 0) {
        out.codStatus += ` (${variance} day${variance === 1 ? '' : 's'} late)`;
      } else {
        out.codStatus += ` (${-variance} day${variance === -1 ? '' : 's'} early)`;
      }
    }
  }

  return out;
};

/**
 * Everything the Repayment Schedule tab needs: the per-period array plus the
 * summary-header figures, all computed from the live form the same way
 * deriveSanction() computes the side panel — so the tab recalculates on
 * every keystroke for free via the same useMemo pattern in
 * SanctionFormModal.js. Reuses deriveSanction(form) for the ROI/DSRA/ISRA/
 * contractual figures rather than resolving Base Rate + Spread a second
 * time — the two used to run the identical "base+spread wins" rule
 * independently, which could drift if one were ever edited without the
 * other; d.roi is now the single source of truth for both.
 */
export const deriveRepaymentSchedule = (form) => {
  const d = deriveSanction(form);

  const debt = parseMoneyCrore(form.debtAmount) ?? parseMoneyCrore(form.sanctionedAmount);
  const roi = parsePct(d.roi);
  // null only for an incomplete "Other" frequency (no valid custom interval
  // yet) — the schedule stays empty rather than guessing quarterly, same
  // guard deriveSanction's DSRA/ISRA block applies.
  const period = resolveRepaymentPeriod(form.repaymentFrequency, form.repaymentFrequencyOtherMonths);
  const repaymentWindow = resolveRepaymentWindow(form);

  // Start/End are set from the resolved window unconditionally — d's own
  // (already-formatted-string) versions never leak through here even when
  // debt/roi aren't known yet, so the dates can show up before the money
  // figures can (they don't depend on ROI at all) instead of the tab
  // silently falling back to a stale string.
  const out = {
    schedule: [], minDsraAmount: null, maxDsraAmount: null, dsraByPeriod: null, israByPeriod: null,
    scheduleMissing: [], ...d,
    repaymentStart: repaymentWindow.repaymentStart,
    repaymentEnd: repaymentWindow.repaymentEnd,
  };

  // Named exactly like the on-screen field labels, in the order a reviewer
  // would naturally fill them in — so the empty-schedule message says which
  // box to fill in next rather than a generic "enter everything" line.
  // Repayment End now resolves before Repayment Start (End only needs a
  // Tenor or a contractual value; Start is derived FROM End, see
  // resolveRepaymentWindow) — each check only fires once its own
  // prerequisite is already satisfied, so filling in one field at a time
  // shrinks this list instead of listing three symptoms of the same cause.
  if (debt === null) out.scheduleMissing.push('Sanctioned amount');
  if (roi === null) out.scheduleMissing.push('Rate of Interest (Base Rate + Spread, or ROI)');
  if (!period) {
    out.scheduleMissing.push(form.repaymentFrequency === 'OTHER'
      ? 'Custom Interval (Months) for the Other repayment frequency'
      : 'Repayment Frequency');
  }
  if (!repaymentWindow.moratoriumStart) out.scheduleMissing.push('Disb. Date');
  if (repaymentWindow.moratoriumStart && !repaymentWindow.repaymentEnd) {
    out.scheduleMissing.push('Repayment End date, or a total Tenor (e.g. "16 years")');
  }
  if (repaymentWindow.moratoriumStart && repaymentWindow.repaymentEnd && !repaymentWindow.repaymentStart) {
    out.scheduleMissing.push('Repayment Start Date, or a moratorium period stated in Tenor (e.g. "moratorium of 6 months")');
  }
  // Every field above can be individually present yet still describe a
  // schedule with no room in it — e.g. a contractual Repayment End Date
  // typed earlier than the Disb. Date. buildQuarterEndSchedule's own guard
  // (repayEnd <= start) would otherwise fail silently here.
  if (!out.scheduleMissing.length && repaymentWindow.moratoriumStart && repaymentWindow.repaymentEnd
      && repaymentWindow.repaymentEnd.getTime() <= repaymentWindow.moratoriumStart.getTime()) {
    out.scheduleMissing.push('a Repayment End Date after the Disb. Date — check the dates entered');
  }

  if (debt !== null && roi !== null && period
      && repaymentWindow.moratoriumStart && repaymentWindow.moratoriumEnd && repaymentWindow.repaymentEnd) {
    out.schedule = buildQuarterEndSchedule(
      debt, roi, repaymentWindow.moratoriumStart, repaymentWindow.moratoriumEnd, repaymentWindow.repaymentEnd,
      period, form.interestDuringMoratorium === 'CAPITALIZED',
      parseRepaymentProfile(form.repaymentProfileJson), form.repaymentFrequency === 'QUARTERLY',
    );

    // Min./Max. DSRA — the same rolling current+next-period reserve figure
    // dsraAmount already prices for the first period, computed at every
    // period of *this* (frequency-aware, EOMONTH-dated) schedule instead of
    // just the first, then reduced to its extremes across the whole tenor.
    // dsraByPeriod (the series itself, one entry per amortizing period, in
    // schedule order) is what the table's own per-row DSRA Amount column
    // reads — the same numbers Min./Max. are reduced from, not a second,
    // separately-priced figure.
    const dsraPeriods = parseReservePeriods(form.dsra);
    if (dsraPeriods !== null) {
      if (dsraPeriods === 0) {
        out.minDsraAmount = 'Nil';
        out.maxDsraAmount = 'Nil';
      } else {
        const series = dsraSeries(out.schedule, dsraPeriods);
        if (series.length) {
          out.dsraByPeriod = series;
          out.minDsraAmount = formatCrore(Math.min(...series));
          out.maxDsraAmount = formatCrore(Math.max(...series));
        }
      }
    } else if (out.dsraAmount === 'Not Calculated') {
      out.minDsraAmount = 'Not Calculated';
      out.maxDsraAmount = 'Not Calculated';
    }

    // Same three-way fallback rule as the israAmount point figure in
    // deriveSanction: the ISRA clause's own period count when it parses; no
    // series (like 'Not Calculated') when text is present but unparseable;
    // DSRA's period count only when there's no ISRA clause at all (blank).
    const israText = String(form.isra || '').trim();
    const israPeriods = parseReservePeriods(form.isra);
    const israSeriesPeriods = israPeriods !== null ? israPeriods
      : israText === '' ? dsraPeriods : null;
    if (israSeriesPeriods) {
      const series = israSeries(out.schedule, israSeriesPeriods);
      if (series.length) out.israByPeriod = series;
    }
  }
  return out;
};

/**
 * One deriveRepaymentSchedule() result per Sanction Term on `sanctionLike`
 * (a live SanctionFormModal `form` draft, or an already-saved sanction
 * wrapper straight from the API — both have the same `.terms[]` shape),
 * each fed that term's own Actual Disb. Date, Term Limit, and repayment-
 * percentage profile instead of the whole sanction's. Shared by
 * SanctionFormModal's own Repayment Schedule tab and the read-only
 * Repayment Schedule section on the Borrower/Group Detail pages
 * (SanctionOverviewPanel.js) — one calculation, not two copies that could
 * drift apart.
 */
export const buildTermScheduleViews = (sanctionLike) => (sanctionLike?.terms || []).map((term) => deriveRepaymentSchedule({
  ...sanctionLike,
  disbursementDate: term.actualDisbursementDate,
  debtAmount: term.termLimit,
  repaymentStartDate: '',
  repaymentEndDate: '',
  repaymentProfileJson: term.repaymentProfileJson || '',
}));

export default deriveSanction;
