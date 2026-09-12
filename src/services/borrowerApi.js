// src/services/borrowerApi.js
//
// Service layer for the Borrower Registry. Mirrors tenderApi.js: reads the
// logged-in user from the `bd_portal_user` localStorage key, always sends
// credentials:'include' (session-cookie auth) plus the User-Id / User-Role
// headers, and unwraps the backend's { success, message, data } envelope.
// Talks to the Spring Boot BorrowerController at /borrower.

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';

const getUser = () => {
  try {
    const raw = localStorage.getItem('bd_portal_user');
    if (!raw) return {};
    return JSON.parse(raw)?.user || {};
  } catch { return {}; }
};

const getAuthHeaders = () => {
  const u = getUser();
  const id = String(u.id || '');
  const role = String(u.role || '');
  return {
    'Content-Type': 'application/json',
    'User-Id': id,
    'User-Role': role,
    'X-User-Id': id,
    'X-User-Role': role,
  };
};

const req = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: getAuthHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty/non-JSON body */ }
  if (!res.ok || json.success === false) {
    throw new Error(json.message || `Request failed (HTTP ${res.status})`);
  }
  return json;
};

// Multipart / blob helpers — `req` above always JSON.stringifies its body and
// can't read binary, so document calls use raw fetch. Same auth, but WITHOUT a
// Content-Type so the browser sets the multipart boundary itself.
const authHeadersRaw = () => {
  const u = getUser();
  const id = String(u.id || '');
  const role = String(u.role || '');
  return { 'User-Id': id, 'User-Role': role, 'X-User-Id': id, 'X-User-Role': role };
};

const postFile = async (path, file, failLabel) => {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST', credentials: 'include', headers: authHeadersRaw(), body: fd,
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty/non-JSON body */ }
  if (!res.ok || json.success === false) {
    throw new Error(json.message || `${failLabel} (HTTP ${res.status})`);
  }
  return json.data;
};

