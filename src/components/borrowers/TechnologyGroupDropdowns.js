// src/components/borrowers/TechnologyGroupDropdowns.js
// Project Details (Technology area) Group / Sub Group dropdowns. Standalone
// component — does NOT reuse or modify GroupProjectFilter.js /
// GroupSubgroupWarehouseFilter.js or their /filters/groups /filters/subgroups
// data (that is a separate, existing org-level taxonomy used elsewhere in the
// app). Uses the shared FilterSelect primitive purely for a matching visual
// style (pill trigger + chevron), and the modal's own generic br-field /
// br-form-grid layout classes for label/spacing consistency.
import React, { useState, useEffect } from 'react';
import technologyTaxonomyApi from '../../services/technologyTaxonomyApi';
import FilterSelect from '../Dropdowns/FilterSelect';

const TechnologyGroupDropdowns = ({ groupValue, subGroupValue, onGroupChange, onSubGroupChange }) => {
  const [groups, setGroups] = useState([]);
  const [subGroups, setSubGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingSubGroups, setLoadingSubGroups] = useState(false);

  useEffect(() => {
    setLoadingGroups(true);
    technologyTaxonomyApi.getTechnologyGroups()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoadingGroups(false));
  }, []);

  useEffect(() => {
    if (!groupValue) { setSubGroups([]); return; }
    setLoadingSubGroups(true);
    technologyTaxonomyApi.getTechnologySubGroups(groupValue)
      .then(setSubGroups)
      .catch(() => setSubGroups([]))
      .finally(() => setLoadingSubGroups(false));
  }, [groupValue]);

  return (
    <div className="br-form-grid">
      <label className="br-field">
        <span className="br-field-label">Category</span>
        <FilterSelect
          value={groupValue || ''}
          options={groups}
          placeholder={loadingGroups ? 'Loading...' : 'Select Category'}
          disabled={loadingGroups}
          onChange={onGroupChange}
        />
      </label>
      <label className="br-field">
        <span className="br-field-label">Sub Category</span>
        <FilterSelect
          value={subGroupValue || ''}
          options={subGroups}
          placeholder={!groupValue ? 'Select Category First' : loadingSubGroups ? 'Loading...' : 'Select Sub Category'}
          disabled={!groupValue || loadingSubGroups}
          onChange={onSubGroupChange}
        />
      </label>
    </div>
  );
};

export default TechnologyGroupDropdowns;
