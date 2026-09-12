// App.js
import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation
} from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './hooks/useAuth.js';
import Navbar from './components/Navbar';
import Sidebar from './components/sidebar';
import SessionManager from './components/SessionManager';
import SessionGuardSocket from './components/SessionGuardSocket';

// Pages
import Login from './Pages/Login';
import Dashboardtabs from "./Pages/Dashboard.js";
import Leads from "./Pages/Leads-Enquire";
import Proposals from "./Pages/Proposals";
import ProcurementQuatations from "./Pages/Procurement-Quatation-Recieved";
import Invoices from "./Pages/InvoicesReceiptsPage.js";
import TelecallerLeadsPage from "./Pages/Telecallerleadspage.js";
import Customer_dashboard from "./Pages/Sales-Customer";
import Follow_up from "./Pages/Follow-ups";
import Analytics from "./Pages/Analytics";
import Procurement from "./Pages/Procurement-Vendor-Management";
import Documents from "./Pages/Documents";
import Profile from "./Pages/Profile";
import SalesOrder from "./Pages/Sales-Order";
import PurchaseOrders from './Pages/PurchaseOrders';
import BillsRecieved from "./Pages/BillsRecieptsPage.js";
import Reports from "./Pages/ProjectReports.js";
import Users from "./Pages/UsersPage";
import Addropdownitems from "./Pages/AddNewDropdownItems";
import LeadTemplatesAdmin from "./Pages/LeadTemplatesAdmin";
import BomItemsMaster from "./Pages/BomItemsMaster";
import NewRolePermissions from './Pages/NewRolePermissions';
import Projectdashboard from "./Pages/ProjectDashboard2.js";
import OrderBook from "./Pages/OrderBook.js";
import ProjectsList from "./Pages/ProjectsList.js";
import ProjectDetailPage from "./components/projects/ProjectDetailPage.js";
import Tenders from "./Pages/Tenders.js";
import OrdersInLine from "./Pages/OrdersInLine.js"; // PROVISIONAL — temporary register, see file header
import BorrowerRegistry from "./Pages/BorrowerRegistry.js";
import BorrowerMasterData from "./Pages/BorrowerMasterData.js";
import BorrowerDetail from "./components/borrowers/BorrowerDetail.js";
import GroupDetail from "./components/borrowers/GroupDetail.js";
import SanctionDetail from "./components/borrowers/SanctionDetail.js";
import ProjectCostExpenseManagement from './Pages/ProjectCostExpenseManagement.js';
import NotFound from "./Pages/NotFound";
import TaskManagement from './Pages/TaskManagement.js';
import RoleHierarchyPage from './Pages/RoleHierarchyPage.js';
import './App.css';
import './theme.css';
import { setupFetchInterceptor } from './utils/setupFetchInterceptor';
import ProjectAccessManager from './Pages/ProjectAccessPage.js';
import InventoryManagement from './Pages/InventoryManagement.js';
import { NotificationProvider, NotificationsPage } from './components/Notifications/NotificationPage';
import CRMAssistantBot from './components/CRMAssistantBot';
import TeamLeadPerformance from "./Pages/TeamLeadPerformance.js";
// ── LOGIN ACTIVITY MODULE ──────────────────────────────────────────────
import LoginActivityMonitor from "./Pages/LoginActivityMonitor.js";
import { useActivityTracker } from "./hooks/useActivityTracker";
// ───────────────────────────────────────────────────────────────────────

/* ─────────────────────────────────────────────────────────────────────────────
 * useModalScrollLock
 * Watches the DOM with a MutationObserver. Whenever any element with
 * position:fixed covering the full viewport (inset:0) is added or removed,
 * it toggles body.modal-open which applies overflow:hidden via App.css.
 * This prevents the background page from scrolling while ANY modal, drawer,
 * dialog, or overlay is open — across the ENTIRE application in one place.
 * ───────────────────────────────────────────────────────────────────────── */
function isModalOverlay(el) {
  if (!(el instanceof HTMLElement)) return false;
  const s = window.getComputedStyle(el);
  return (
    s.position === 'fixed' &&
    s.top      === '0px'   &&
    s.right    === '0px'   &&
    s.bottom   === '0px'   &&
    s.left     === '0px'
  );
}

function hasOpenModal() {
  const candidates = document.querySelectorAll(
    '[style*="fixed"], [class*="modal"], [class*="overlay"], [class*="backdrop"], [class*="dialog"]'
  );
  for (const el of candidates) {
    if (isModalOverlay(el)) return true;
  }
  return false;
}

