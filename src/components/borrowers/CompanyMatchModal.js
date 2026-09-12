// src/components/borrowers/CompanyMatchModal.js
//
// Inserted between "letter parsed" and the sanction review form. Same one
// modal either way; a match (CIN exact, then normalized legal name exact —
// see BorrowerService.matchBorrower; no alias or fuzzy-similarity tier feeds
// this decision) is only ever a suggestion, never applied on its own — it
// adds a small "✓ ... MATCHED" note plus one explicit either/or: add this
// sanction to the matched company, or treat it as a separate new company. No
// match at all skips straight to the ordinary New Company form below.
//
// EXTRACT → MATCH DATABASE → SHOW SUGGESTION → USER CONFIRMS OR CHOOSES NEW
// → ALLOCATE. Once past that one either/or (or when there was never a match
// to decide on), the New Company form's three fields — Company name,
// Parent Group / Sub Group (HierarchyPicker's existing
// select-existing-or-create mechanism), and Company Type — together decide
// the sanction's one owner, entirely by what's filled in, never by a
// separate "what do you want to create" question:
//
//   no group          + a type checked  -> top-level company of that type
//   Parent Group      + a type checked  -> company of that type under the group
//   Parent Group      + no type checked -> the sanction attaches directly to
//   Sub Group         + no type checked    the Group/Sub Group itself — no
//                                           company is ever created for it
//   Parent+Sub Group  + a type checked  -> company of that type under the sub group
//
// Company Type is three independent checkboxes — Standalone / Subsidiary /
// SPV — not HierarchyPicker's own two (Subsidiary/SPV, suppressed here via
// `hideCompanyType`): "none checked" must be distinguishable from
// "Standalone explicitly checked", since only the former means "attach
// directly to the group" once a group is selected. Standalone is mutually
// exclusive with Subsidiary/SPV (by definition); Subsidiary + SPV together
// remains fully supported, unchanged.

import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { X, Check, Building2, AlertTriangle } from 'lucide-react';
import borrowerApi from '../../services/borrowerApi';
import { BORROWER_IMPORT_KEYS, toCin } from './borrowerFields';
import HierarchyPicker, { EMPTY_HIERARCHY } from './HierarchyPicker';
import '../../pages-css/BorrowerRegistry.css';

// Same-shape, lighter-weight normalizers than the backend's own (which the
// backend already applied to actually decide the match) — these exist only
// to LABEL, for the top candidate already returned by the server, whether
// its CIN and/or its name independently agree with the letter's own
// extracted values. Never used to decide inclusion/ranking — only to render
// the explicit "✓ CIN MATCHED" / "○ CIN NOT MATCHED" breakdown.
const normalizeCinLite = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeNameLite = (v) => String(v || '').toLowerCase().trim().replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();

const deriveMatchStatus = (identity, candidate) => {
  if (!candidate) return null;
  const cinMatch = candidate.confidence === 'CIN'
    ? true
    : !!(identity.cin && candidate.cin && normalizeCinLite(identity.cin) === normalizeCinLite(candidate.cin));
  const nameMatch = candidate.confidence === 'NAME'
    ? true
    : normalizeNameLite(identity.borrowerName) === normalizeNameLite(candidate.borrowerName);
  const overall = cinMatch && nameMatch ? 'EXACT'
    : cinMatch ? 'CIN_ONLY'
      : nameMatch ? 'NAME_ONLY'
        : 'NONE';
  return { cinMatch, nameMatch, overall };
};

const OVERALL_COPY = {
  EXACT: 'EXACT MATCH',
  CIN_ONLY: 'CIN MATCH',
  NAME_ONLY: 'NAME MATCH',
  NONE: 'NO MATCH',
};

