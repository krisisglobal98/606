/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { DATA_TABS, IndexRedirect, REPORT_TABS, RequireMenu, allowedLanding } from '@/app/auth/menuAccess'
import { LandingRedirect, ProtectedRoute } from '@/app/auth/ProtectedRoute'
import { AppShell } from '@/app/layout/AppShell'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'

const LoginPage = lazy(() => import('@/pages/Login/LoginPage'))
const BerandaPage = lazy(() => import('@/pages/beranda/BerandaPage'))
const AnalysisPage = lazy(() => import('@/pages/Analysis/AnalysisPage'))
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage'))
const UsersPage = lazy(() => import('@/pages/Settings/users/UsersPage'))
const UserFormPage = lazy(() => import('@/pages/Settings/users/UserFormPage'))
const DataLayout = lazy(() => import('@/pages/data/DataLayout'))
const DatasetPage = lazy(() => import('@/pages/data/Dataset/DatasetPage'))
const CreateDatasetPage = lazy(() => import('@/pages/data/Warehouse/CreateDatasetPage'))
const CategoriesPage = lazy(() => import('@/pages/data/Dataset/CategoriesPage'))
const WarehouseDatasetPage = lazy(() => import('@/pages/data/Warehouse/WarehouseDatasetPage'))
const ReportLayout = lazy(() => import('@/pages/report/ReportLayout'))
const OperationalReportsPage = lazy(() => import('@/pages/report/Operational/OperationalReportsPage'))
const PermissionsPage = lazy(() => import('@/pages/Settings/permissions/PermissionsPage'))
const QueryLogPage = lazy(() => import('@/pages/Settings/queryLog/QueryLogPage'))

function Landing() {
  return <LandingRedirect to={allowedLanding(useAuthStore.getState().user, useUiStore.getState().settings.landingPage)} />
}
/** A page behind a menu permission (Settings → Hak Akses Menu). */
const m = (id: string, el: React.ReactNode) => <RequireMenu id={id}>{el}</RequireMenu>

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          // Beranda: the plain start page (no map).
          { path: '/beranda', element: m('beranda', <BerandaPage />) },
          // Removed modules (Peta Kebun, Insight, Laporan Excel, Dashboard Generator, Executive Summary, Publish, Dashboard): old links land on Beranda.
          { path: '/peta-kebun', element: <Navigate to="/beranda" replace /> },
          { path: '/insight/*', element: <Navigate to="/beranda" replace /> },
          { path: '/laporan-excel', element: <Navigate to="/beranda" replace /> },
          { path: '/dashboard-generator/*', element: <Navigate to="/beranda" replace /> },
          { path: '/executive-summary', element: <Navigate to="/beranda" replace /> },
          { path: '/publish/*', element: <Navigate to="/beranda" replace /> },
          { path: '/dashboard/*', element: <Navigate to="/beranda" replace /> },
          { path: '/analisis', element: m('analisis', <AnalysisPage />) },
          {
            path: '/data',
            element: m('data', <DataLayout />),
            children: [
              { index: true, element: <IndexRedirect items={DATA_TABS} /> },
              { path: 'categories', element: m('data.dataset', <CategoriesPage />) },
              { path: 'dataset', element: m('data.dataset', <DatasetPage />) },
              { path: 'dataset/new', element: m('data.dataset', <CreateDatasetPage />) },
              { path: 'dataset/:id', element: m('data.dataset', <WarehouseDatasetPage />) },
              // Removed: Data Warehouse (connections are set in the server's .env) and the unbuilt stages
              // Data Mapping, Transformasi, Data Flow, Data Quality. Old links land on Set Data.
              ...['warehouse/*', 'mapping', 'transformation', 'flow', 'quality'].map((path) => ({ path, element: <Navigate to="/data/dataset" replace /> })),
            ],
          },
          {
            path: '/report',
            element: m('report', <ReportLayout />),
            children: [
              { index: true, element: <IndexRedirect items={REPORT_TABS} /> },
              { path: 'operasional', element: m('report.operasional', <OperationalReportsPage />) },
              // Removed: Laporan PDF (reports, templates, Blast, history, recipients, settings). Old links land on Laporan Operasional.
              ...['reports/*', 'templates/*', 'blast', 'history', 'recipients', 'settings'].map((path) => ({ path, element: <Navigate to="/report/operasional" replace /> })),
            ],
          },
          { path: '/settings', element: m('settings', <SettingsPage />) },
          // Administrators only (the pages and the API both check the role).
          { path: '/settings/users', element: m('settings.users', <UsersPage />) },
          { path: '/settings/users/new', element: m('settings.users', <UserFormPage />) },
          { path: '/settings/users/:id', element: m('settings.users', <UserFormPage />) },
          { path: '/settings/permissions', element: m('settings.permissions', <PermissionsPage />) },
          { path: '/settings/query-log', element: m('settings.querylog', <QueryLogPage />) },
        ],
      },
    ],
  },
  { path: '*', element: <Landing /> },
])
