import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ConfirmProvider, Spinner, TipProvider } from '@/components/ui'
import { useAuthStore } from '@/stores/auth'

const LoginPage = lazy(() => import('@/pages/Login'))
const SystemOverviewPage = lazy(() => import('@/pages/global/SystemOverview'))
const HostServicePage = lazy(() => import('@/pages/global/HostService'))
const CockpitPage = lazy(() => import('@/pages/global/Cockpit'))
const SystemServicesPage = lazy(() => import('@/pages/global/SystemServices'))
const MapSettingPage = lazy(() => import('@/pages/global/MapSetting'))
const SoftwareListPage = lazy(() => import('@/pages/software/SoftwareList'))
const AppPortalPage = lazy(() => import('@/pages/software/AppPortal'))
const ServiceManagePage = lazy(() => import('@/pages/software/ServiceManage'))
const ServiceConfigPage = lazy(() => import('@/pages/software/ServiceConfigPage'))
const ConfigGroupPage = lazy(() => import('@/pages/software/ConfigGroupPage'))
const WorkloadsPage = lazy(() => import('@/pages/software/Workloads'))
const ServiceStartupPage = lazy(() => import('@/pages/software/ServiceStartup'))
const DeploymentDetailPage = lazy(() => import('@/pages/software/DeploymentDetail'))
const MirrorPage = lazy(() => import('@/pages/mirror/MirrorPage'))
const ContinuousIntegrationPage = lazy(() => import('@/pages/mirror/ContinuousIntegration'))
const PackagePage = lazy(() => import('@/pages/mirror/PackagePage'))
const OpsMonitorPage = lazy(() => import('@/pages/ops/OpsMonitor'))
const ResourcesOverviewPage = lazy(() => import('@/pages/ops/ResourcesOverview'))
const BaseServicesPage = lazy(() => import('@/pages/ops/BaseServices'))
const ContainerOverviewPage = lazy(() => import('@/pages/software/ContainerOverview'))
const AutoscalePage = lazy(() => import('@/pages/software/AutoscalePage'))
const PodsPage = lazy(() => import('@/pages/software/PodsPage'))
const LabelsPage = lazy(() => import('@/pages/ops/LabelsPage'))
const AlertsPage = lazy(() => import('@/pages/ops/AlertsPage'))
const BackupSyncPage = lazy(() => import('@/pages/ops/BackupSync'))
const WhitelistPage = lazy(() => import('@/pages/ops/Whitelist'))
const NetworkPage = lazy(() => import('@/pages/net/NetworkPage'))
const StoragePage = lazy(() => import('@/pages/storage/StoragePage'))
const UsersPage = lazy(() => import('@/pages/access/Users'))
const RolesPage = lazy(() => import('@/pages/access/Roles'))
const SubRolesPage = lazy(() => import('@/pages/access/SubRoles'))
const AuditPage = lazy(() => import('@/pages/access/Audit'))
const DatabasePage = lazy(() => import('@/pages/database/DatabasePage'))
const LicensePage = lazy(() => import('@/pages/setting/License'))
const GlobalSettingsPage = lazy(() => import('@/pages/setting/GlobalSettings'))
const ServiceAuthPage = lazy(() => import('@/pages/setting/ServiceAuth'))
const NotFoundPage = lazy(() => import('@/pages/NotFound'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

function BootScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-paper">
      <div className="flex items-center gap-2.5">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
          <rect x="0.5" y="0.5" width="25" height="25" fill="none" stroke="#d8401d" strokeWidth="1" />
          <path d="M5 20V6l8 8 8-8v14" fill="none" stroke="#d8401d" strokeWidth="2" />
        </svg>
        <span className="num text-[24px] tracking-[0.08em] text-ink">MSOP</span>
      </div>
      <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-mute">
        <Spinner size={11} /> LOADING CONSOLE MODULE
      </div>
    </div>
  )
}

