export interface ApiEnvelope<T> {
  code: number
  msg?: string
  data: T
  status?: string
}

export interface LoginPayload {
  username: string
  password: string
  role: string
}

export interface RoleInfo {
  id: string
  key: string
  name: string
  desc?: string | null
  type?: number
  admin?: boolean
  adminOrDev?: boolean
  dev?: boolean
}

export interface UserInfo {
  id: string
  username: string
  nickname?: string | null
  status?: number
  email?: string | null
  phone?: string | null
  birth?: string | null
  desc?: string | null
  avatar?: string | null
  lastLoginRole?: string
  createdAt?: number
  updatedAt?: number
  roles?: RoleInfo[]
  belongUsers?: string[]
  belongRole?: Array<RoleInfo & { softwareList?: unknown }> | null
}

export interface LoginResult extends UserInfo {
  token: string
  role: RoleInfo
  style?: string
}

export interface Software {
  id: string
  key: string
  name: string
  appName?: string | null
  routerKey?: string | null
  type?: string
  version?: string | null
  framework?: string | null
  desc?: string | null
  icon?: string | null
  releaseStatus?: number
  web?: number
  orderTop?: number
  createdAt?: number
  screenshot?: string | null
  roleList?: Array<{ id?: string; key?: string; name?: string }> | null
  relationServiceName?: string[] | string | null
  relationServiceKey?: string[] | string | null
}

export interface K8sMeta {
  name?: string
  namespace?: string
  labels?: Record<string, string> | null
  annotations?: Record<string, string> | null
  creationTimestamp?: string | null
}

export interface ServiceItem {
  nameFr: string
  nameUs: string
  service?: {
    metadata?: K8sMeta
    spec?: {
      clusterIP?: string
      type?: string
      ports?: Array<{ name?: string; port?: number; nodePort?: number; protocol?: string; targetPort?: number }>
    }
  }
  deployment?: {
    metadata?: K8sMeta
    spec?: {
      replicas?: number
      template?: {
        metadata?: K8sMeta
        spec?: {
          hostname?: string
          priorityClassName?: string
          nodeSelector?: Record<string, string> | null
          tolerations?: Array<{ key?: string; operator?: string; effect?: string }> | null
          affinity?: Record<string, unknown> | null
          containers?: Array<{
            name: string
            image?: string
            command?: string[] | null
            args?: string[] | null
            env?: Array<{ name: string; value?: string }>
            resources?: {
              limits?: { cpu?: string; memory?: string; gpu?: string } | null
              requests?: { cpu?: string; memory?: string } | null
            } | null
            ports?: Array<{ name?: string; containerPort?: number; protocol?: string }>
            readinessProbe?: ProbeConfig | null
            livenessProbe?: ProbeConfig | null
            volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean }>
          }>
          initContainers?: Array<{ name: string; image?: string }> | null
          volumes?: Array<{
            name: string
            hostPath?: { path?: string } | null
            configMap?: { name?: string } | null
          }>
        }
      }
    }
    status?: {
      replicas?: number
      readyReplicas?: number
      availableReplicas?: number
      updatedReplicas?: number
    }
  }
  podInfoList?: Array<{
    metadata?: K8sMeta
    status?: { phase?: string; podIP?: string; hostIP?: string; startTime?: string }
  }> | null
  imageInfo?: string | { imageName?: string; version?: string; image?: string } | null
  relationServiceName?: string[] | string | null
  relationServiceKey?: string[] | string | null
  hostIP?: string | null
  restartCount?: number | null
  softwareNameList?: string[] | null
  serviceAuth?: unknown
  terminated?: boolean | null
  belongNodeList?: string[] | null
  cpuOrder?: number | null
  memoryOrder?: number | null
  gpuOrder?: number | null
}

export interface ServiceList {
  services: ServiceItem[]
  total: number
  count: number
  runningDeployment: number
}

export interface NodeSummary {
  nodeInfo: { total: number; health: number; unused: number; unhealth: number }
  cpu: Array<{ name: string; used: number }>
  memory: Array<{ name: string; used: number }>
}

export interface ClusterSummary {
  dynamic: { useRate: { cpu: number; mem: number } }
  static: {
    node: { nodeRunning: number; nodeSum: number; schedulable: number }
    pod: Record<string, number>
    resource: {
      allocatedCPU: number
      cupSum: number
      allocatedMemByKB: number
      memSumByKB: number
    }
  }
}

export interface NodeItem {
  objectMeta: {
    name: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    creationTimestamp?: string
  }
  typeMeta?: { kind?: string }
  ready?: string
  cpu_total?: number
  memory_total_kb?: number
  pod_cap?: number
  schedulable?: boolean
  address?: string
  versions?: { kubeProxy?: string; kubelet?: string; kernel?: string; docker?: string }
  conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>
  cpuallocatable?: number
  memoryAllocatable?: number
  status?: {
    addresses?: Array<{ type: string; address: string }>
    nodeInfo?: { kubeletVersion?: string; osImage?: string; architecture?: string }
    capacity?: Record<string, string>
    allocatable?: Record<string, string>
    conditions?: Array<{ type: string; status: string }>
  }
  spec?: { podCIDR?: string; unschedulable?: boolean }
}

export interface NodesResponse {
  nodes: { listMeta: { total: number }; nodes: NodeItem[] }
  pod_count?: Array<{ name?: string; nodeName?: string; count?: number; podCount?: number }>
}