function useModalScrollLock() {
  useEffect(() => {
    // Measure scrollbar width once so layout doesn't shift when overflow:hidden
    // removes the scrollbar.
    const sbWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--scrollbar-width', `${sbWidth}px`);

    function syncBodyClass() {
      document.body.classList.toggle('modal-open', hasOpenModal());
    }

    // childList + subtree catches portals rendered anywhere in the tree.
    const observer = new MutationObserver(syncBodyClass);
    observer.observe(document.body, { childList: true, subtree: true });

    syncBodyClass(); // sync once on mount

    return () => {
      observer.disconnect();
      document.body.classList.remove('modal-open');
    };
  }, []);
}

/* ---------------- APP WRAPPER ---------------- */
setupFetchInterceptor();
function AppWrapper() {
  const location = useLocation();

  // Prevent background page scrolling whenever any modal/overlay is open
  useModalScrollLock();

  const hideShell =
    location.pathname === '/login' ||
    location.pathname === '/';

  if (!hideShell) {
    const knownPaths = [
      '/dashboard', '/sales', '/procurement', '/documents',
      // '/solarprofile' stays listed so its redirect route can fire instead of NotFound.
      '/analytics', '/profile', '/reports', '/solarprofile', '/follow-ups',
      '/users', '/officeuse', '/project-over-view', '/order-book',
      '/project-cost-expense', '/taskmanagement', '/projectaccess', '/inventory-management', '/notifications',
      '/team-performance', '/projects', '/tenders','/lender'
    ];
    const isKnown = knownPaths.some(p => location.pathname.startsWith(p));
    if (!isKnown) return <NotFound />;
  }

  return <AppShell hideShell={hideShell} />;
}

/* ---------------- APP SHELL ---------------- */


