import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, RotateCw, Plus, ServerCog, SquareTerminal, Trash2, HardDrive, Power } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatNumber, nodeAddress, nodeCapacityCpu, nodeCapacityMemMiB, nodePodCapacity, nodeReady, parseMilliCores, parseMemoryKb, formatDate } from '@/lib/format'
import type { CockpitData, NodesResponse, NodeSummary, ServiceItem } from '@/types'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { RingGauge, AreaTrend } from '@/components/charts'
import { Badge, Button, Field, KV, Meter, Modal, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'
import { cn } from '@/lib/utils'

const NodeTerminalModal = lazy(() =>
  import('@/components/console/NodeTerminalModal').then((module) => ({ default: module.NodeTerminalModal })),
)

interface Consumption {
  [node: string]: {
    limits?: { cpu?: string; memory?: string }
    requests?: { cpu?: string; memory?: string }
  }
}

interface MonitorPoint {
  timestamp?: string
  floatValue?: string | null
}

interface MonitorSeries {
  metrics?: MonitorPoint[]
}

interface NodeMonitorData {
  cpu?: MonitorSeries
  memory?: MonitorSeries
  inboundNetwork?: MonitorSeries
  outboundNetwork?: MonitorSeries
  diskReadIo?: MonitorSeries
  diskWriteIo?: MonitorSeries
  currEstab?: MonitorSeries
  tcpTimeouts?: MonitorSeries
}

function monitorTrend(series: MonitorSeries | undefined, factor = 1) {
  return (series?.metrics ?? [])
    .filter((point) => point.floatValue !== null && point.floatValue !== undefined && Number.isFinite(Number(point.floatValue)))
    .map((point) => {
      const date = point.timestamp ? new Date(point.timestamp) : null
      const label =
        date && !Number.isNaN(date.getTime())
          ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
          : ''
      return { label, value: Number(point.floatValue) * factor }
    })
}

function address(node: NodesResponse['nodes']['nodes'][number], type: string) {
  if (type === 'InternalIP') return nodeAddress(node)
  return node.status?.addresses?.find((item) => item.type === type)?.address ?? nodeAddress(node)
}

export default function HostServicePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/cloud/nodes'),
    refetchInterval: 30_000,
  })
  const summaryQuery = useQuery({
    queryKey: ['nodes-summary'],
    queryFn: () => api.get<NodeSummary>('/cloud/nodesummary'),
    refetchInterval: 30_000,
  })
  const consumptionQuery = useQuery({
    queryKey: ['node-consumption'],
    queryFn: () => api.get<Consumption>('/cloud/nodes/resource-consumption'),
    refetchInterval: 30_000,
  })
  const cockpitQuery = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<CockpitData>('/api/v2/dashboards/cockpit'),
    staleTime: 30_000,
  })
  const nodes = nodesQuery.data?.nodes?.nodes ?? []
  const [selected, setSelected] = useState<string>('')
  const [sshOpen, setSshOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    ip: '',
    hostname: '',
    labelNvidia: false,
    uninstall: false,
    netWorkInterface: '',
  })
  const [addStep, setAddStep] = useState(-1)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [monitorRange, setMonitorRange] = useState<'ONE_HOURS' | 'SIX_HOURS'>('ONE_HOURS')
  const [connectInfo, setConnectInfo] = useState<{
    connect?: boolean
    hostname?: string
    netWorkInfo?: Array<{ netName?: string; ipList?: string[] }>
  } | null>(null)

  useEffect(() => {
    if (selected) return
    const fromRoute = params.node && nodes.some((item) => item.objectMeta.name === params.node)
    if (fromRoute) setSelected(params.node as string)
    else if (nodes[0]) setSelected(nodes[0].objectMeta.name)
  }, [nodes, selected, params.node])

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'add') setAddOpen(true)
    else if (action === 'ssh') setSshOpen(true)
    else if (action === 'monitor') setMonitorOpen(true)
  }, [searchParams])

  const node = nodes.find((item) => item.objectMeta.name === selected)
  const usage = summaryQuery.data?.cpu?.find((item) => item.name === selected)
  const memUsage = summaryQuery.data?.memory?.find((item) => item.name === selected)
  const quota = consumptionQuery.data?.[selected]
  const pods = cockpitQuery.data?.podHealthRateInfo?.podHealthRateList?.find((item) => item.nodeName === selected)

  const nodeUsageQuery = useQuery({
    queryKey: ['node-usage', selected],
    queryFn: () =>
      api.get<{
        cpuUsage?: Array<{ name: string; data: number; alert?: boolean }>
        memoryUsage?: Array<{ name: string; data: number; alert?: boolean }>
        diskUsage?: Array<{ name: string; data: number; alert?: boolean }>
      }>('/v1/pub/nodeUsage', { nodeName: selected }),
    enabled: !!selected,
    refetchInterval: 30_000,
  })
  const nodeMonitorQuery = useQuery({
    queryKey: ['node-monitor', selected, monitorRange],
    queryFn: () =>
      api.get<NodeMonitorData>('/v1/pub/nodeMonitor', {
        name: selected,
        queryTimeType: true,
        timeType: monitorRange,
      }),
    enabled: !!selected && monitorOpen,
  })
  const nodeDiskQuery = useQuery({
    queryKey: ['node-disk', selected],
    queryFn: () => api.get<Array<{ name: string; size: number }>>('/v1/pub/nodeDisk', { nodeName: selected }),
    enabled: !!selected,
  })
  const nodePortQuery = useQuery({
    queryKey: ['node-ports', selected],
    queryFn: () => api.get<Array<{ name: string; port: number }>>('/v1/pub/nodePortUsed', { nodeName: selected }),
    enabled: !!selected,
  })
  const nodeServicesQuery = useQuery({
    queryKey: ['node-services', selected],
    queryFn: () =>
      api.get<{ total?: number; services?: ServiceItem[] }>('/v1/service/serviceInfoByNode', {
        nodeName: selected,
        page: 1,
        size: 50,
      }),
    enabled: !!selected,
    refetchInterval: 60_000,
  })
  const nodeServices = nodeServicesQuery.data?.services ?? []
  const alertSettingQuery = useQuery({
    queryKey: ['node-alert-setting', selected],
    queryFn: () =>
      api.get<{ cpuUsageAlert?: number; memoryUsageAlert?: number; diskUsageAlert?: number }>(
        '/v1/pub/getNodeAlertSetting',
        { name: selected },
      ),
    enabled: !!selected,
  })
  const etcdQuery = useQuery({
    queryKey: ['etcd-nodes'],
    queryFn: () => api.get<Array<{ hostname?: string; host?: string }>>('/v1/pub/etcd_label/check'),
  })
  const [etcdChoice, setEtcdChoice] = useState('')
  const unifyEtcdMutation = useMutation({
    mutationFn: (ip: string) => api.post('/v1/pub/unify/etcd', undefined, { etcdNodeIp: ip }),
    onSuccess: () => {
      toast.success('etcd 节点已统一')
      etcdQuery.refetch()
    },
    onError: (error) => toast.error('统一失败', errorMessage(error)),
  })
  const etcdNodes = etcdQuery.data ?? []
  const [alertForm, setAlertForm] = useState({ cpu: '80', memory: '85', disk: '90' })
  useEffect(() => {
    if (!alertSettingQuery.data) return
    setAlertForm({
      cpu: String(alertSettingQuery.data.cpuUsageAlert ?? 80),
      memory: String(alertSettingQuery.data.memoryUsageAlert ?? 85),
      disk: String(alertSettingQuery.data.diskUsageAlert ?? 90),
    })
  }, [alertSettingQuery.data])
  const saveAlertMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/pub/setNodeAlertSetting', {
        name: selected,
        cpuUsageAlert: Number(alertForm.cpu) || 0,
        memoryUsageAlert: Number(alertForm.memory) || 0,
        diskUsageAlert: Number(alertForm.disk) || 0,
      }),
    onSuccess: () => {
      toast.success('节点告警阈值已保存')
      queryClient.invalidateQueries({ queryKey: ['node-alert-setting', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const [nodeAction, setNodeAction] = useState<'restart-worker' | 'restart-master' | 'uninstall' | null>(null)
  const nodeActionMutation = useMutation({
    mutationFn: (action: 'restart-worker' | 'restart-master' | 'uninstall') => {
      if (!node) throw new Error('未选择节点')
      if (action === 'uninstall') {
        return api.post('/v1/pub/uninstallNode', undefined, {
          nodeName: node.objectMeta.name,
          ip: nodeAddress(node),
        })
      }
      return api.post('/v1/pub/restartServer', undefined, {
        worker: action === 'restart-worker',
        master: action === 'restart-master',
      })
    },
    onSuccess: (_data, action) => {
      toast.success(
        action === 'uninstall' ? '节点卸载任务已下发' : '节点组件重启指令已下发',
        '操作由平台在节点侧异步执行，请关注节点状态变化',
      )
      setNodeAction(null)
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const restartFdfsMutation = useMutation({
    mutationFn: (ip: string) => api.post('/v1/pub/restartFdfs', [ip]),
    onSuccess: () => toast.info('已下发 FDFS 重启通知', '节点文件服务将在数秒内重启'),
    onError: (error) => toast.error('重启失败', errorMessage(error)),
  })
  const shutdownMutation = useMutation({
    mutationFn: async (payload: { master: string; worker: string }) => {
      const token = useAuthStore.getState().token
      const search = new URLSearchParams({ master: payload.master, worker: payload.worker })
      const response = await fetch(`${API_BASE}/v1/pub/shutdownServer?${search.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
      })
      const data = await response.json().catch(() => null)
      if (
        !response.ok ||
        (data && typeof data === 'object' && 'code' in data && Number(data.code) !== 0)
      ) {
        throw new Error((data && 'msg' in data ? String(data.msg) : '') || `关机失败 (${response.status})`)
      }
    },
    onSuccess: () => toast.success('关闭服务器指令已下发', '节点将进入关机流程，请确认业务已完成迁移'),
    onError: (error) => toast.error('关机失败', errorMessage(error)),
  })

  async function restartFdfs() {
    if (!node) return
    const ok = await confirm({
      title: `重启节点 ${node.objectMeta.name} 的文件服务？`,
      description: '将重启该节点的 FDFS 文件存储服务，期间文件上传与下载可能短暂中断。',
      confirmText: '重启 FDFS',
    })
    if (ok) restartFdfsMutation.mutate(nodeAddress(node))
  }

  async function shutdownHost() {
    if (!node) return
    const ip = nodeAddress(node)
    const isEtcd = Object.keys(node.objectMeta.labels ?? {}).some((key) => key.includes('cur-etcd'))
    const ok = await confirm({
      title: `关闭服务器 ${ip}？`,
      description: '节点将执行关机流程，其上运行的 Pod 会被中断或驱逐。请确认业务已完成迁移，操作不可撤销。',
      danger: true,
      confirmText: '关闭服务器',
    })
    if (ok) shutdownMutation.mutate({ master: isEtcd ? ip : '', worker: isEtcd ? '' : ip })
  }
  const schedulingMutation = useMutation({
    mutationFn: async (schedulable: boolean) => {
      if (!node) throw new Error('未选择节点')
      const name = node.objectMeta.name
      const manifest = await api.get<{ spec?: { unschedulable?: boolean } }>(`/k8s/api/v1/nodes/${name}`)
      manifest.spec = { ...(manifest.spec ?? {}), unschedulable: !schedulable }
      return api.put(`/k8s/api/v1/nodes/${name}`, manifest)
    },
    onSuccess: (_data, schedulable) => {
      toast.success(schedulable ? '节点已恢复调度' : '节点已暂停调度', '新的 Pod 将根据调度状态选择节点')
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
    onError: (error) => toast.error('调度操作失败', errorMessage(error)),
  })

  const connectMutation = useMutation({
    mutationFn: () =>
      api.get<{
        connect?: boolean
        hostname?: string
        netWorkInfo?: Array<{ netName?: string; ipList?: string[] }>
      }>('/v1/pub/testConnect', { ip: addForm.ip }),
    onSuccess: (data) => {
      setConnectInfo(data)
      if (!data?.connect) {
        toast.error('连接测试失败', '目标节点不可达，请检查 IP 与 SSH 服务')
        return
      }
      const netName = data.netWorkInfo?.find((item) => item.ipList?.includes(addForm.ip))?.netName
      setAddForm((prev) => ({
        ...prev,
        hostname: prev.hostname || data.hostname || '',
        netWorkInterface: netName || prev.netWorkInterface,
      }))
      toast.success('连接成功', data.hostname ? `目标主机：${data.hostname}` : undefined)
    },
    onError: (error) => toast.error('连接测试失败', errorMessage(error)),
  })

  const addNodeMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...addForm }
      if (!payload.ip.trim() || !payload.hostname.trim()) throw new Error('请填写节点 IP 与节点名称')
      const exists = await api.get<boolean>('/v1/pub/existNodeName', { name: payload.hostname })
      if (exists) throw new Error(`节点名称 ${payload.hostname} 已存在`)
      setAddStep(0)
      if (payload.uninstall) {
        await api.post('/v1/pub/uninstallNode', undefined, { nodeName: payload.hostname, ip: payload.ip })
      }
      await api.post('/v1/pub/initHost', payload)
      setAddStep(1)
      await api.post('/v1/pub/setDockerConfig', payload)
      setAddStep(2)
      await api.post('/v1/pub/finallyAddNode', payload)
      setAddStep(3)
      await api.post('/v1/pub/addFdfsByNode', undefined, { ip: payload.ip })
      setAddStep(4)
    },
    onSuccess: () => {
      toast.success('节点已加入集群', '平台正在安装组件，完成后将在节点列表中出现')
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      queryClient.invalidateQueries({ queryKey: ['nodes-summary'] })
    },
    onError: (error) => toast.error('添加节点失败', errorMessage(error)),
  })

  const addSteps = ['初始化配置', '配置 Docker 环境', '添加节点到集群', '安装框架文件系统']

  const diskUsage = nodeUsageQuery.data?.diskUsage?.find((item) => item.name === selected)?.data ?? 0
  const diskSize = nodeDiskQuery.data?.find((item) => item.name === selected)?.size ?? 0
  const usedPorts = nodePortQuery.data ?? []

  const capacityCpu = nodeCapacityCpu(node)
  const capacityMem = nodeCapacityMemMiB(node)
  const requestsCpu = parseMilliCores(quota?.requests?.cpu)
  const limitsCpu = parseMilliCores(quota?.limits?.cpu)
  const requestsMem = parseMemoryKb(quota?.requests?.memory)
  const limitsMem = parseMemoryKb(quota?.limits?.memory)

  const totals = useMemo(() => {
    return nodes.reduce(
      (acc, item) => {
        acc.cpu += nodeCapacityCpu(item)
        acc.mem += nodeCapacityMemMiB(item)
        acc.pods += nodePodCapacity(item)
        if (nodeReady(item)) acc.ready += 1
        return acc
      },
      { cpu: 0, mem: 0, pods: 0, ready: 0 },
    )
  }, [nodes])

  const ready = nodeReady(node)

  return (
    <div>
      <PageHeader
        index="01 / 02"
        en="GLOBAL · RESOURCE STATISTICS"
        title="资源统计"
        description="以节点为单位查看算力、内存与 Pod 承载情况，核对调度容量和配额余量。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {totals.ready}/{nodes.length} NODES READY
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              TOTAL {formatNumber(totals.cpu, 1)} CORE · {formatNumber(totals.mem / 1024, 1)} GiB
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={nodesQuery.isFetching} onClick={() => {
              nodesQuery.refetch()
              summaryQuery.refetch()
              consumptionQuery.refetch()
              nodeUsageQuery.refetch()
              nodeDiskQuery.refetch()
              nodePortQuery.refetch()
            }}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={() => {
              setAddForm({ ip: '', hostname: '', labelNvidia: false, uninstall: false, netWorkInterface: '' })
              setConnectInfo(null)
              setAddStep(-1)
              setAddOpen(true)
            }}>
              <Plus size={11} /> 添加节点
            </Button>
            <Button size="sm" variant="signal" disabled={!node} onClick={() => setSshOpen(true)}>
              <SquareTerminal size={11} /> SSH 终端
            </Button>
            <Button size="sm" disabled={!node} onClick={() => setMonitorOpen(true)}>
              监控
            </Button>
            <Button
              size="sm"
              disabled={!node}
              loading={schedulingMutation.isPending}
              onClick={() => {
                if (!node) return
                schedulingMutation.mutate(node.schedulable === false)
              }}
            >
              {node?.schedulable === false ? '恢复调度' : '暂停调度'}
            </Button>
            <Button size="sm" disabled={!node} onClick={() => setNodeAction('restart-worker')}>
              <RotateCw size={11} /> 重启组件
            </Button>
            <Button size="sm" disabled={!node} loading={restartFdfsMutation.isPending} onClick={restartFdfs}>
              <HardDrive size={11} /> 重启 FDFS
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!node}
              loading={shutdownMutation.isPending}
              onClick={shutdownHost}
            >
              <Power size={11} /> 关闭服务器
            </Button>
            <Button size="sm" disabled={!node} onClick={() => setNodeAction('uninstall')}>
              <Trash2 size={11} /> 卸载节点
            </Button>
          </>
        }
      />

      {(summaryQuery.isError || consumptionQuery.isError) && (
        <div className="mb-4 flex items-center gap-3 border-l-2 border-warn bg-warn/[0.06] px-4 py-2.5">
          <span className="h-1.5 w-1.5 bg-warn" />
          <span className="text-[11.5px] text-ink">
            metrics-server 暂未返回节点资源指标，容量与配额数据可能缺失；就绪状态仍来自 Kubernetes。
          </span>
        </div>
      )}

      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        {[
          ['节点总数', totals.ready, `/ ${nodes.length}`, 'READY NODES'],
          ['CPU 总容量', formatNumber(totals.cpu, 0), 'CORE', 'SCHEDULABLE CAPACITY'],
          ['内存总容量', formatNumber(totals.mem / 1024, 1), 'GiB', 'ALLOCATABLE MEMORY'],
          ['Pod 容量', formatNumber(totals.pods, 0), 'SLOTS', 'POD CAPACITY'],
        ].map(([label, value, unit, hint]) => (
          <div key={label} className="px-4 py-4">
            <div className="label">{label}</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="num text-[32px] leading-none text-ink">{value}</span>
              <span className="mono text-[9px] uppercase tracking-widest text-mute">{unit}</span>
            </div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-4" kicker="NODE SELECTOR" title="节点" bodyClassName="p-0">
          <div className="divide-y divide-line/70">
            {nodes.map((item) => {
              const name = item.objectMeta.name
              const cpu = summaryQuery.data ? summaryQuery.data.cpu?.find((entry) => entry.name === name)?.used ?? 0 : null
              const mem = summaryQuery.data ? summaryQuery.data.memory?.find((entry) => entry.name === name)?.used ?? 0 : null
              const isReady = nodeReady(item)
              return (
                <button
                  key={name}
                  onClick={() => setSelected(name)}
                  className={cn(
                    'block w-full px-4 py-3 text-left transition-colors',
                    selected === name ? 'bg-signal text-white' : 'hover:bg-paper-2/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot tone={isReady ? 'ok' : 'bad'} />
                      <span className="truncate font-mono text-[11.5px]">{name}</span>
                    </div>
                    <span className={cn('mono text-[8px] tracking-widest', selected === name ? 'text-white/70' : 'text-mute')}>
                      {isReady ? 'READY' : 'DOWN'}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <div className={cn('mb-1 flex justify-between text-[8.5px]', selected === name ? 'text-white/60' : 'text-mute')}>
                        <span>CPU</span>
                        <span className="mono">{cpu === null ? '—' : `${formatNumber(cpu, 1)}%`}</span>
                      </div>
                      <div className="h-[3px] bg-white/10">
                        <div
                          className="h-full"
                          style={{
                            width: `${cpu ?? 0}%`,
                            background: selected === name ? 'var(--color-signal)' : 'var(--color-ink)',
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className={cn('mb-1 flex justify-between text-[8.5px]', selected === name ? 'text-white/60' : 'text-mute')}>
                        <span>MEM</span>
                        <span className="mono">{mem === null ? '—' : `${formatNumber(mem, 1)}%`}</span>
                      </div>
                      <div className="h-[3px] bg-white/10">
                        <div
                          className="h-full"
                          style={{
                            width: `${mem ?? 0}%`,
                            background: selected === name ? 'var(--color-paper)' : 'var(--color-ink-3)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
            {nodes.length === 0 && <div className="px-4 py-8 text-center text-[11px] text-mute">暂无节点</div>}
          </div>
        </Panel>

        <div className="lg:col-span-8">
          {node ? (
            <div className="space-y-4">
              <Panel
                kicker="NODE DETAIL"
                title={node.objectMeta.name}
                actions={<Badge tone={ready ? 'ok' : 'bad'}>{ready ? 'READY' : 'NOT READY'}</Badge>}
              >
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-[190px_1fr]">
                  <div className="flex items-center justify-around border border-line px-2 py-4 sm:flex-col sm:gap-3">
                    <RingGauge
                      value={(usage?.used ?? 0) / 100}
                      size={116}
                      stroke={7}
                      label="CPU"
                      display={summaryQuery.data ? undefined : '—'}
                      color={summaryQuery.data ? 'var(--color-signal)' : 'var(--color-line-strong)'}
                    />
                    <RingGauge
                      value={(memUsage?.used ?? 0) / 100}
                      size={116}
                      stroke={7}
                      label="MEMORY"
                      color={summaryQuery.data ? 'var(--color-ink)' : 'var(--color-line-strong)'}
                      display={summaryQuery.data ? undefined : '—'}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    <div>
                      <KV k="主机名" v={node.objectMeta.name} />
                      <KV k="内部 IP" v={address(node, 'InternalIP')} />
                      <KV k="主机 IP" v={address(node, 'Hostname')} />
                      <KV k="架构" v={node.objectMeta.labels?.['kubernetes.io/arch'] ?? node.status?.nodeInfo?.architecture ?? '—'} />
                      <KV k="操作系统" v={node.status?.nodeInfo?.osImage ?? node.versions?.kernel ?? '—'} />
                      <KV k="Kubelet" v={node.versions?.kubelet ?? node.status?.nodeInfo?.kubeletVersion ?? '—'} />
                    </div>
                    <div>
                      <KV k="CPU 容量" v={`${formatNumber(capacityCpu, 1)} CORE`} />
                      <KV k="内存容量" v={`${formatNumber(capacityMem / 1024, 1)} GiB`} />
                      <KV k="Pod 上限" v={nodePodCapacity(node) || '—'} />
                      <KV k="Pod CIDR" v={node.spec?.podCIDR ?? '—'} />
                      <KV k="创建时间" v={formatDate(node.objectMeta.creationTimestamp)} />
                      <KV
                        k="可调度"
                        v={
                          <Badge tone={node.schedulable === false ? 'warn' : 'ok'}>
                            {node.schedulable === false ? 'CORDONED' : 'YES'}
                          </Badge>
                        }
                      />
                    </div>
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Panel kicker="QUOTA · CPU" title="算力配额">
                  <div className="mb-4 flex items-end justify-between">
                    <span className="num text-[32px] leading-none text-ink">{formatNumber(limitsCpu, 2)}</span>
                    <span className="mono text-[9px] text-mute">LIMIT / {formatNumber(capacityCpu, 1)} CORE</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">已分配 LIMIT</span>
                        <span className="mono text-[10px] text-ink">{formatNumber((limitsCpu / Math.max(1, capacityCpu)) * 100, 1)}%</span>
                      </div>
                      <Meter value={(limitsCpu / Math.max(1, capacityCpu)) * 100} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">已请求 REQUEST</span>
                        <span className="mono text-[10px] text-ink">{formatNumber(requestsCpu, 2)} CORE</span>
                      </div>
                      <Meter value={(requestsCpu / Math.max(1, capacityCpu)) * 100} tone="ok" />
                    </div>
                  </div>
                </Panel>

                <Panel kicker="QUOTA · MEMORY" title="内存配额">
                  <div className="mb-4 flex items-end justify-between">
                    <span className="num text-[32px] leading-none text-ink">{formatNumber(limitsMem / 1024, 1)}</span>
                    <span className="mono text-[9px] text-mute">GiB LIMIT / {formatNumber(capacityMem / 1024, 1)} GiB</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">已分配 LIMIT</span>
                        <span className="mono text-[10px] text-ink">{formatNumber((limitsMem / Math.max(1, capacityMem)) * 100, 1)}%</span>
                      </div>
                      <Meter value={(limitsMem / Math.max(1, capacityMem)) * 100} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">已请求 REQUEST</span>
                        <span className="mono text-[10px] text-ink">{formatNumber(requestsMem / 1024, 1)} GiB</span>
                      </div>
                      <Meter value={(requestsMem / Math.max(1, capacityMem)) * 100} tone="ok" />
                    </div>
                  </div>
                </Panel>
              </div>

              <Panel kicker="NODE STORAGE · PORT" title="磁盘与端口">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-end justify-between">
                      <span className="label">磁盘使用率</span>
                      <span className="mono text-[10px] text-ink">{formatNumber(diskUsage, 1)}%</span>
                    </div>
                    <Meter value={diskUsage} tone={diskUsage > 85 ? 'warn' : 'ok'} />
                    <div className="mono mt-2 flex justify-between text-[8.5px] tracking-wider text-mute">
                      <span>DISK {formatNumber(diskSize / 1024 / 1024 / 1024, 1)} GiB</span>
                      <span>USED {formatNumber((diskSize * diskUsage) / 100 / 1024 / 1024 / 1024, 1)} GiB</span>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="label">已占用 NodePort</span>
                      <span className="mono text-[9px] text-mute">{usedPorts.length} PORTS</span>
                    </div>
                    <div className="flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto">
                      {usedPorts.map((item) => (
                        <Badge key={`${item.name}-${item.port}`} tone="info">
                          {item.port} · {item.name}
                        </Badge>
                      ))}
                      {usedPorts.length === 0 && <span className="text-[10.5px] text-mute">暂无 NodePort 占用</span>}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel
                kicker="NODE ALERT THRESHOLD"
                title="节点告警阈值"
                actions={
                  <Button size="sm" variant="primary" loading={saveAlertMutation.isPending} onClick={() => saveAlertMutation.mutate()}>
                    保存阈值
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="CPU 告警 (%)">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={alertForm.cpu}
                      onChange={(event) => setAlertForm({ ...alertForm, cpu: event.target.value.replace(/[^\d.]/g, '') })}
                    />
                  </Field>
                  <Field label="内存告警 (%)">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={alertForm.memory}
                      onChange={(event) => setAlertForm({ ...alertForm, memory: event.target.value.replace(/[^\d.]/g, '') })}
                    />
                  </Field>
                  <Field label="磁盘告警 (%)">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={alertForm.disk}
                      onChange={(event) => setAlertForm({ ...alertForm, disk: event.target.value.replace(/[^\d.]/g, '') })}
                    />
                  </Field>
                </div>
                <div className="mt-3 border border-line bg-paper-2/40 px-3 py-2">
                  <p className="text-[10.5px] leading-relaxed text-ink-3">
                    阈值仅作用于当前节点，超过阈值后平台将产生节点资源告警。建议结合节点规格设置，避免阈值过低造成告警风暴。
                  </p>
                </div>
              </Panel>

              <Panel
                kicker="ETCD / NODE UNIFY"
                title="etcd 节点"
                actions={
                  <Button size="sm" loading={etcdQuery.isFetching} onClick={() => etcdQuery.refetch()}>
                    <RefreshCw size={10} /> 刷新
                  </Button>
                }
              >
                <div className="space-y-2">
                  {etcdNodes.map((item) => (
                    <label
                      key={`${item.hostname}-${item.host}`}
                      className="flex cursor-pointer items-center gap-2 border border-line px-3 py-2"
                    >
                      <input
                        type="radio"
                        name="etcd-node"
                        className="accent-[var(--color-signal)]"
                        checked={etcdChoice === item.host}
                        onChange={() => setEtcdChoice(item.host || '')}
                      />
                      <span className="mono flex-1 text-[10.5px] text-ink">{item.hostname || item.host || '—'}</span>
                      <span className="mono text-[9px] text-mute">{item.host}</span>
                    </label>
                  ))}
                  {etcdNodes.length === 0 && (
                    <div className="py-3 text-[10.5px] text-mute">
                      {etcdQuery.isLoading ? '正在检测 etcd 标签节点…' : '未检测到 etcd 标签节点'}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border border-line bg-paper-2/40 px-3 py-2">
                  <span className="text-[10px] leading-relaxed text-mute">
                    多节点均带 etcd 标签时，需选择一个节点作为统一入口。
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!etcdChoice || etcdNodes.length < 2}
                    loading={unifyEtcdMutation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `统一 etcd 节点到 ${etcdChoice}？`,
                        description: '统一后集群 etcd 访问将指向该节点，请确认节点健康且网络可达。',
                        confirmText: '统一节点',
                        danger: true,
                      })
                      if (ok) unifyEtcdMutation.mutate(etcdChoice)
                    }}
                  >
                    统一节点
                  </Button>
                </div>
              </Panel>

              <Panel kicker="LABELS & PODS" title="节点标签与 Pod">
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {Object.entries(node.objectMeta.labels ?? {}).map(([key, value]) => (
                    <Badge key={key}>
                      {key}
                      {value ? `=${value}` : ''}
                    </Badge>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
                  <div>
                    <div className="label">POD 总数</div>
                    <div className="num mt-1 text-[24px] text-ink">{pods?.total ?? '—'}</div>
                  </div>
                  <div>
                    <div className="label">健康</div>
                    <div className="num mt-1 text-[24px] text-ok">{pods?.health ?? '—'}</div>
                  </div>
                  <div>
                    <div className="label">异常</div>
                    <div className="num mt-1 text-[24px] text-signal">{pods?.unHealth ?? '—'}</div>
                  </div>
                </div>
              </Panel>

              <Panel
                kicker="NODE SERVICES"
                title={`该节点承载的服务 · ${nodeServices.length}`}
                actions={
                  <Button size="sm" loading={nodeServicesQuery.isFetching} onClick={() => nodeServicesQuery.refetch()}>
                    <RefreshCw size={10} /> 刷新
                  </Button>
                }
                bodyClassName="p-0"
              >
                <div className="max-h-[280px] divide-y divide-line/60 overflow-y-auto">
                  {nodeServices.map((service) => {
                    const ready = service.deployment?.status?.readyReplicas ?? 0
                    const desired = service.deployment?.spec?.replicas ?? 0
                    const ports = (service.service?.spec?.ports ?? [])
                      .map((port) => `${port.port}/${port.protocol || 'TCP'}`)
                      .join(', ')
                    return (
                      <div key={service.nameUs || service.nameFr} className="flex items-center gap-2 px-4 py-2">
                        <StatusDot tone={desired > 0 && ready >= desired ? 'ok' : 'warn'} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[10.5px] text-ink">
                            {service.nameUs || service.nameFr || '—'}
                          </div>
                          <div className="mono mt-0.5 truncate text-[8.5px] tracking-wider text-mute">
                            {service.service?.spec?.type || '—'} · {ports || 'NO PORT'}
                          </div>
                        </div>
                        <span className={cn('mono text-[9.5px]', ready >= desired ? 'text-ink-3' : 'text-warn')}>
                          {ready}/{desired}
                        </span>
                      </div>
                    )
                  })}
                  {nodeServices.length === 0 && (
                    <div className="px-4 py-6 text-center text-[10.5px] text-mute">
                      {nodeServicesQuery.isLoading ? '正在读取节点服务…' : '该节点暂未承载服务'}
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          ) : (
            <Panel kicker="NODE DETAIL" title="节点详情">
              <div className="flex h-[320px] flex-col items-center justify-center gap-2 text-mute">
                <ServerCog size={28} strokeWidth={1.2} />
                <span className="text-[11px]">选择左侧节点查看资源统计</span>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Modal
        open={!!nodeAction}
        onOpenChange={(open) => !open && setNodeAction(null)}
        kicker="NODE / OPERATION"
        title={nodeAction === 'uninstall' ? '卸载节点' : '重启节点组件'}
        description={
          nodeAction === 'uninstall'
            ? '从集群中移除该节点。节点上的工作负载将被驱逐，操作不可撤销。'
            : '重启节点上的 Kubernetes 组件，用于恢复异常状态。重启期间节点可能短暂不可用。'
        }
        width={480}
        footer={
          <>
            <Button size="sm" onClick={() => setNodeAction(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant={nodeAction === 'uninstall' ? 'danger' : 'signal'}
              loading={nodeActionMutation.isPending}
              onClick={() => nodeAction && nodeActionMutation.mutate(nodeAction)}
            >
              {nodeAction === 'uninstall' ? '确认卸载' : '执行重启'}
            </Button>
          </>
        }
      >
        {node && (
          <div className="space-y-3">
            <div className="border border-line px-3 py-2.5">
              <div className="label">目标节点</div>
              <div className="mt-1 font-mono text-[12px] text-ink">{node.objectMeta.name}</div>
              <div className="mono mt-0.5 text-[9px] tracking-wider text-mute">{nodeAddress(node)}</div>
            </div>
            {nodeAction === 'uninstall' ? (
              <div className="border-l-2 border-signal bg-signal/[0.05] px-3 py-2 text-[10.5px] leading-relaxed text-ink-3">
                卸载会驱逐节点上的全部 Pod，并从集群中删除节点对象。请确认业务已完成迁移，且该节点不是唯一调度节点。
              </div>
            ) : (
              <div className="space-y-1.5">
                {[
                  { value: 'restart-worker' as const, label: 'Worker 组件', desc: '重启 kubelet / kube-proxy 等节点组件' },
                  { value: 'restart-master' as const, label: 'Master 组件', desc: '重启控制面组件，影响集群 API 可用性' },
                ].map((item) => (
                  <label
                    key={item.value}
                    className={
                      nodeAction === item.value
                        ? 'flex cursor-pointer items-start gap-3 border border-signal bg-signal/[0.04] px-3 py-2.5'
                        : 'flex cursor-pointer items-start gap-3 border border-line px-3 py-2.5 hover:border-line-strong'
                    }
                  >
                    <input
                      type="radio"
                      className="mt-0.5 accent-[var(--color-signal)]"
                      checked={nodeAction === item.value}
                      onChange={() => setNodeAction(item.value)}
                    />
                    <div>
                      <div className="text-[12px] font-medium text-ink">{item.label}</div>
                      <div className="mono mt-0.5 text-[8.5px] leading-relaxed tracking-wider text-mute">{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={monitorOpen}
        onOpenChange={setMonitorOpen}
        kicker="NODE / MONITORING"
        title={node ? `${node.objectMeta.name} · 节点监控` : '节点监控'}
        description="节点级 CPU、内存、网络、磁盘与 TCP 连接趋势。指标来自 Prometheus，采样间隔约 1 分钟。"
        width={980}
        footer={
          <Button size="sm" onClick={() => setMonitorOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="mono text-[9px] tracking-widest text-mute">RANGE</span>
            <div className="flex gap-1">
              {[
                { key: 'ONE_HOURS' as const, label: '1 小时' },
                { key: 'SIX_HOURS' as const, label: '6 小时' },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setMonitorRange(item.key)}
                  className={cn(
                    'mono border px-2.5 py-1 text-[9px] tracking-widest',
                    monitorRange === item.key ? 'border-signal bg-signal text-white' : 'border-line-strong text-mute',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="border border-line p-3">
              <div className="label mb-2">CPU 使用率</div>
              <AreaTrend series={[{ name: 'CPU', points: monitorTrend(nodeMonitorQuery.data?.cpu), color: 'var(--color-signal)' }]} unit="%" height={170} />
            </div>
            <div className="border border-line p-3">
              <div className="label mb-2">内存使用</div>
              <AreaTrend
                series={[{ name: 'MEMORY', points: monitorTrend(nodeMonitorQuery.data?.memory, 1 / 1024 / 1024), color: 'var(--color-ink)' }]}
                unit="MB"
                height={170}
              />
            </div>
            <div className="border border-line p-3">
              <div className="label mb-2">网络吞吐</div>
              <AreaTrend
                series={[
                  { name: 'IN', points: monitorTrend(nodeMonitorQuery.data?.inboundNetwork, 1 / 1024) },
                  { name: 'OUT', points: monitorTrend(nodeMonitorQuery.data?.outboundNetwork, 1 / 1024), color: 'var(--color-signal)' },
                ]}
                unit="KB/s"
                height={170}
              />
            </div>
            <div className="border border-line p-3">
              <div className="label mb-2">磁盘 IO</div>
              <AreaTrend
                series={[
                  { name: 'READ', points: monitorTrend(nodeMonitorQuery.data?.diskReadIo, 1 / 1024) },
                  { name: 'WRITE', points: monitorTrend(nodeMonitorQuery.data?.diskWriteIo, 1 / 1024), color: 'var(--color-signal)' },
                ]}
                unit="KB/s"
                height={170}
              />
            </div>
            <div className="border border-line p-3 md:col-span-2">
              <div className="label mb-2">TCP 连接</div>
              <AreaTrend
                series={[
                  { name: 'ESTAB', points: monitorTrend(nodeMonitorQuery.data?.currEstab) },
                  { name: 'TIMEOUT', points: monitorTrend(nodeMonitorQuery.data?.tcpTimeouts), color: 'var(--color-signal)' },
                ]}
                height={170}
              />
            </div>
          </div>
          {nodeMonitorQuery.isLoading && <div className="text-center text-[11px] text-mute">正在读取监控数据…</div>}
        </div>
      </Modal>

      <Modal
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) {
            setAddStep(-1)
            setConnectInfo(null)
          }
        }}
        kicker="CLUSTER / ADD NODE"
        title="添加主机节点"
        description="通过 SSH 纳管新主机并加入 Kubernetes 集群。平台将依次完成初始化、Docker 环境配置、加入集群与文件系统安装。"
        width={620}
        footer={
          <>
            <Button size="sm" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={addNodeMutation.isPending}
              disabled={!addForm.ip.trim() || !addForm.hostname.trim()}
              onClick={() => addNodeMutation.mutate()}
            >
              开始接入
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="节点 IP" required>
              <input
                className="field h-9 font-mono text-[11px]"
                value={addForm.ip}
                onChange={(event) => setAddForm({ ...addForm, ip: event.target.value.trim() })}
                placeholder="如 172.16.209.26"
              />
            </Field>
            <Button
              size="sm"
              loading={connectMutation.isPending}
              disabled={!addForm.ip}
              onClick={() => connectMutation.mutate()}
            >
              连接测试
            </Button>
          </div>
          {connectInfo && (
            <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[9px] tracking-wider text-ink-3">
              SSH {connectInfo.connect ? 'CONNECTED' : 'FAILED'}
              {connectInfo.hostname ? ` · ${connectInfo.hostname}` : ''}
              {addForm.netWorkInterface ? ` · IFACE ${addForm.netWorkInterface}` : ''}
            </div>
          )}
          <Field label="节点名称" required hint="集群内唯一，建议使用 kylin-worker01 形式">
            <input
              className="field h-9 font-mono text-[11px]"
              value={addForm.hostname}
              onChange={(event) => setAddForm({ ...addForm, hostname: event.target.value.trim() })}
              placeholder="kylin-worker01"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="是否具备显卡">
              <select
                className="field h-9"
                value={addForm.labelNvidia ? '1' : '0'}
                onChange={(event) => setAddForm({ ...addForm, labelNvidia: event.target.value === '1' })}
              >
                <option value="0">否</option>
                <option value="1">是</option>
              </select>
            </Field>
            <Field label="清理系统环境" hint="开启后会先卸载目标主机上的旧集群组件">
              <select
                className="field h-9"
                value={addForm.uninstall ? '1' : '0'}
                onChange={(event) => setAddForm({ ...addForm, uninstall: event.target.value === '1' })}
              >
                <option value="0">否</option>
                <option value="1">是</option>
              </select>
            </Field>
          </div>
          <div className="space-y-1.5">
            {addSteps.map((label, index) => {
              const active = addStep === index
              const done = addStep > index
              return (
                <div
                  key={label}
                  className={cn(
                    'flex items-center gap-2 border px-3 py-2',
                    active ? 'border-signal bg-signal/[0.05]' : done ? 'border-ok/40 bg-ok/[0.04]' : 'border-line',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center border text-[8px]',
                      done ? 'border-ok text-ok' : active ? 'border-signal text-signal' : 'border-line-strong text-mute',
                    )}
                  >
                    {done ? '✓' : index + 1}
                  </span>
                  <span className="text-[10.5px] text-ink-3">{label}</span>
                  {active && <span className="mono ml-auto text-[8px] tracking-widest text-signal">RUNNING</span>}
                  {done && <span className="mono ml-auto text-[8px] tracking-widest text-ok">DONE</span>}
                </div>
              )
            })}
          </div>
        </div>
      </Modal>

      <Suspense fallback={null}>
        <NodeTerminalModal
          open={sshOpen}
          host={nodeAddress(node)}
          nodeName={node?.objectMeta.name || ''}
          onClose={() => setSshOpen(false)}
        />
      </Suspense>
    </div>
  )
}