export interface CockpitData {
  serviceCpuLimit: Array<{ serviceName: string; replicas: number; value: string }>
  serviceMemoryLimit: Array<{ serviceName: string; replicas: number; value: string }>
  nodeInfo: Array<{
    name: string
    nodeIp: string
    nodeCpu: Array<{ timestamp: string; value: string; floatValue: string }>
    nodeMemory?: Array<{ timestamp: string; value: string; floatValue: string }>
    nodeNetWorkIn?: Array<{ timestamp: string; value: string; floatValue: string }>
    nodeNetWorkOut?: Array<{ timestamp: string; value: string; floatValue: string }>
    nodeDisk?: Array<{ timestamp: string; value: string; floatValue: string }>
  }>
  podCpuUsageList: Array<{ podName: string; value: number }>
  podMemoryUsageList: Array<{ podName: string; value: number }>
  nodeStatusList: Array<{ nodeName: string; status: number }>
  podHealthRateInfo: {
    podHealthRateList: Array<{ nodeName: string; health: number; unHealth: number; total: number }>
    running: number
    total: number
    normalRate: number
  }
  harborInfo: { projectNum: number; imageNum: number; free: number; total: number; useRate: number }
  systemService: {
    serviceList: Array<{ name: string; namespace: string; normal: number; total: number; type: string }>
  }
}

export interface RoleItem extends RoleInfo {
  createdAt?: number
  updatedAt?: number
  softwareList?: Array<{ appId?: string; appName?: string; name?: string; url?: string; id?: number | string }> | null
  userList?: UserInfo[] | null
  subRoleList?: Array<{ id?: string; name?: string }> | null
  onLineUserList?: unknown
}

export interface UserListItem extends UserInfo {
  roles?: Array<{ id: string; key: string; name: string }>
  subRoles?: Array<{ id: string; name: string }> | null
}

export interface AlertRule {
  id: string
  strategyName: string
  namespace?: string | null
  interval?: number | null
  targetName?: string | null
  alertType?: number
  enable?: boolean | number
  alertRules?: Array<{ metric?: string; operator?: string; value?: number; level?: string }>
  createdAt?: number
}

export interface AlertRecord {
  id: string
  strategyId?: string
  strategyName?: string
  targetName?: string
  alertType?: number
  status?: number
  metric?: string
  value?: string | number
  startTime?: number
  endTime?: number
  createdAt?: number
}

export interface VolumeItem {
  name: string
  createTime?: string
  hostPath?: string
  mountPath?: string
  storageType?: string
  storageIP?: string[]
  serviceName?: string
}

export interface ImageProject {
  project_id: number
  name: string
  repo_count?: number
  creation_time?: string
  update_time?: string
  owner_name?: string
}

export interface RepoItem {
  id?: number
  name: string
  project_id?: number
  description?: string
  pull_count?: number
  artifact_count?: number
  creation_time?: string
  update_time?: string
}

export interface DatabaseItem {
  id?: number
  dataBaseName?: string
  name?: string
  service?: string
  sqlName?: string | null
  desc?: string | null
  userName?: string | null
  createdAt?: number
  tableCount?: number
  tableSize?: string | number
  userList?: string[]
}

export interface WhitelistItem {
  id: string
  path: string
  createdAt?: number
  updatedAt?: number
}

export interface VipItem {
  ip: string
  netName: string
}

export interface AuditItem {
  id: number
  userId?: string
  roleId?: string
  username: string
  roleName?: string
  reason?: string
  reasonName?: string
  moduleName?: string
  ip?: string
  requestPath?: string
  createdAt?: number
}

export interface BackupItem {
  id: number
  databaseKey: string
  databaseName: string
  databaseFilename?: string
  size?: number | null
  createdAt?: number
  updatedAt?: number
  msg?: string | null
}

export interface ImageLogItem {
  id: number
  fileName: string
  name: string
  version: string
  status: number
  createdAt?: number
  updatedAt?: number
  username?: string
  log?: string
}

export interface LicenseInfo {
  end?: number
  endIso8601?: string
  code?: string
  expired?: boolean
  authStatus?: boolean
  currentTime?: number
  trialPeriod?: number
}

export interface SyncStatus {
  syncing: boolean
  success: boolean
  currentSyncName?: string | null
  currentSyncType?: string | null
  current: number
  total: number
  errorStatus?: string | null
}

export interface NodeUsageItem {
  limitCpu?: string
  limitMemory?: string
  requestCpu?: string
  requestMemory?: string
  [key: string]: unknown
}

export interface PodInfoItem {
  name: string
  podName: string
  cpuUsage?: number
  memory?: number
  status?: string
  restartCount?: number
}

export interface ContainerLogLine {
  timeNano: string | number
  log: string
}

export interface ContainerLogBlock {
  containerName: string
  count?: number
  logs: ContainerLogLine[]
}

export interface PodLogBlock {
  podName: string
  containerLogs: ContainerLogBlock[]
}

export interface ServiceLogData {
  podLogs: PodLogBlock[]
  count: number
}

export interface NodeTerminalInfo {
  ticket: string
  websocketPath: string
  expiresInSeconds: number
}

export interface ProbeConfig {
  httpGet?: { path?: string; port?: number | string } | null
  tcpSocket?: { port?: number | string } | null
  exec?: { command?: string[] } | null
  initialDelaySeconds?: number
  timeoutSeconds?: number
  periodSeconds?: number
  successThreshold?: number
  failureThreshold?: number
}