const borrowerApi = {
  getAll: async (search) => {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    const suffix = qs.toString() ? `?${qs}` : '';
    return (await req(`/borrower/getAll${suffix}`)).data || [];
  },

  getById: async (id) => (await req(`/borrower/${id}`)).data,

  create: async (borrower) =>
    (await req('/borrower/create', { method: 'POST', body: borrower })).data,

  update: async (id, borrower) =>
    (await req(`/borrower/update/${id}`, { method: 'PUT', body: borrower })).data,

  remove: async (id) => req(`/borrower/delete/${id}`, { method: 'DELETE' }),

  // Find-or-create by name. Called once the user confirms which company a
  // reviewed letter belongs to, so the sanction has a borrower to hang off.
  //
  // Takes either a bare name or a whole identity object — the letter also
  // carries promoter, guarantor, group, Cat / Sub Cat and the SL ref., which
  // have no home on the sanction row. The server fills only blank fields with
  // them, so importing never overwrites something a user typed.
  resolve: async (borrowerOrName) => {
    const body = typeof borrowerOrName === 'string'
      ? { borrowerName: borrowerOrName }
      : borrowerOrName;
    return (await req('/borrower/resolve', { method: 'POST', body })).data;
  },

  // Stateless parse → partial field map. Writes nothing; safe to call before
  // any borrower exists.
  parseSanction: async (file) =>
    (await postFile('/borrower/parse-sanction', file, 'Could not read the document')) || {},

  // `rawExtracted` is the untouched parser output, stored alongside the saved
  // values so an edited figure can be audited against what was read.
  // identityCin/identityRegisteredAddress: a reviewer's correction to a
  // misread CIN/registered address, made on the same "Review what was
  // read" screen — applied to the borrower in the SAME backend transaction
  // as the sanction save (see BorrowerService#saveSanction), so a failure
  // partway through can never leave the borrower updated with no sanction
  // to show for it (2026-09-02 save-flow atomicity fix).
  saveSanction: async (sanction, rawExtracted, identityCin, identityRegisteredAddress) =>
    (await req('/borrower/sanction/save', {
      method: 'POST', body: { sanction, rawExtracted, identityCin, identityRegisteredAddress },
    })).data,

  // A sanction associated directly with a Parent Group or Sub Group, not any
  // company — see BorrowerService#saveGroupSanction. Returns the saved
  // sanction wrapper directly (there's no borrower to nest it under).
  // groupIdentity: optional { cin, registeredAddress } parsed off the letter
  // — back-fills an EXISTING group's own blank fields server-side, never
  // overwriting something already on file (BorrowerService#fillGroupIdentityBlanks).
  saveGroupSanction: async (groupId, sanction, rawExtracted, groupIdentity) =>
    (await req(`/borrower/groups/${groupId}/sanction/save`, {
      method: 'POST', body: { sanction, rawExtracted, groupIdentity },
    })).data,

  // Sanctions associated directly with one Parent Group or Sub Group —
  // never a child company's own sanctions.
  listGroupSanctions: async (groupId) =>
    (await req(`/borrower/groups/${groupId}/sanctions`)).data || [],

  removeSanction: async (id) => req(`/borrower/sanction/delete/${id}`, { method: 'DELETE' }),

  // The one editable Active/Inactive control — changes only this sanction's
  // own status. Every Company/Parent Group/Sub Group's own displayed status
  // is derived from sanctions like this one at read time, never stored or
  // edited directly — see BorrowerService.deriveStatusLabel.
  updateSanctionStatus: async (id, activeStatus) =>
    (await req(`/borrower/sanction/${id}/status`, { method: 'PUT', body: { activeStatus } })).data,

  uploadDoc: async (sanctionId, file) =>
    postFile(`/borrower/sanction/${sanctionId}/upload-doc`, file, 'Upload failed'),

  // Returns { kind: 'PDF' | 'HTML', fileName, mimeType, size, html? }.
  // Word files come back as sanitised HTML rendered server-side, since no
  // browser can display a .docx — that is what makes in-page viewing possible.
  previewDoc: async (sanctionId) =>
    (await req(`/borrower/sanction/${sanctionId}/preview-doc`)).data,

  // Blob URL for the in-page viewer iframe (PDFs) or a download (Word).
  docBlobUrl: async (sanctionId) => {
    const res = await fetch(
      `${API_BASE_URL}/borrower/sanction/${sanctionId}/download-doc`,
      { method: 'GET', credentials: 'include', headers: authHeadersRaw() },
    );
    if (!res.ok) throw new Error(`Could not load the document (HTTP ${res.status})`);
    return URL.createObjectURL(await res.blob());
  },

  // Authenticated file download for an SPA: fetch the bytes ourselves (so
  // User-Id/User-Role go out as real headers, same as every other call
  // here), then hand the browser a blob URL to save exactly the way a
  // normal download link would. Same fetch-then-blob shape as docBlobUrl
  // above, just triggering a save instead of an inline viewer.
  downloadDocFile: async (sanctionId, fileName) => {
    const res = await fetch(
      `${API_BASE_URL}/borrower/sanction/${sanctionId}/download-doc?forceDownload=true`,
      { method: 'GET', credentials: 'include', headers: authHeadersRaw() },
    );
    if (!res.ok) throw new Error(`Could not download the document (HTTP ${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'sanction-letter';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ── company hierarchy ──

  // Top-level Parent Groups when parentId is omitted, else the Sub Groups
  // under that Parent Group.
  getGroups: async (parentId) => {
    const qs = parentId ? `?parentId=${parentId}` : '';
    return (await req(`/borrower/groups${qs}`)).data || [];
  },

  searchGroups: async (q) =>
    (await req(`/borrower/groups/search?q=${encodeURIComponent(q || '')}`)).data || [],

  createGroup: async (group) =>
    (await req('/borrower/groups', { method: 'POST', body: group })).data,

  updateGroup: async (id, group) =>
    (await req(`/borrower/groups/${id}`, { method: 'PUT', body: group })).data,

  // Deletes a Parent Group or Sub Group and everything under it — every
  // company in it (sanctions and documents with it) and, for a Parent
  // Group, every Sub Group beneath it too. Irreversible.
  deleteGroup: async (id) => req(`/borrower/groups/${id}`, { method: 'DELETE' }),

  // With no args: the whole Group -> Sub Group -> Company tree, plus
  // standalone companies (used by Group Detail's own summary lookups
  // elsewhere going away — kept for any caller that still wants everything
  // in one shot). With page/size: just that page of the Level-1 list
  // (top-level Parent Groups + standalone companies) plus registry-wide
  // stats and pagination metadata — what the hierarchy view itself uses.
  getHierarchy: async (page, size, search) => {
    const qs = new URLSearchParams();
    if (page !== undefined) qs.set('page', page);
    if (size !== undefined) qs.set('size', size);
    if (search) qs.set('search', search);
    const suffix = qs.toString() ? `?${qs}` : '';
    return (await req(`/borrower/hierarchy${suffix}`)).data;
  },

  // One Parent Group or Sub Group's own summary — breadcrumb + stat-card
  // figures (direct/total companies, sub-group count, total SPVs, total
  // sanctioned amount) — no nested companies/subGroups arrays; those come
  // from getGroupCompanies/getSubGroups below, one page at a time.
  getGroupDetail: async (id) => (await req(`/borrower/groups/${id}`)).data,

  // One page of the companies sitting directly under a group — used for
  // both a Parent Group's Direct Companies table and any Sub Group's own
  // inline table (call with that Sub Group's id).
  getGroupCompanies: async (groupId, page, size) =>
    (await req(`/borrower/groups/${groupId}/companies?page=${page}&size=${size}`)).data,

  // One page of the Sub Groups sitting directly under a Parent Group, each
  // with its own summary (company count, sanctions, total amount) — not
  // their companies, which come from getGroupCompanies once a panel opens.
  getSubGroups: async (groupId, page, size) =>
    (await req(`/borrower/groups/${groupId}/subgroups?page=${page}&size=${size}`)).data,

  // Move a company between groups (or in/out of standalone). Never touches
  // its sanctions — group_id lives only on the borrower row.
  updateHierarchy: async (borrowerId, { groupId, isSubsidiary, isSpv }) =>
    (await req(`/borrower/${borrowerId}/hierarchy`, {
      method: 'PUT', body: { groupId, isSubsidiary, isSpv },
    })).data,

  // Atomic resolve + hierarchy-placement for the sanction-import "confirm
  // this company" step (CompanyMatchModal) — one backend transaction that
  // also creates the Parent/Sub Group itself when asked to (pass
  // newParentGroupName/newSubGroupName), rather than the frontend creating
  // the group first via a separate createGroup() call and only then
  // resolving the borrower — that used to let a failure after group
  // creation leave the new group committed with no company/sanction
  // attached to it (2026-09-02 save-flow atomicity fix).
  resolveWithHierarchy: async (identity, {
    parentGroupId, newParentGroupName, newParentGroupCin, newParentGroupAddress,
    subGroupId, newSubGroupName, newSubGroupCin, newSubGroupAddress,
    isSubsidiary, isSpv,
  }) =>
    (await req('/borrower/resolve-with-hierarchy', {
      method: 'POST',
      body: {
        identity, parentGroupId, newParentGroupName, newParentGroupCin, newParentGroupAddress,
        subGroupId, newSubGroupName, newSubGroupCin, newSubGroupAddress,
        isSubsidiary, isSpv,
      },
    })).data,

  // Candidate borrowers for a parsed letter's identity, ranked by
  // confidence (CIN > normalized name > alias > fuzzy). Never auto-attaches
  // anything — always a list for the reviewer to confirm or reject.
  matchBorrower: async (identity) =>
    (await req('/borrower/match', { method: 'POST', body: identity })).data || [],

  // Soft duplicate check: same lender + sanction date on the same company.
  // Advisory only — the ref. no. duplicate check elsewhere is the hard block.
  checkDuplicateSanction: async (borrowerId, lenderName, sanctionDate) => {
    const qs = new URLSearchParams({ borrowerId, lenderName, sanctionDate });
    return (await req(`/borrower/sanction/check-duplicate?${qs}`)).data || [];
  },
};

export default borrowerApi;