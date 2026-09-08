// ─────────────────────────────────────────────────────────────────────────────
//  ActivityNameSelect — a standardised scope-activity / sub-item name field.
//
//  A name picked from a list is a name that matches everywhere else: the BOM
//  tab groups its materials under a scope activity BY NAME (case-insensitively),
//  and a project generated from a template inherits those names, so "Testing &
//  Commissioning" typed freehand as "Testing and commissioning" quietly splits
//  one activity into two. Offering the list first is what keeps them one.
//
//  The list is the same one the lead Technical Scope tab shows: the built-in
//  ACTIVITY_SUGGESTIONS plus every name anyone has typed before, held shared in
//  scope_activity_suggestion. "Other (type your own)…" is deliberately still
//  there — a standard nobody can add to is one people work around — and a name
//  typed into it is posted back so it is on the list for everyone next time.
//
//  Names already saved but no longer in the list (an older template, a name
//  removed upstream) are added as their own option, so opening a template can
//  never silently blank a name the user did not touch.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import api from "../../services/leadsapi.js";
import { ACTIVITY_SUGGESTIONS, OTHER_OPTION } from "../../constants/scopeActivities.js";
import "./ActivityNameSelect.css";

/**
 * The shared name list, fetched once per mount of the page that uses it.
 * Returns { options, register } — `register(name)` persists a typed name.
 */
export function useActivityNames() {
  const [extra, setExtra] = useState([]);

  React.useEffect(() => {
    // {success, data:{names:[...]}} — not a bare array.
    api.get("/order-book/scope-activities")
      .then(res => { if (Array.isArray(res?.data?.names)) setExtra(res.data.names); })
      .catch(() => {});
  }, []);

  const options = React.useMemo(() => {
    const merged = [...ACTIVITY_SUGGESTIONS];
    extra.forEach(n => {
      if (n && !merged.some(m => m.toLowerCase() === n.toLowerCase())) merged.push(n);
    });
    return merged;
  }, [extra]);

  // Persist a user-typed name so it shows in the dropdown next time, for everyone.
  const register = React.useCallback((name) => {
    const n = (name || "").trim();
    if (!n) return;
    setExtra(prev => (prev.some(m => m.toLowerCase() === n.toLowerCase()) ? prev : [...prev, n]));
    if (ACTIVITY_SUGGESTIONS.some(m => m.toLowerCase() === n.toLowerCase())) return;
    api.post("/order-book/scope-activities", { name: n }).catch(() => {});
  }, []);

  return { options, register };
}

/**
 * @param value      current name ("" when unset)
 * @param onChange   (name) => void
 * @param options    from useActivityNames()
 * @param register   from useActivityNames()
 * @param className  applied to the select/input so the host page styles it
 * @param placeholder text for the empty option
 */
export default function ActivityNameSelect({
  value, onChange, options, register, className = "", placeholder = "Select activity…",
}) {
  // Free-text mode is local: a name that IS on the list should come back as a
  // list selection next time the row renders, not stay stuck in an input.
  const [custom, setCustom] = useState(false);
  const known = !value || options.some(o => o.toLowerCase() === String(value).toLowerCase());

  if (custom) {
    return (
      <div className="ans-custom">
        <input
          className={className} value={value} autoFocus placeholder="Type a name"
          onChange={e => onChange(e.target.value)}
          onBlur={e => register(e.target.value)}
        />
        <button
          type="button" className="ans-back" title="Back to the standard list"
          onClick={() => { setCustom(false); onChange(""); }}
        >↩</button>
      </div>
    );
  }

  return (
    <select
      className={className} value={value || ""}
      onChange={e => {
        if (e.target.value === OTHER_OPTION) { setCustom(true); onChange(""); }
        else onChange(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {!known && <option value={value}>{value}</option>}
      {options.map(a => <option key={a} value={a}>{a}</option>)}
      <option value={OTHER_OPTION}>Other (type your own)…</option>
    </select>
  );
}
