// src/services/technologyTaxonomyApi.js
// Project Details (Technology area) Group / Sub Group dropdowns — a
// standalone taxonomy and its own API, deliberately separate from
// filterApi.js's existing Group/SubGroup filters used elsewhere in the app.

const API_BASE_URL = process.env.REACT_APP_API_URL;

const getUser = () => {
  try {
    const raw = localStorage.getItem('bd_portal_user');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.user || {};
  } catch { return {}; }
};

const getAuthHeaders = () => {
  const u = getUser();
  const id   = String(u.id   || '');
  const role = String(u.role || '');
  return {
    'Content-Type': 'application/json',
    'User-Id':     id,
    'User-Role':   role,
    'X-User-Id':   id,
    'X-User-Role': role,
  };
};

const technologyTaxonomyApi = {
  getTechnologyGroups: async () => {
    const response = await fetch(`${API_BASE_URL}/technology-taxonomy/groups`, {
      credentials: 'include',
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  },

  getTechnologySubGroups: async (groupName) => {
    const params = new URLSearchParams({ groupName });
    const response = await fetch(`${API_BASE_URL}/technology-taxonomy/subgroups?${params}`, {
      credentials: 'include',
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  },
};

export default technologyTaxonomyApi;
