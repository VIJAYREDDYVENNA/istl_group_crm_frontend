import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { BsArrowReturnRight } from "react-icons/bs";
import { IoChevronDown } from "react-icons/io5";
import '../components_css/sidebar.css';
import { useAuth } from '../hooks/useAuth';

// ─── Constants ────────────────────────────────────────────────────────────────
const AUTH_STORAGE_KEY  = 'bd_portal_user';          // must match AuthContext
const SIDEBAR_KEY_PREFIX = 'sidebar_state_';

const DEFAULT_STATE = {
  Main: true,
  Sales: false,
  Projects: false,
  Procurement: false,
  'Office Use': false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads the logged-in userId directly from localStorage.
 * This works even before AuthContext's useEffect has run (i.e., on the very
 * first synchronous render), eliminating the null→id race that caused
 * the accordion to always start collapsed after a refresh.
 */
function getUserIdFromStorage() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return data?.user?.id ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

function sidebarKey(userId) {
  return userId ? `${SIDEBAR_KEY_PREFIX}${userId}` : `${SIDEBAR_KEY_PREFIX}anonymous`;
}

function loadSidebarState(userId) {
  try {
    const raw = localStorage.getItem(sidebarKey(userId));
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch { /* corrupt entry — will be overwritten on next toggle */ }
  return { ...DEFAULT_STATE };
}

function saveSidebarState(userId, state) {
  try {
    localStorage.setItem(sidebarKey(userId), JSON.stringify(state));
  } catch { /* quota exceeded / private mode — accordion still works in-memory */ }
}

// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ isOpen, onClose, collapsed, onToggleCollapse }) {
  const location = useLocation();
  const { menuPermissions, user } = useAuth();

  // ── Initialise accordion state synchronously before first paint ────────────
  // We read the user id directly from localStorage (not from AuthContext)
  // because AuthContext.user is null on the first render — it only resolves
  // after its own useEffect runs.  Reading localStorage here means the correct
  // per-user state is available immediately, with zero flicker.
  const [expandedGroups, setExpandedGroups] = useState(() =>
    loadSidebarState(getUserIdFromStorage())
  );

  // Track the last userId we loaded state for so we can react to user switches.
  const [loadedForUserId, setLoadedForUserId] = useState(() => getUserIdFromStorage());

  // ── Reload state when the authenticated user changes ───────────────────────
  // Covers two cases:
  //   1. Auth hydration delay: user was null on mount, now resolves to real id.
  //   2. User switch: a different user logs in on the same device/tab.
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (currentId === loadedForUserId) return;   // nothing changed — skip

    setExpandedGroups(loadSidebarState(currentId));
    setLoadedForUserId(currentId);

    // Clean up the anonymous fallback key once we have a real user id.
    if (currentId) {
      try { localStorage.removeItem(sidebarKey(null)); } catch { /* ignore */ }
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live menu permissions ──────────────────────────────────────────────────
  const [liveMenuPermissions, setLiveMenuPermissions] = useState(menuPermissions);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`${process.env.REACT_APP_API_URL}/login/menuPermissions/${user.id}`, {
      credentials: 'include',
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0 && data[0] !== 'No Menu Permissions') {
          setLiveMenuPermissions(data);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  // ── Toggle + persist ───────────────────────────────────────────────────────
  const toggleGroup = (groupTitle) => {
    setExpandedGroups(prev => {
      const next = { ...prev, [groupTitle]: !prev[groupTitle] };
      saveSidebarState(user?.id ?? null, next);
      return next;
    });
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const hasPermission = (permission) => liveMenuPermissions?.includes(permission);

  // Distinct icon (matches the outline style used by the rest of the sidebar)
  // shown in place of the group title when the sidebar is collapsed.
  const getGroupIcon = (groupTitle) => {
    const map = {
      Sales: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
      Projects: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
      Procurement: 'M8 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM3 6h11v9H3V6zm11 3h4l3 3v3h-3',
      // Bank / institution — lending, distinct from the folder and cart icons.
      Lender: 'M3 21h18M4 10h16M5 10V21m14-11v11M9 10v11m6-11v11M12 3l9 5H3l9-5z',
      'Office Use': 'M3 21h18M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M9 9h1m-1 4h1m4-4h1m-1 4h1M19 21V9a2 2 0 00-2-2h-2v14',
    };
    // Generic folder icon as a safe fallback for any future collapsible group.
    return map[groupTitle] || 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z';
  };

  // ── Collapsed-sidebar tooltip ────────────────────────────────────────────
  // Rendered through a portal (like FilterSelect) instead of a CSS ::after,
  // because .sidebar has overflow-x: hidden for its scrollbar, which was
  // silently clipping any tooltip that tried to pop out past its right edge.
  const [tooltip, setTooltip] = useState(null); // { label, top, left } | null

  const showTooltip = (e, label) => {
    if (!collapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  };

  const hideTooltip = () => setTooltip(null);

  // ── Menu definition ────────────────────────────────────────────────────────
  const menuGroups = [
    {
      title: 'Main',
      items: [
        {
          name: 'Dashboard',
          path: '/dashboard',
          permission: 'DASHBOARD',
          icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
        },
        {
          name: 'Project Dashboard',
          path: '/project-over-view',
          permission: 'PROJECT_DASHBOARD',
          icon: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm3 4v8m4-5v5m4-3v3',
        },
        {
          name: 'Follow-Ups',
          path: '/follow-ups',
          permission: 'FOLLOW_UPS',
          icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
        },
        {
          name: 'Reports',
          path: '/reports',
          permission: 'REPORTS',
          icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        },
        {
          name: 'Analytics',
          path: '/analytics',
          permission: 'ANALYTICS',
          icon: 'M3 3v18h18M9 17V9m4 8V5m4 12v-6',
        },
        {
          name: 'Project Cost & Expenses',
          path: '/project-cost-expense',
          permission: 'PROJECT_COST_EXPENSE',
          icon: 'M7 4h10M7 8h10M10 8c3 0 5 2 5 4s-2 4-5 4H7m4 0l5 5',
        },
        {
          name: 'Task Management',
          path: '/taskmanagement',
          permission: 'TASK_MANAGEMENT',
          icon: 'M9 5l2 2 4-4M7 13h10M7 17h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
        },
        {
          name: 'Inventory Management',
          path: '/inventory-management',
          permission: 'INVENTORY_MANAGEMENT',
          icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
        },
      ],
    },
    {
      title: 'Sales',
      collapsible: true,
      items: [
        {
          name: 'Leads / Enquiries',
          path: '/sales/leads',
          permission: 'SALES_LEADS',
          icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
        },
        {
          // PROVISIONAL — temporary Orders in Line register, see the page file
          // header. Has its own menu permission (menu_items.sales_orders_in_pipeline)
          // so it can be granted independently of Leads.
          name: 'Orders in Pipeline',
          path: '/sales/orders-in-line',
          permission: 'SALES_ORDERS_IN_PIPELINE',
          // Inbox tray — an enquiry waiting to be picked up. Distinct from the
          // people icon on Leads and the ledger icon on OrderBook.
          icon: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
        },
        {
          name: 'Tenders',
          path: '/tenders',
          permission: 'TENDERS',
          // Balance scale — bid evaluation/comparison. Distinct from the
          // document-style icons used by Reports / OrderBook / Invoices.
          icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
        },
        {
          name: 'Clients Data',
          path: '/sales/clients',
          permission: 'SALES_CLIENTS',
          icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
        },
        {
          name: 'OrderBook',
          path: '/order-book',
          permission: 'SALES_ORDERBOOK',
          icon: 'M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM8 8h8M8 12h8M8 16h5',
        },
        {
          name: 'Invoices',
          path: '/sales/invoices',
          permission: 'INVOICES',
          icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
        },
        
      ],
    },
    {
      title: 'Lender',
      collapsible: true,
      items: [
        {
          name: 'Borrower Registry',
          path: '/lender/borrowers',
          permission: 'LENDER_BORROWERS',
          // Document with a rupee mark — a sanction letter, distinct from the
          // plain document icons used by Reports / OrderBook / Invoices.
          icon: 'M9 12h6M9 9h6m-6 6h3m-6 6h12a1 1 0 001-1V7l-4-4H6a1 1 0 00-1 1v16a1 1 0 001 1z',
        },
        {
          name: 'Borrower Master Data',
          path: '/lender/borrower-master-data',
          permission: 'LENDER_BORROWERS',
          // Simple list icon — this page manages plain Group/Sub Group
          // records, not sanction letters, so it's deliberately distinct
          // from the document icon above.
          icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
        },
      ],
    },
    {
      title: 'Projects',
      collapsible: true,
      items: [
        {
          name: 'All Projects',
          path: '/projects',
          permission: 'PROJECTS',
          icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
        },
      ],
    },
    {
      title: 'Procurement',
      collapsible: true,
      items: [
        {
          name: 'Vendor Data',
          path: '/procurement/vendors',
          permission: 'PROCUREMENT_VENDERS',
          icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
        },
        {
          name: 'Quotations Recieved',
          path: '/procurement/quotations',
          permission: 'PROCUREMENT_QUOTATIONS_RECEIVED',
          icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
        },
        {
          name: 'Purchase Orders',
          path: '/procurement/purchase-orders',
          permission: 'PROCUREMENT_PURCHASE_ORDERS',
          icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
        },
        {
          name: 'Bills Received',
          path: '/procurement/bills-recieved',
          permission: 'PROCUREMENT_BILLS_RECEIVED',
          icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
        },
      ],
    },
    {
      title: 'Office Use',
      collapsible: true,
      items: [
        {
          name: 'Add New Group / Project',
          path: '/officeuse/add-group-project',
          permission: 'OFFICE_USE',
          icon: 'M12 4v16m8-8H4',
        },
        {
          name: 'Add New Roles / Permissions',
          path: '/officeuse/roles-permissions',
          permission: 'OFFICE_USE',
          icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.94 4a6.94 6.94 0 00-.1-1l2.02-1.57-2-3.46-2.38.96a7.02 7.02 0 00-1.73-1l-.36-2.54h-4l-.36 2.54a7.02 7.02 0 00-1.73 1l-2.38-.96-2 3.46 2.02 1.57a6.94 6.94 0 000 2l-2.02 1.57 2 3.46 2.38-.96a7.02 7.02 0 001.73 1l.36 2.54h4l.36-2.54a7.02 7.02 0 001.73-1l2.38.96 2-3.46-2.02-1.57c.07-.33.1-.66.1-1z',
        },
        {
          name: 'Lead Scope / BOM Templates',
          path: '/officeuse/lead-admin',
          permission: 'OFFICE_USE',
          icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
        },
        {
          name: 'Master Items (BOM Catalog)',
          path: '/officeuse/item-master',
          permission: 'OFFICE_USE',
          icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4',
        },
        {
          name: 'Login & Activity Monitor',
          path: '/officeuse/login-activity',
          permission: 'OFFICE_USE',
          icon: 'M22 12h-4l-3 9L9 3l-3 9H2',
        },
        {
          name: 'Project Access Manager',
          path: '/officeuse/projectaccess',
          permission: 'OFFICE_USE',
          icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 10-8 0v2',
        },
      ],
    },
  ];

  const filteredMenuGroups = menuGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => hasPermission(item.permission)),
    }))
    .filter(group => group.items.length > 0);

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose}></div>}

      <button
        className="sidebar-external-collapse-btn"
        onClick={onToggleCollapse}
      >
        {collapsed ? ">" : "<"}
      </button>

      <aside className={`sidebar ${isOpen ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
        <div className="sidebar-content">
          <nav className="sidebar-nav">

            {filteredMenuGroups.map(group => {
              const isExpanded = expandedGroups[group.title];
              const showHeader = group.title !== 'Main';

              return (
                <div key={group.title} className="sidebar-group">

                  {showHeader && (
                    <div
                      className={`sidebar-group-header collapsible ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => toggleGroup(group.title)}
                      onMouseEnter={(e) => showTooltip(e, group.title)}
                      onMouseLeave={hideTooltip}
                    >
                      <span className="sidebar-group-title">{group.title}</span>

                      <div className="sidebar-group-abbreviation-container">
                        <svg
                          className="sidebar-group-abbreviation-icon"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeWidth={2} d={getGroupIcon(group.title)} />
                        </svg>
                        <IoChevronDown
                          className={`sidebar-group-collapsed-arrow ${isExpanded ? 'expanded' : ''}`}
                          size={14}
                        />
                      </div>

                      <svg
                        className={`sidebar-group-chevron ${isExpanded ? 'expanded' : ''}`}
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  )}

                  <div className={`sidebar-group-items ${isExpanded ? 'expanded' : 'collapsed'}`}>
                    {group.items.map(item => {
                      const active = location.pathname === item.path;

                      return (
                        <Link
                          key={item.name}
                          to={item.path}
                          onClick={onClose}
                          onMouseEnter={(e) => showTooltip(e, item.name)}
                          onMouseLeave={hideTooltip}
                          className={`sidebar-item ${active ? "active" : ""} ${group.collapsible && showHeader ? 'child-item' : ''}`}
                          title={collapsed ? item.name : undefined}
                        >
                          {group.collapsible && showHeader && (
                            <BsArrowReturnRight className="child-connector" />
                          )}

                          <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeWidth={2} d={item.icon} />
                          </svg>

                          <span className="sidebar-label">{item.name}</span>
                        </Link>
                      );
                    })}
                  </div>

                </div>
              );
            })}

          </nav>
        </div>
      </aside>

      {tooltip && collapsed && createPortal(
        <div
          className="sidebar-tooltip-portal"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          <span className="sidebar-tooltip-arrow" />
          {tooltip.label}
        </div>,
        document.body
      )}
    </>
  );
}

export default Sidebar;