function AppShell({ hideShell }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const { user } = useAuth();
  const userRole = user?.role || null;

  // LOGIN ACTIVITY MODULE — records page views for the activity timeline
  // (batched, fire-and-forget; adds zero latency to navigation)
  useActivityTracker(!!user && !hideShell);

  useEffect(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    if (saved !== null) setCollapsed(JSON.parse(saved));
  }, []);

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const newVal = !prev;
      localStorage.setItem("sidebarCollapsed", JSON.stringify(newVal));
      return newVal;
    });
  };

  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>

      {!hideShell && <SessionManager />}

      {/* LOGIN ACTIVITY: real-time force-logout when this session is terminated */}
      {!hideShell && <SessionGuardSocket />}

      {!hideShell && <CRMAssistantBot />}
      
      {!hideShell && (
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
      )}

      {!hideShell && (
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      )}

      <main className={`main-content ${hideShell ? "fullpage" : ""}`}>
        <Routes>

          {/* ---------- PUBLIC ---------- */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />

          {/* ---------- PROTECTED ---------- */}
          <Route path="/dashboard" element={
            <ProtectedRoute><Dashboardtabs /></ProtectedRoute>
          } />

          <Route path="/project-over-view" element={
            <ProtectedRoute><Projectdashboard /></ProtectedRoute>
          } />

          <Route path="/follow-ups" element={
            <ProtectedRoute><Follow_up /></ProtectedRoute>
          } />

          <Route path="/reports" element={
            <ProtectedRoute><Reports /></ProtectedRoute>
          } />

          <Route path="/project-cost-expense" element={
            <ProtectedRoute><ProjectCostExpenseManagement /></ProtectedRoute>
          } />

          <Route path="/inventory-management" element={
            <ProtectedRoute><InventoryManagement /></ProtectedRoute>
          } />

          <Route path="/sales/leads"
            element={
              <ProtectedRoute>
                {userRole === "TELECALLER"
                  ? <TelecallerLeadsPage />
                  : <Leads />}
              </ProtectedRoute>
            }
          />

          {/* PROVISIONAL — temporary Orders in Line register, see the page file header */}
          <Route path="/sales/orders-in-line" element={
            <ProtectedRoute><OrdersInLine /></ProtectedRoute>
          } />

          <Route path="/sales/clients" element={
            <ProtectedRoute><Customer_dashboard /></ProtectedRoute>
          } />

          <Route path="/order-book" element={
            <ProtectedRoute><OrderBook /></ProtectedRoute>
          } />

          <Route path="/projects" element={
            <ProtectedRoute><ProjectsList /></ProtectedRoute>
          } />

          <Route path="/projects/:projectUniqueId" element={
            <ProtectedRoute><ProjectDetailPage /></ProtectedRoute>
          } />

          <Route path="/tenders" element={
            <ProtectedRoute><Tenders /></ProtectedRoute>
          } />

          {/* ── LENDER MODULE ─────────────────────────────────────────────
              The list route must come first: React Router matches in order,
              and "/lender/borrowers/:id" would otherwise never be reached
              from a link that also matches the index path. */}
          <Route path="/lender/borrowers" element={
            <ProtectedRoute><BorrowerRegistry /></ProtectedRoute>
          } />

          <Route path="/lender/borrower-master-data" element={
            <ProtectedRoute><BorrowerMasterData /></ProtectedRoute>
          } />

          <Route path="/lender/borrowers/:id" element={
            <ProtectedRoute><BorrowerDetail /></ProtectedRoute>
          } />

          <Route path="/lender/borrowers/group/:groupId" element={
            <ProtectedRoute><GroupDetail /></ProtectedRoute>
          } />

          {/* Group/Sub Group's own ENTITY detail view — reached only via the
              "eye" (view) action on a Group/Sub Group row; the route above
              (no /detail suffix) stays the hierarchy MANAGEMENT page,
              reached by clicking the group's name. Points at the SAME
              BorrowerDetail component the company route above uses, not a
              separate page — see its own `groupId` branch: one detail-view
              design for every entity type, only the data differs. */}
          <Route path="/lender/borrowers/group/:groupId/detail" element={
            <ProtectedRoute><BorrowerDetail /></ProtectedRoute>
          } />

          <Route path="/lender/borrowers/:id/sanctions/:sanctionId" element={
            <ProtectedRoute><SanctionDetail /></ProtectedRoute>
          } />

          <Route path="/sales/invoices" element={
            <ProtectedRoute><Invoices /></ProtectedRoute>
          } />

          <Route path="/sales/proposals" element={
            <ProtectedRoute><Proposals /></ProtectedRoute>
          } />

          <Route path="/procurement/vendors" element={
            <ProtectedRoute><Procurement /></ProtectedRoute>
          } />

          <Route path="/procurement/quotations" element={
            <ProtectedRoute><ProcurementQuatations /></ProtectedRoute>
          } />

          <Route path="/procurement/purchase-orders" element={
            <ProtectedRoute><PurchaseOrders /></ProtectedRoute>
          } />

          <Route path="/procurement/bills-recieved" element={
            <ProtectedRoute><BillsRecieved /></ProtectedRoute>
          } />

          <Route path="/officeuse/add-group-project" element={
            <ProtectedRoute><Addropdownitems /></ProtectedRoute>
          } />

          <Route path="/officeuse/roles-permissions" element={
            <ProtectedRoute><NewRolePermissions /></ProtectedRoute>
          } />

          <Route path="/officeuse/lead-admin" element={
            <ProtectedRoute><LeadTemplatesAdmin /></ProtectedRoute>
          } />

          <Route path="/officeuse/item-master" element={
            <ProtectedRoute><BomItemsMaster /></ProtectedRoute>
          } />

          {/* ── NEW ──────────────────────────────────────────────────────── */}
          <Route path="/officeuse/role-hierarchy" element={
            <ProtectedRoute><RoleHierarchyPage /></ProtectedRoute>
          } />
          {/* ─────────────────────────────────────────────────────────────── */}

          <Route path="/sales/SalesOrder" element={
            <ProtectedRoute><SalesOrder /></ProtectedRoute>
          } />

          <Route path="/documents" element={
            <ProtectedRoute><Documents /></ProtectedRoute>
          } />

          <Route path="/analytics" element={
            <ProtectedRoute><Analytics /></ProtectedRoute>
          } />
          <Route path="/team-performance" element={
            <ProtectedRoute><TeamLeadPerformance /></ProtectedRoute>
          } />
          <Route path="/profile" element={
            <ProtectedRoute><Profile /></ProtectedRoute>
          } />

          {/* /solarprofile (the browser-side solar proposal editor) is retired.
              Solar proposals are generated from the lead detail view — see
              components/Leads/GenerateProposalModal.js. Old links land on the
              leads list rather than a dead route. */}
          <Route path="/solarprofile" element={<Navigate to="/sales/leads" replace />} />

          <Route path="/users" element={
            <ProtectedRoute><Users /></ProtectedRoute>
          } />

          <Route path="/taskmanagement" element={
            <ProtectedRoute><TaskManagement /></ProtectedRoute>
          } />
          <Route path="/officeuse/projectaccess" element={
            <ProtectedRoute><ProjectAccessManager /></ProtectedRoute>
          } />

          {/* ── LOGIN ACTIVITY MODULE ─────────────────────────────────── */}
          <Route path="/officeuse/login-activity" element={
            <ProtectedRoute><LoginActivityMonitor /></ProtectedRoute>
          } />
          {/* ──────────────────────────────────────────────────────────── */}

          <Route path="/notifications" element={
            <ProtectedRoute><NotificationsPage /></ProtectedRoute>
          } />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

/* ---------------- ROOT APP ---------------- */

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <NotificationProvider>
            <AppWrapper />
          </NotificationProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}