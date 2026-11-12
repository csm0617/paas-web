export interface NavItem {
  label: string
  en: string
  path: string
  code: string
}

export interface NavGroup {
  index: string
  label: string
  en: string
  items: NavItem[]
}

export const navigation: NavGroup[] = [
  {
    index: '01',
    label: '全局总览',
    en: 'GLOBAL',
    items: [
      { label: '系统总览', en: 'SYSTEM OVERVIEW', path: '/global/system-overview', code: 'OVW' },
      { label: '资源统计', en: 'RESOURCE STATISTICS', path: '/global/host-service', code: 'RES' },
      { label: '运行驾驶舱', en: 'OPERATIONS COCKPIT', path: '/global/cockpit', code: 'CKP' },
    ],
  },
  {
    index: '02',
    label: '镜像管理',
    en: 'REGISTRY',
    items: [
      { label: '镜像构建', en: 'IMAGE BUILD', path: '/mirror/build', code: 'CI' },
      { label: '镜像仓库', en: 'REPOSITORIES', path: '/mirror/group', code: 'REG' },
      { label: '程序包', en: 'SOFTWARE PACKAGES', path: '/mirror/package', code: 'PKG' },
      { label: '构建记录', en: 'BUILD RECORDS', path: '/mirror/record', code: 'BLD' },
    ],
  },
  {
    index: '03',
    label: '应用管理',
    en: 'SOFTWARE',
    items: [
      { label: '应用门户', en: 'APPLICATION HALL', path: '/operate/home', code: 'HALL' },
      { label: '容器概览', en: 'CONTAINER OVERVIEW', path: '/software/overview', code: 'OVW' },
      { label: '应用配置', en: 'APP CONFIG', path: '/software/application/config', code: 'CFG' },
      { label: '应用', en: 'APPLICATIONS', path: '/software/application', code: 'APP' },
      { label: '服务', en: 'SERVICES', path: '/software/application/service', code: 'SVC' },
      { label: '基础服务', en: 'BASE SERVICES', path: '/software/application/base-service', code: 'BAS' },
      { label: '容器', en: 'CONTAINERS', path: '/software/application/service-pod', code: 'POD' },
      { label: '服务配置', en: 'SERVICE CONFIG', path: '/software/application/service-config', code: 'SCF' },
      { label: '服务参数', en: 'SERVICE PARAMETERS', path: '/software/application/service-params', code: 'PRM' },
      { label: '服务延迟启动', en: 'STARTUP PLAN', path: '/software/application/service-startup', code: 'STA' },
      { label: '自动伸缩策略', en: 'AUTOSCALING', path: '/software/application/autoscale', code: 'HPA' },
      { label: '工作负载', en: 'WORKLOADS', path: '/software/workloads', code: 'WLD' },
    ],
  },
  {
    index: '04',
    label: '网络管理',
    en: 'NETWORK',
    items: [
      { label: '服务发现', en: 'NET SERVICES', path: '/netmanager/netservice', code: 'NET' },
      { label: '虚拟 IP', en: 'VIRTUAL IP', path: '/netmanager/vipmanage', code: 'VIP' },
      { label: '负载均衡', en: 'LOAD BALANCE', path: '/netmanager/loadbalances', code: 'LB' },
    ],
  },
  {
    index: '05',
    label: '存储管理',
    en: 'STORAGE',
    items: [
      { label: '本地存储', en: 'LOCAL VOLUMES', path: '/storage/localstorage', code: 'VOL' },
      { label: '持久卷', en: 'PERSISTENT VOLUMES', path: '/storage/persistent-volume', code: 'PV' },
      { label: '持久卷申领', en: 'VOLUME CLAIMS', path: '/storage/persistent-volume-claim', code: 'PVC' },
      { label: '文件资源', en: 'FILE PROJECTS', path: '/storage/file-project', code: 'FIL' },
    ],
  },
  {
    index: '06',
    label: '授权管理',
    en: 'LICENSING',
    items: [
      { label: '服务授权', en: 'SERVICE LICENSE', path: '/auth-manager', code: 'SAL' },
      { label: '版本与授权', en: 'VERSION & LICENSE', path: '/setting/version', code: 'VER' },
    ],
  },
  {
    index: '07',
    label: '权限管理',
    en: 'ACCESS',
    items: [
      { label: '用户管理', en: 'USERS', path: '/usermanage/account', code: 'USR' },
      { label: '席位管理', en: 'ROLES', path: '/usermanage/role', code: 'ROL' },
      { label: '子角色管理', en: 'SUB ROLES', path: '/usermanage/subrole', code: 'SRL' },
      { label: '全局设置', en: 'GLOBAL SETTINGS', path: '/usermanage/settingGlobal', code: 'SET' },
      { label: '行为审计', en: 'AUDIT TRAIL', path: '/usermanage/log', code: 'AUD' },
    ],
  },
  {
    index: '08',
    label: '运维管理',
    en: 'OPERATIONS',
    items: [
      { label: '状态监控', en: 'MONITORING', path: '/ops/status-monitor', code: 'MON' },
      { label: '资源概览', en: 'RESOURCE OVERVIEW', path: '/ops/status-monitor/resources', code: 'RES' },
      { label: '标签管理', en: 'NODE LABELS', path: '/ops/status-monitor/labels', code: 'LBL' },
      { label: '系统服务管理', en: 'SYSTEM SERVICES', path: '/ops/status-monitor/sys-service-manage', code: 'SYS' },
      { label: '地图配置', en: 'MAP SETTINGS', path: '/map-setting/data/dataType/map', code: 'MAP' },
      { label: '框架服务', en: 'BASE SERVICES', path: '/ops/base-service', code: 'BAS' },
      { label: '平台备份还原', en: 'BACKUP & RESTORE', path: '/ops/Backup-sync', code: 'BKP' },
      { label: '告警设置', en: 'ALERT RULES', path: '/ops/alert-setting', code: 'ALR' },
      { label: '告警记录', en: 'ALERT LOG', path: '/ops/alert-record', code: 'ALG' },
      { label: '白名单', en: 'ALLOWLIST', path: '/ops/whitelist', code: 'WLT' },
    ],
  },
  {
    index: '09',
    label: '数据库管理',
    en: 'DATABASE',
    items: [
      { label: '数据库信息', en: 'DATABASES', path: '/database-setting/database-info', code: 'DBS' },
      { label: '数据库用户', en: 'DB USERS', path: '/database-setting/user-info', code: 'DBU' },
      { label: 'SQL 日志', en: 'SQL LOG', path: '/database-setting/sql-log', code: 'SQL' },
      { label: '表容量', en: 'TABLE SIZE', path: '/database-setting/table-size', code: 'TSZ' },
    ],
  },
]

export const flatNav = navigation.flatMap((group) => group.items.map((item) => ({ ...item, group })))

export function findNav(pathname: string) {
  const matches = flatNav
    .filter((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)
  return matches[0]
}