// presetHierarchy: when this import was started from a Parent/Sub Group's
// own page ("Import Sanction Letter" or "Add Sanction for this Group/Sub
// Group"), carries that group forward as the New Company form's own
// starting Parent/Sub Group — see GroupDetail.js's own `presetHierarchy`
// construction, which already covers both the Parent-Group-page and
// Sub-Group-page cases. Only ever relevant once the reviewer has explicitly
// chosen "create as a separate new company" over a matched one, or when
// there was no match to choose over — the context this import was started
// from is only ever a default, never a substitute for an explicit choice.
const CompanyMatchModal = ({
  parsed, presetHierarchy = null, onClose, onResolved, onResolvedGroup,
}) => {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);

  const [name, setName] = useState(parsed?.borrowerName || '');
  const baseHierarchy = useMemo(
    () => (presetHierarchy ? { ...EMPTY_HIERARCHY, ...presetHierarchy } : { ...EMPTY_HIERARCHY }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [hierarchy, setHierarchy] = useState(() => ({ ...baseHierarchy }));
  // A third, independent checkbox alongside hierarchy.isSubsidiary/isSpv —
  // see the file comment for why "none checked" must stay distinguishable
  // from "Standalone checked".
  const [typeStandalone, setTypeStandalone] = useState(false);
  // A match is only ever a suggestion — never applied on its own. Set once
  // the reviewer explicitly answers "how do you want to proceed?" below;
  // null (undecided) blocks Confirm for as long as a match exists.
  const [matchDecision, setMatchDecision] = useState(null); // null | 'USE_MATCH' | 'NEW_COMPANY'

  const [dupes, setDupes] = useState([]);
  const [error, setError] = useState('');

  const identity = useMemo(() => {
    const id = { borrowerName: parsed?.borrowerName || '' };
    BORROWER_IMPORT_KEYS.forEach((k) => {
      const v = parsed?.[k];
      if (v != null && String(v).trim()) id[k] = String(v);
    });
    return id;
  }, [parsed]);

  // Computed once against the top match found (if any) — never re-run as
  // the reviewer edits the form below; editing is exactly what this screen
  // is for.
  const matchStatusInfo = useMemo(
    () => deriveMatchStatus(identity, candidates[0] || null)
      || { cinMatch: false, nameMatch: false, overall: 'NONE' },
    [identity, candidates],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    borrowerApi.matchBorrower(identity)
      .then((list) => {
        if (cancelled) return;
        setCandidates(list);
      })
      .catch(() => setCandidates([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStandalone = () => {
    const next = !typeStandalone;
    setTypeStandalone(next);
    if (next) setHierarchy((h) => ({ ...h, isSubsidiary: false, isSpv: false }));
  };
  const toggleSubsidiary = () => {
    const next = !hierarchy.isSubsidiary;
    setHierarchy((h) => ({ ...h, isSubsidiary: next }));
    if (next) setTypeStandalone(false);
  };
  const toggleSpv = () => {
    const next = !hierarchy.isSpv;
    setHierarchy((h) => ({ ...h, isSpv: next }));
    if (next) setTypeStandalone(false);
  };

  const hasMatch = candidates.length > 0;

  // A group is "selected" the moment either an existing one is picked or a
  // new one has actually been named — matches resolveHierarchyGroupId's own
  // notion of "not standalone".
  const groupSelected = !!(hierarchy.parentGroupId || hierarchy.newParentName?.trim());
  const subGroupSelected = !!(hierarchy.subGroupId || hierarchy.newSubName?.trim());
  const anyTypeSelected = typeStandalone || !!hierarchy.isSubsidiary || !!hierarchy.isSpv;

  // When no Company Type is checked, the sanction attaches directly to the
  // Group/Sub Group itself (see resolveGroupTarget below) — that group IS
  // the entity the letter names, so a brand-new group being typed here
  // should inherit the letter's own extracted CIN/address rather than leave
  // the reviewer to retype them. Only the DEEPEST new level is the actual
  // sanctioned entity (a Sub Group, if one is being created, is always the
  // target — never its Parent, even though the Parent is created alongside
  // it), matching resolveGroupTarget's own precedence below. Tracks which
  // field it last wrote to (and what it wrote) so that if the reviewer adds
  // a Sub Group *after* the Parent was auto-filled, the now-wrong Parent
  // value is cleared rather than left stuck on both fields at once — but
  // only ever undoes its own writes, never something the reviewer typed.
  const autoFillRef = useRef({ cinField: null, cinValue: null, addrField: null, addrValue: null });
  useEffect(() => {
    if (anyTypeSelected) return;
    const cin = parsed?.cin ? toCin(parsed.cin) : '';
    const address = parsed?.registeredAddress?.trim() || '';

    const subIsNew = subGroupSelected && hierarchy.newSubName?.trim() && !hierarchy.subGroupId;
    const parentIsNew = groupSelected && hierarchy.newParentName?.trim() && !hierarchy.parentGroupId;
    const targetField = subIsNew ? 'sub' : (parentIsNew ? 'parent' : null);

    setHierarchy((h) => {
      let next = h;
      const ref = autoFillRef.current;

      if (ref.cinField && ref.cinField !== targetField) {
        const key = ref.cinField === 'sub' ? 'newSubCin' : 'newParentCin';
        if (next[key] === ref.cinValue) next = { ...next, [key]: '' };
        ref.cinField = null; ref.cinValue = null;
      }
      if (ref.addrField && ref.addrField !== targetField) {
        const key = ref.addrField === 'sub' ? 'newSubAddress' : 'newParentAddress';
        if (next[key] === ref.addrValue) next = { ...next, [key]: '' };
        ref.addrField = null; ref.addrValue = null;
      }
      if (targetField && cin) {
        const key = targetField === 'sub' ? 'newSubCin' : 'newParentCin';
        if (!next[key]) {
          next = { ...next, [key]: cin };
          ref.cinField = targetField; ref.cinValue = cin;
        }
      }
      if (targetField && address) {
        const key = targetField === 'sub' ? 'newSubAddress' : 'newParentAddress';
        if (!next[key]) {
          next = { ...next, [key]: address };
          ref.addrField = targetField; ref.addrValue = address;
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parsed?.cin, parsed?.registeredAddress, anyTypeSelected, groupSelected, subGroupSelected,
    hierarchy.newParentName, hierarchy.newSubName,
    hierarchy.parentGroupId, hierarchy.subGroupId,
  ]);

  // Advisory-only "you're about to import a second letter from the same
  // lender on the same day" check — runs the moment the reviewer picks an
  // existing match, using the candidate's own borrowerId directly (no
  // resolve() call needed, unlike before: that call no longer happens until
  // Save). Only meaningful for an EXISTING company; a brand-new one can't
  // already have a conflicting sanction on file.
  useEffect(() => {
    if (matchDecision !== 'USE_MATCH' || !parsed?.lenderName || !parsed?.sanctionDate) {
      setDupes([]);
      return;
    }
    let cancelled = false;
    borrowerApi.checkDuplicateSanction(candidates[0].borrowerId, parsed.lenderName, parsed.sanctionDate)
      .then((hits) => { if (!cancelled) setDupes(hits); })
      .catch(() => { /* advisory only — never blocks confirm */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchDecision, candidates, parsed?.lenderName, parsed?.sanctionDate]);

  const canConfirm = () => {
    if (hasMatch) {
      if (matchDecision === 'USE_MATCH') return true;
      if (matchDecision !== 'NEW_COMPANY') return false; // undecided — must explicitly pick one
    }
    if (groupSelected && !anyTypeSelected) return true;
    return !!name.trim();
  };

  /**
   * NO PERSISTENCE HERE — this used to call borrowerApi.resolve /
   * resolveWithHierarchy / createGroup immediately, committing the company
   * (and any new group) to the database before the sanction was ever saved.
   * If the reviewer then cancelled the "Review what was read" screen, that
   * company/group was left behind with zero sanctions (best-effort client
   * delete on cancel, not atomic — a closed tab or crash still orphaned it).
   *
   * Now this just hands the reviewer's choice up as plain data — a
   * `pending` descriptor — and SanctionFormModal's own Save is the ONLY
   * place any of this is written, bundling the company/group resolution
   * and the sanction into ONE backend call (see BorrowerService's
   * maybePersistAttachedSanction for the company/matched-company cases,
   * both fully transactional; the group-only case still runs
   * resolveHierarchyGroupId + saveGroupSanction as two calls, but now only
   * at Save time, never before — see the 2026-09-07 no-persistence-before-
   * Save fix).
   */
  const handleConfirm = () => {
    setError('');
    if (hasMatch && matchDecision === 'USE_MATCH') {
      const matched = candidates[0];
      onResolved({ kind: 'MATCH', identity: { ...identity, borrowerName: matched.borrowerName } });
      return;
    }

    if (groupSelected && !anyTypeSelected) {
      if (subGroupSelected ? !(hierarchy.subGroupId || hierarchy.newSubName?.trim())
        : !(hierarchy.parentGroupId || hierarchy.newParentName?.trim())) {
        setError('Select or create a Parent Group');
        return;
      }
      const groupName = subGroupSelected
        ? (hierarchy.subGroupName || hierarchy.newSubName.trim())
        : (hierarchy.parentGroupName || hierarchy.newParentName?.trim() || '');
      onResolvedGroup({
        kind: 'GROUP', hierarchy: { ...hierarchy }, groupName,
        type: subGroupSelected ? 'SUB_GROUP' : 'GROUP',
        // The letter's own parsed CIN/registered address — HierarchyPicker's
        // "+ Create new..." inputs already get these via the autoFillRef
        // effect above, but that only writes into the NEW-group form
        // fields. When the group picked is an EXISTING one instead, there's
        // no field for it to land in, so it's carried separately here and
        // applied server-side (BorrowerService#fillGroupIdentityBlanks) —
        // only onto that group's currently-blank fields, never overwriting
        // something already on file.
        letterCin: parsed?.cin || '',
        letterRegisteredAddress: parsed?.registeredAddress || '',
      });
      return;
    }

    if (!name.trim()) { setError('Company name is required'); return; }
    onResolved({
      kind: 'COMPANY',
      identity: { ...identity, borrowerName: name.trim() },
      hierarchy: { ...hierarchy },
    });
  };

  return (
    <div className="br-modal-backdrop">
      <div className="br-modal" onMouseDown={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Confirm company">
        <div className="br-modal-head">
          <div className="br-viewer-title">
            <Building2 size={18} aria-hidden="true" />
            <div className="br-viewer-title-text">
              <h3 className="br-modal-title">Confirm company</h3>
              {parsed?.borrowerName && (
                <p className="br-modal-sub">The letter names <strong>{parsed.borrowerName}</strong>.</p>
              )}
            </div>
          </div>
          <button type="button" className="br-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="br-modal-body br-modal-body-single br-match-body">
          {loading && <p className="br-muted">Looking for a matching company…</p>}

          {/* Compact Match Status — an indication only, never a different
              screen. The SAME form below is shown either way. */}
          {!loading && matchStatusInfo && matchStatusInfo.overall !== 'NONE' && (
            <fieldset className="br-fieldset">
              <legend className="br-fieldset-legend">Match Status</legend>
              <div className="br-match-status-row">
                <span className={matchStatusInfo.cinMatch ? 'br-match-status-yes' : 'br-match-status-no'}>
                  {matchStatusInfo.cinMatch ? '✓ CIN MATCHED' : '○ CIN NOT MATCHED'}
                </span>
                <span className={matchStatusInfo.nameMatch ? 'br-match-status-yes' : 'br-match-status-no'}>
                  {matchStatusInfo.nameMatch ? '✓ COMPANY NAME MATCHED' : '○ COMPANY NAME NOT MATCHED'}
                </span>
              </div>
              <p className="br-match-status-overall">
                <strong>{OVERALL_COPY[matchStatusInfo.overall]}</strong>
              </p>
            </fieldset>
          )}

          {/* One explicit either/or, only when a match exists — a match is
              a suggestion, never auto-applied. Neither option duplicates
              the Company Name/Parent Group/Sub Group/Company Type fields;
              "add to matched company" needs none of them, and "separate new
              company" simply reveals the ordinary New Company form below. */}
          {!loading && hasMatch && (
            <fieldset className="br-fieldset">
              <legend className="br-fieldset-legend">Matched Company</legend>
              <p className="br-match-sub" style={{ marginBottom: 10 }}>
                <strong>{candidates[0].borrowerName}</strong>
                {candidates[0].cin ? ` · CIN ${candidates[0].cin}` : ''}
              </p>
              <span className="br-field-label">How do you want to proceed?</span>
              <div className="br-match-list" style={{ marginTop: 6 }}>
                <label className={`br-match-card ${matchDecision === 'USE_MATCH' ? 'br-match-card-selected' : ''}`}>
                  <span className="br-match-name">
                    <input
                      type="radio" name="match-decision"
                      checked={matchDecision === 'USE_MATCH'}
                      onChange={() => setMatchDecision('USE_MATCH')}
                      style={{ marginRight: 8 }}
                    />
                    Add sanction to this matched company
                  </span>
                </label>
                <label className={`br-match-card ${matchDecision === 'NEW_COMPANY' ? 'br-match-card-selected' : ''}`}>
                  <span className="br-match-name">
                    <input
                      type="radio" name="match-decision"
                      checked={matchDecision === 'NEW_COMPANY'}
                      onChange={() => setMatchDecision('NEW_COMPANY')}
                      style={{ marginRight: 8 }}
                    />
                    Create as a separate new company
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {!loading && !hasMatch && (
            <p className="br-muted">No existing company was found.</p>
          )}

          {!loading && (!hasMatch || matchDecision === 'NEW_COMPANY') && (
            <fieldset className="br-fieldset">
              <legend className="br-fieldset-legend">New company</legend>
              <div className="br-form-grid">
                <label className="br-field">
                  <span className="br-field-label">Company name<span className="br-req"> *</span></span>
                  <input className="br-input" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              </div>
              <div style={{ marginTop: 10 }}>
                <HierarchyPicker value={hierarchy} onChange={setHierarchy} hideCompanyType />
              </div>

              {/* Exactly where HierarchyPicker's own Subsidiary/SPV
                  checkboxes sit for every other caller — Standalone is
                  added here as a third, explicit option so "nothing
                  checked" stays a distinct, meaningful state (see file
                  comment). */}
              <label className="br-field" style={{ marginTop: 10 }}>
                <span className="br-field-label">Company Type</span>
                <div className="br-checkbox-row">
                  <label className="br-checkbox">
                    <input type="checkbox" checked={typeStandalone} onChange={toggleStandalone} />
                    Standalone
                  </label>
                  <label className="br-checkbox">
                    <input type="checkbox" checked={!!hierarchy.isSubsidiary} onChange={toggleSubsidiary} />
                    Subsidiary
                  </label>
                  <label className="br-checkbox">
                    <input type="checkbox" checked={!!hierarchy.isSpv} onChange={toggleSpv} />
                    SPV
                  </label>
                </div>
              </label>

              {groupSelected && !anyTypeSelected && (
                <p className="br-field-hint br-match-status-yes" style={{ marginTop: 8 }}>
                  ✓ No company type selected — this sanction will be added directly to
                  {subGroupSelected ? ' the Sub Group' : ' the Parent Group'} above; no company is created.
                </p>
              )}
            </fieldset>
          )}

          {dupes.length > 0 && (
            <div className="br-banner br-banner-warn">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                This company already has a sanction from the same lender dated the same day
                ({dupes.map((d) => d.refNo).join(', ')}). Continuing will save this as a separate letter —
                check it isn't the same one re-imported under a different reference number.
              </span>
            </div>
          )}
        </div>

        {error && <div className="br-banner br-banner-danger">{error}</div>}

        <div className="br-modal-foot">
          <button type="button" className="br-btn" onClick={onClose}>Cancel</button>
          <button
            type="button" className="br-btn br-btn-primary"
            onClick={handleConfirm}
            disabled={loading || !canConfirm()}
          >
            <Check size={15} aria-hidden="true" />
            Confirm and continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanyMatchModal;