function RequireAuth() {
  const token = useAuthStore((state) => state.token)
  const location = useLocation()
  if (!token) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/user/login?r=${encodeURIComponent(redirect)}`} replace />
  }
  return <AppShell />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TipProvider delayDuration={200}>
        <ConfirmProvider>
          <BrowserRouter>
            <Suspense fallback={<BootScreen />}>
              <Routes>
                <Route path="/user/login" element={<LoginPage />} />
                <Route path="/login" element={<Navigate to="/user/login" replace />} />

                <Route element={<RequireAuth />}>
                  <Route index element={<Navigate to="/global/system-overview" replace />} />
                  <Route path="/global/system-overview" element={<SystemOverviewPage />} />
                  <Route path="/global/system-overview/kube-service/:node" element={<SystemServicesPage />} />
                  <Route path="/global/system-overview/:node" element={<HostServicePage />} />
                  <Route path="/global/host-service" element={<HostServicePage />} />
                  <Route path="/global/cockpit" element={<CockpitPage />} />
                  <Route path="/map-setting" element={<MapSettingPage />} />
                  <Route path="/map-setting/:section" element={<MapSettingPage />} />
                  <Route path="/map-setting/:section/:key/:value" element={<MapSettingPage />} />

                  <Route path="/operate/home" element={<AppPortalPage />} />
                  <Route path="/software/application" element={<SoftwareListPage />} />
                  <Route path="/software/application/service" element={<ServiceManagePage />} />
                  <Route path="/software/application/service-pod" element={<PodsPage />} />
                  <Route path="/software/application/config" element={<SoftwareListPage />} />
                  <Route path="/software/application/base-service" element={<BaseServicesPage />} />
                  <Route path="/software/application/service-config" element={<ConfigGroupPage />} />
                  <Route path="/software/application/service-params" element={<ServiceConfigPage />} />
                  <Route path="/software/application/service-startup" element={<ServiceStartupPage />} />
                  <Route path="/software/application/autoscale" element={<AutoscalePage />} />
                  <Route path="/software/workloads" element={<WorkloadsPage />} />
                  <Route path="/software/workloads/deployment" element={<WorkloadsPage />} />
                  <Route path="/software/workloads/deploymentViewer" element={<WorkloadsPage />} />
                  <Route path="/software/workloads/deploymentViewer/:name" element={<DeploymentDetailPage />} />
                  <Route path="/software/overview" element={<ContainerOverviewPage />} />
                  <Route path="/software/file" element={<Navigate to="/storage/file-project" replace />} />

                  <Route path="/mirror/group" element={<MirrorPage />} />
                  <Route path="/mirror/group/:name" element={<MirrorPage />} />
                  <Route path="/mirror/build" element={<ContinuousIntegrationPage />} />
                  <Route path="/mirror/package" element={<PackagePage />} />
                  <Route path="/mirror/record" element={<ContinuousIntegrationPage />} />

                  <Route path="/global/system-service" element={<SystemServicesPage />} />
                  <Route path="/ops/status-monitor" element={<OpsMonitorPage />} />
                  <Route path="/ops/status-monitor/resources" element={<ResourcesOverviewPage />} />
                  <Route path="/ops/status-monitor/labels" element={<LabelsPage />} />
                  <Route path="/ops/status-monitor/sys-service-manage" element={<SystemServicesPage />} />
                  <Route path="/ops/status-monitor/sys-service-detail/:name" element={<SystemServicesPage />} />
                  <Route path="/ops/base-service" element={<BaseServicesPage />} />
                  <Route path="/ops/base-service/images" element={<MirrorPage />} />
                  <Route path="/ops/base-service/images/:name" element={<MirrorPage />} />
                  <Route path="/ops/base-service/record" element={<MirrorPage />} />
                  <Route path="/ops/alert-setting" element={<AlertsPage />} />
                  <Route path="/ops/alert-setting/:tab" element={<AlertsPage />} />
                  <Route path="/ops/alert-record" element={<AlertsPage />} />
                  <Route path="/ops/alert-record/:tab" element={<AlertsPage />} />
                  <Route path="/ops/Backup-sync" element={<Navigate to="/ops/Backup-sync/backup" replace />} />
                  <Route path="/ops/Backup-sync/backup" element={<BackupSyncPage />} />
                  <Route path="/ops/Backup-sync/sync" element={<BackupSyncPage />} />
                  <Route path="/ops/whiteList" element={<WhitelistPage />} />
                  <Route path="/ops/whitelist" element={<WhitelistPage />} />

                  <Route path="/netmanager/netservice" element={<NetworkPage />} />
                  <Route path="/netmanager/netservice/netserviceViewer/:name" element={<NetworkPage />} />
                  <Route path="/netmanager/netservice/:name" element={<NetworkPage />} />
                  <Route path="/netmanager/vipmanage" element={<NetworkPage />} />
                  <Route path="/netmanager/sscs" element={<NetworkPage />} />
                  <Route path="/netmanager/loadbalances" element={<NetworkPage />} />

                  <Route path="/storage/localstorage" element={<StoragePage />} />
                  <Route path="/storage/persistent-volume" element={<StoragePage />} />
                  <Route path="/storage/persistent-volume-claim" element={<StoragePage />} />
                  <Route path="/storage/file-project" element={<StoragePage />} />

                  <Route path="/auth-manager" element={<ServiceAuthPage />} />
                  <Route path="/usermanage/account" element={<UsersPage />} />
                  <Route path="/usermanage/role" element={<RolesPage />} />
                  <Route path="/usermanage/subrole" element={<SubRolesPage />} />
                  <Route path="/usermanage/settingGlobal" element={<GlobalSettingsPage />} />
                  <Route path="/usermanage/log" element={<AuditPage />} />

                  <Route path="/database-setting/database-info" element={<DatabasePage />} />
                  <Route path="/database-setting/user-info" element={<DatabasePage />} />
                  <Route path="/database-setting/sql-log" element={<DatabasePage />} />
                  <Route path="/database-setting/table-size" element={<DatabasePage />} />

                  <Route path="/setting/version" element={<LicensePage />} />
                  <Route path="/auth" element={<LicensePage />} />
                  <Route path="/authpaas" element={<LicensePage />} />
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ConfirmProvider>
      </TipProvider>
    </QueryClientProvider>
  )
}
