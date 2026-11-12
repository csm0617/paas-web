import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileCode2, Network, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState, useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import type { NodesResponse, VipItem } from '@/types'
import { formatDate, nodeAddress } from '@/lib/format'
import { DataTable, type Column } from '@/components/DataTable'
import {
  Badge,
  Button,
  CopyText,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  TabStrip,
  useConfirm,
} from '@/components/ui'
import { toast } from '@/stores/toast'

interface InterfaceItem {
  index: number
  name: string
  mac: string
  flags: string
  addresses: string[]
}

interface K8sServicePort {
  name?: string
  port?: number
  nodePort?: number
  protocol?: string
  targetPort?: number | string
}

interface K8sService {
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
    labels?: Record<string, string>
  }
  spec?: {
    type?: string
    clusterIP?: string
    ports?: K8sServicePort[]
    selector?: Record<string, string>
  }
}

interface ServiceRow {
  name: string
  namespace: string
  type: string
  clusterIP: string
  ports: K8sServicePort[]
  createdAt?: string
  selector?: Record<string, string>
}

export default function NetworkPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const tab = location.pathname.includes('vipmanage')
    ? 'vip'
    : location.pathname.includes('loadbalances') || location.pathname.includes('sscs')
      ? 'balance'
      : 'services'
  const [addOpen, setAddOpen] = useState(false)
  const [ip, setIp] = useState('')
  const [netName, setNetName] = useState('ens160')
  const [probeIp, setProbeIp] = useState('172.16.209.25')
  const [probePort, setProbePort] = useState('')
  const [probeResult, setProbeResult] = useState<{
    connect?: boolean
    hostname?: string
    netWorkInfo?: Array<{ netName?: string; ipList?: string[] }>
  } | null>(null)
  const [yamlTarget, setYamlTarget] = useState<ServiceRow | null>(null)
  const [yamlText, setYamlText] = useState('')
  const [yamlLoading, setYamlLoading] = useState(false)

  const probeMutation = useMutation({
    mutationFn: () =>
      api.get<{ connect?: boolean; hostname?: string; netWorkInfo?: Array<{ netName?: string; ipList?: string[] }> }>(
        '/v1/pub/testConnect',
        { ip: probeIp.trim(), port: probePort.trim() },
      ),
    onSuccess: (data) => setProbeResult(data ?? null),
    onError: (error) => toast.error('测试失败', errorMessage(error)),
  })

  const servicesQuery = useQuery({
    queryKey: ['k8s-services'],
    queryFn: async () => {
      const data = await api.get<{ items: K8sService[] }>('/k8s/api/v1/namespaces/gaop-namespace/services', {
        pretty: 'true',
      })
      return (data.items ?? [])
        .map<ServiceRow>((item) => ({
          name: item.metadata?.name || '',
          namespace: item.metadata?.namespace || 'gaop-namespace',
          type: item.spec?.type || 'ClusterIP',
          clusterIP: item.spec?.clusterIP || '—',
          ports: item.spec?.ports ?? [],
          createdAt: item.metadata?.creationTimestamp,
          selector: item.spec?.selector,
        }))
        .filter((item) => item.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    enabled: tab === 'services' || tab === 'balance',
    refetchInterval: 30_000,
  })
  const vipQuery = useQuery({
    queryKey: ['vips'],
    queryFn: () => api.get<VipItem[]>('/v1/pub/vip'),
    enabled: tab === 'vip' || tab === 'balance',
  })
  const interfacesQuery = useQuery({
    queryKey: ['vip-interfaces'],
    queryFn: () => api.get<InterfaceItem[]>('/v1/pub/vip/interfaces'),
    enabled: tab === 'vip',
  })
  const nodesQuery = useQuery({
    queryKey: ['network-nodes'],
    queryFn: () => api.get<NodesResponse>('/cloud/nodes'),
    enabled: tab === 'balance',
  })

  const nodeIps = (nodesQuery.data?.nodes?.nodes ?? []).map((node) => nodeAddress(node)).filter(Boolean)

  const services = servicesQuery.data ?? []
  const vips = vipQuery.data ?? []
  const interfaces = interfacesQuery.data ?? []
  const [viewerOpened, setViewerOpened] = useState('')

  useEffect(() => {
    if (!params.name || viewerOpened === params.name) return
    const match = services.find((service) => service.name === params.name)
    if (!match) return
    setViewerOpened(params.name)
    void openYaml(match)
  }, [params.name, services, viewerOpened])

  const addVipMutation = useMutation({
    mutationFn: () => api.post('/v1/pub/vip', { ip: ip.trim(), netName }),
    onSuccess: () => {
      toast.success('虚拟 IP 已添加')
      setAddOpen(false)
      setIp('')
      queryClient.invalidateQueries({ queryKey: ['vips'] })
    },
    onError: (error) => toast.error('添加失败', errorMessage(error)),
  })

  const deleteVipMutation = useMutation({
    mutationFn: (item: VipItem) => api.del('/v1/pub/vip', item),
    onSuccess: () => {
      toast.success('虚拟 IP 已删除')
      queryClient.invalidateQueries({ queryKey: ['vips'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function removeVip(item: VipItem) {
    const ok = await confirm({
      title: `删除虚拟 IP ${item.ip}？`,
      description: `将从网卡 ${item.netName} 上移除该地址，引用此地址的服务可能中断。`,
      danger: true,
      confirmText: '删除地址',
    })
    if (ok) deleteVipMutation.mutate(item)
  }

  async function openYaml(row: ServiceRow) {
    setYamlTarget(row)
    setYamlText('')
    setYamlLoading(true)
    try {
      const manifest = await api.get<Record<string, unknown>>(
        `/k8s/api/v1/namespaces/${row.namespace}/services/${row.name}`,
      )
      setYamlText(JSON.stringify(manifest, null, 2))
    } catch (error) {
      toast.error('读取 Service 配置失败', errorMessage(error))
      setYamlTarget(null)
    } finally {
      setYamlLoading(false)
    }
  }

  const saveYamlMutation = useMutation({
    mutationFn: () => {
      if (!yamlTarget) throw new Error('未选择服务')
      let manifest: unknown
      try {
        manifest = JSON.parse(yamlText)
      } catch {
        throw new Error('配置不是合法的 JSON')
      }
      return api.put(`/k8s/api/v1/namespaces/${yamlTarget.namespace}/services/${yamlTarget.name}`, manifest)
    },
    onSuccess: () => {
      toast.success('Service 配置已更新')
      setYamlTarget(null)
      queryClient.invalidateQueries({ queryKey: ['k8s-services'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteServiceMutation = useMutation({
    mutationFn: (row: ServiceRow) =>
      api.del(`/k8s/api/v1/namespaces/${row.namespace}/services/${row.name}`),
    onSuccess: () => {
      toast.success('Service 已删除')
      queryClient.invalidateQueries({ queryKey: ['k8s-services'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<'form' | 'json'>('form')
  const [createJson, setCreateJson] = useState('')
  const [createForm, setCreateForm] = useState({
    name: '',
    namespace: 'gaop-namespace',
    type: 'ClusterIP',
    selector: '',
    port: '',
    targetPort: '',
    protocol: 'TCP',
    nodePort: '',
  })

  const createServiceMutation = useMutation({
    mutationFn: () => {
      if (createMode === 'json') {
        let manifest: { metadata?: { name?: string; namespace?: string } }
        try {
          manifest = JSON.parse(createJson)
        } catch {
          throw new Error('清单不是合法的 JSON')
        }
        const name = manifest?.metadata?.name?.trim()
        if (!name) throw new Error('清单缺少 metadata.name')
        const namespace = manifest.metadata?.namespace?.trim() || 'gaop-namespace'
        return api.post(`/k8s/api/v1/namespaces/${namespace}/services`, manifest)
      }
      const name = createForm.name.trim()
      const namespace = createForm.namespace.trim() || 'gaop-namespace'
      const port = Number(createForm.port)
      if (!name) throw new Error('请填写 Service 名称')
      if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('请填写有效的服务端口（1-65535）')
      const selector: Record<string, string> = {}
      createForm.selector
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
          const [key, ...rest] = entry.split('=')
          if (!key?.trim() || rest.length === 0) throw new Error(`标签选择器格式应为 key=value：${entry}`)
          selector[key.trim()] = rest.join('=').trim()
        })
      const targetPortRaw = createForm.targetPort.trim()
      const targetPort = targetPortRaw
        ? /^\d+$/.test(targetPortRaw)
          ? Number(targetPortRaw)
          : targetPortRaw
        : port
      const portEntry: Record<string, unknown> = {
        name: `${createForm.protocol.toLowerCase()}-${port}`,
        protocol: createForm.protocol,
        port,
        targetPort,
      }
      const nodePort = Number(createForm.nodePort)
      if ((createForm.type === 'NodePort' || createForm.type === 'LoadBalancer') && Number.isFinite(nodePort) && nodePort > 0) {
        portEntry.nodePort = nodePort
      }
      const manifest = {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, namespace },
        spec: {
          type: createForm.type,
          ...(Object.keys(selector).length ? { selector } : {}),
          ports: [portEntry],
        },
      }
      return api.post(`/k8s/api/v1/namespaces/${namespace}/services`, manifest)
    },
    onSuccess: () => {
      toast.success('Service 已创建')
      setCreateOpen(false)
      setCreateForm({
        name: '',
        namespace: 'gaop-namespace',
        type: 'ClusterIP',
        selector: '',
        port: '',
        targetPort: '',
        protocol: 'TCP',
        nodePort: '',
      })
      queryClient.invalidateQueries({ queryKey: ['k8s-services'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const nodePortServices = useMemo(
    () => services.filter((service) => service.ports.some((port) => port.nodePort)),
    [services],
  )

  const serviceColumns: Array<Column<ServiceRow>> = [
    {
      key: 'name',
      header: '服务发现',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot tone="ok" />
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-ink">{row.name}</div>
            <div className="mono mt-0.5 truncate text-[8px] tracking-wider text-mute">
              {row.name}.{row.namespace}.svc.cluster.local
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: '暴露方式',
      cell: (row) => <Badge tone={row.type === 'NodePort' ? 'info' : 'default'}>{row.type}</Badge>,
    },
    {
      key: 'clusterIP',
      header: '集群 IP',
      cell: (row) => (
        <div className="mono text-[10px] text-ink-3">
          <div>{row.clusterIP}</div>
          <div className="mt-0.5 text-[8.5px] text-mute">{row.namespace}</div>
        </div>
      ),
    },
    {
      key: 'ports',
      header: '端口映射',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.ports.map((port) => (
            <Badge key={`${port.name}-${port.port}`}>
              {port.port}
              {port.nodePort ? ` → ${port.nodePort}` : ''}/{port.protocol || 'TCP'}
            </Badge>
          ))}
          {row.ports.length === 0 && <span className="text-mute">—</span>}
        </div>
      ),
    },
    {
      key: 'selector',
      header: '选择器',
      cell: (row) => (
        <span className="mono block max-w-[220px] truncate text-[9px] text-mute">
          {row.selector
            ? Object.entries(row.selector)
                .map(([key, value]) => `${key}=${value}`)
                .join(',')
            : '—'}
        </span>
      ),
    },
    {
      key: 'created',
      header: '创建时间',
      cell: (row) => (
        <span className="mono text-[9px] text-mute">
          {row.createdAt ? formatDate(row.createdAt, false) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => openYaml(row)}>
            <FileCode2 size={10} /> 配置
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={deleteServiceMutation.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `删除 Service「${row.name}」？`,
                description: '删除后该服务的集群内访问地址将立即失效，依赖它的应用可能中断。',
                confirmText: '删除服务',
                danger: true,
              })
              if (ok) deleteServiceMutation.mutate(row)
            }}
          >
            <Trash2 size={10} />
          </Button>
        </div>
      ),
    },
  ]

  const vipColumns: Array<Column<VipItem>> = [
    {
      key: 'ip',
      header: '虚拟 IP',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot tone="ok" />
          <CopyText value={row.ip} />
        </div>
      ),
    },
    {
      key: 'net',
      header: '网卡',
      cell: (row) => <Badge tone="info">{row.netName}</Badge>,
    },
    {
      key: 'state',
      header: '状态',
      cell: () => <Badge tone="ok">BOUND</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button size="sm" variant="danger" onClick={() => removeVip(row)}>
          <Trash2 size={10} /> 删除
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index={tab === 'services' ? '05 / 01' : tab === 'vip' ? '05 / 02' : '05 / 03'}
        en={tab === 'services' ? 'NETWORK · SERVICES' : tab === 'vip' ? 'NETWORK · VIRTUAL IP' : 'NETWORK · LOAD BALANCE'}
        title={tab === 'services' ? '网络服务' : tab === 'vip' ? '虚拟 IP' : '负载均衡'}
        description={
          tab === 'services'
            ? '查看平台内 Service 的暴露方式与端口映射。NodePort 服务可直接通过节点地址访问。'
            : tab === 'vip'
              ? '管理绑定在物理网卡上的虚拟地址段，用于服务对外提供稳定入口或主备漂移。'
              : '汇总集群对外入口与虚拟地址，并提供节点到端口的连通性测试。'
        }
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {tab === 'services'
                  ? `${services.length} SERVICES · ${nodePortServices.length} NODE PORT`
                  : tab === 'vip'
                    ? `${vips.length} VIRTUAL ADDRESSES`
                    : `${nodePortServices.length} INGRESS · ${vips.length} VIP`}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">CN-SH / ENS160</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              loading={tab === 'vip' ? vipQuery.isFetching : servicesQuery.isFetching}
              onClick={() => {
                if (tab === 'vip') vipQuery.refetch()
                else {
                  servicesQuery.refetch()
                  if (tab === 'balance') {
                    vipQuery.refetch()
                    nodesQuery.refetch()
                  }
                }
              }}
            >
              <RefreshCw size={11} /> 刷新
            </Button>
            {tab === 'vip' && (
              <Button size="sm" variant="signal" onClick={() => setAddOpen(true)}>
                <Plus size={11} /> 添加虚拟 IP
              </Button>
            )}
            {tab === 'services' && (
              <Button size="sm" variant="signal" onClick={() => setCreateOpen(true)}>
                <Plus size={11} /> 新建 Service
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <TabStrip
          value={tab}
          onChange={(value) =>
            navigate(
              value === 'services'
                ? '/netmanager/netservice'
                : value === 'vip'
                  ? '/netmanager/vipmanage'
                  : '/netmanager/loadbalances',
            )
          }
          tabs={[
            { value: 'services', label: '网络服务', count: services.length },
            { value: 'vip', label: '虚拟 IP', count: vips.length },
            { value: 'balance', label: '负载均衡', count: nodePortServices.length },
          ]}
        />
      </div>

      {tab === 'services' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-8" kicker="SERVICE DISCOVERY" title="服务与端口" bodyClassName="p-0">
            <DataTable
              columns={serviceColumns}
              rows={services}
              rowKey={(row) => `${row.namespace}/${row.name}`}
              loading={servicesQuery.isLoading}
              pageSize={12}
              emptyTitle="暂无网络服务"
            />
          </Panel>
          <div className="flex flex-col gap-4 xl:col-span-4">
            <Panel kicker="INTERFACES" title="节点网卡">
              {interfaces.map((item) => (
                <div key={item.name} className="border-b border-line py-2.5 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-ink">{item.name}</span>
                    <Badge tone={item.flags.includes('up') ? 'ok' : 'warn'}>{item.flags.includes('up') ? 'UP' : 'DOWN'}</Badge>
                  </div>
                  <div className="mono mt-1 text-[8.5px] text-mute">{item.mac}</div>
                  <div className="mono mt-1 text-[9.5px] text-ink-3">{item.addresses.join(' · ')}</div>
                </div>
              ))}
              {interfaces.length === 0 && <div className="py-4 text-[10.5px] text-mute">未获取到网卡信息</div>}
            </Panel>
            <Panel kicker="NODE PORT" title="对外端口">
              <div className="space-y-2">
                {nodePortServices.map((service) => {
                  const ports = service.ports.filter((port) => port.nodePort)
                  return (
                    <div key={service.name} className="border-b border-line pb-2 last:border-0">
                      <div className="mono text-[10px] text-ink">{service.name}</div>
                      <div className="mono mt-1 text-[9px] text-ink-3">
                        {ports.map((port) => `${port.nodePort} → ${port.port}`).join(' / ')}
                      </div>
                    </div>
                  )
                })}
                {nodePortServices.length === 0 && <div className="py-3 text-[10.5px] text-mute">没有 NodePort 服务</div>}
              </div>
            </Panel>
          </div>
        </div>
      ) : tab === 'vip' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-8" kicker="VIRTUAL IP" title="地址池" bodyClassName="p-0">
            <DataTable
              columns={vipColumns}
              rows={vips}
              rowKey={(row) => `${row.netName}-${row.ip}`}
              loading={vipQuery.isLoading}
              emptyTitle="尚未绑定虚拟 IP"
              emptyDescription="虚拟 IP 可用于对外暴露稳定入口。添加前请确认网卡与地址段。"
              emptyAction={
                <Button size="sm" variant="signal" onClick={() => setAddOpen(true)}>
                  <Plus size={11} /> 添加虚拟 IP
                </Button>
              }
            />
          </Panel>
          <div className="flex flex-col gap-4 xl:col-span-4">
            <Panel kicker="INTERFACES" title="可用网卡">
              {interfaces.map((item) => (
                <div key={item.name} className="border-b border-line py-2.5 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-ink">{item.name}</span>
                    <span className="mono text-[8.5px] text-mute">IDX {item.index}</span>
                  </div>
                  <div className="mono mt-1 text-[9px] text-ink-3">{item.addresses[0]}</div>
                </div>
              ))}
            </Panel>
            <Panel kicker="NOTICE" title="使用建议">
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                虚拟 IP 需与网卡所在子网一致。在主备场景下，配合 VIP 漂移可实现服务入口的快速切换。
              </p>
            </Panel>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-8" kicker="INGRESS ENDPOINTS" title="对外入口" bodyClassName="p-0">
            <div className="divide-y divide-line/70">
              {nodePortServices.map((service) => {
                const name = service.name
                const ports = service.ports.filter((port) => port.nodePort)
                return (
                  <div key={name} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot tone="ok" />
                        <span className="truncate font-mono text-[11px] text-ink">{name}</span>
                      </div>
                      <span className="mono text-[8.5px] tracking-widest text-mute">
                        {service.clusterIP} · {service.type}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ports.flatMap((port) =>
                        (nodeIps.length ? nodeIps : [window.location.hostname]).map((ip) => (
                          <CopyText key={`${ip}-${port.nodePort}`} value={`${ip}:${port.nodePort}`} />
                        )),
                      )}
                      {ports.length === 0 && <span className="text-[10px] text-mute">未暴露 NodePort</span>}
                    </div>
                    <div className="mono mt-1.5 text-[8px] tracking-wider text-mute">
                      {ports.map((port) => `${port.nodePort} → ${port.port}/${port.protocol || 'TCP'}`).join(' · ') || '—'}
                    </div>
                  </div>
                )
              })}
              {nodePortServices.length === 0 && (
                <div className="px-4 py-10 text-center text-[11px] text-mute">
                  当前没有 NodePort 类型服务，可在「服务配置 → 端口」中暴露
                </div>
              )}
            </div>
          </Panel>

          <div className="space-y-4 xl:col-span-4">
            <Panel kicker="CONNECTIVITY" title="连通性测试">
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_100px] gap-2">
                  <input
                    className="field h-9 font-mono text-[11px]"
                    value={probeIp}
                    onChange={(event) => setProbeIp(event.target.value)}
                    placeholder="节点 IP"
                  />
                  <input
                    className="field h-9 font-mono text-[11px]"
                    value={probePort}
                    onChange={(event) => setProbePort(event.target.value.replace(/[^\d]/g, ''))}
                    placeholder="端口"
                  />
                </div>
                <Button
                  size="sm"
                  variant="signal"
                  className="w-full"
                  loading={probeMutation.isPending}
                  disabled={!probeIp.trim()}
                  onClick={() => probeMutation.mutate()}
                >
                  测试连通性
                </Button>
              </div>
              {probeResult && (
                <div className="mt-3 border border-line bg-paper-2/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={probeResult.connect ? 'ok' : 'bad'}>
                      {probeResult.connect ? 'REACHABLE' : 'UNREACHABLE'}
                    </Badge>
                    <span className="mono text-[9px] text-ink-3">{probeResult.hostname || '—'}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {(probeResult.netWorkInfo ?? []).map((item) => (
                      <div key={item.netName} className="mono flex items-start gap-2 text-[9px] text-mute">
                        <span className="flex-none text-ink-3">{item.netName}</span>
                        <span className="break-all">{(item.ipList ?? []).slice(0, 3).join(' / ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            <Panel kicker="VIRTUAL ADDRESS" title="虚拟地址">
              <div className="space-y-2">
                {vips.map((item) => (
                  <div key={`${item.netName}-${item.ip}`} className="flex items-center justify-between border-b border-line pb-2 last:border-0">
                    <span className="font-mono text-[10.5px] text-ink">{item.ip}</span>
                    <Badge tone="info">{item.netName}</Badge>
                  </div>
                ))}
                {vips.length === 0 && <div className="py-2 text-[10.5px] text-mute">尚未配置虚拟 IP</div>}
              </div>
            </Panel>
          </div>
        </div>
      )}

      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        kicker="NETWORK / VIP"
        title="添加虚拟 IP"
        description="绑定后该地址将立即生效，请确认不会与现有地址冲突。"
        width={440}
        footer={
          <>
            <Button size="sm" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!ip.trim() || !netName}
              loading={addVipMutation.isPending}
              onClick={() => addVipMutation.mutate()}
            >
              绑定地址
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="网卡" required>
            <select className="field" value={netName} onChange={(event) => setNetName(event.target.value)}>
              {interfaces.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} · {item.addresses[0]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="虚拟 IP" required hint="需与网卡同网段，例如 172.16.209.100">
            <input className="field font-mono" value={ip} onChange={(event) => setIp(event.target.value)} placeholder="172.16.209.100" />
          </Field>
          <div className="flex items-center gap-2 border border-line bg-paper-2/30 px-3 py-2">
            <Network size={12} className="text-mute" />
            <span className="mono text-[9px] text-mute">ADDRESS WILL BE BOUND TO {netName || '—'}</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!yamlTarget}
        onOpenChange={(open) => {
          if (!open) setYamlTarget(null)
        }}
        kicker="SERVICE / MANIFEST"
        title={yamlTarget ? `Service 配置 · ${yamlTarget.name}` : 'Service 配置'}
        description="以 JSON 查看和编辑 Kubernetes Service 清单，保存后立即应用到集群。"
        width={760}
        footer={
          <>
            <Button size="sm" onClick={() => setYamlTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={yamlLoading || !yamlText.trim()}
              loading={saveYamlMutation.isPending}
              onClick={() => saveYamlMutation.mutate()}
            >
              保存配置
            </Button>
          </>
        }
      >
        {yamlLoading ? (
          <div className="py-10 text-center text-[11px] text-mute">正在读取 Service 配置…</div>
        ) : (
          <textarea
            className="field min-h-[420px] font-mono text-[10px] leading-relaxed"
            spellCheck={false}
            value={yamlText}
            onChange={(event) => setYamlText(event.target.value)}
          />
        )}
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        kicker="SERVICE / CREATE"
        title="新建 Service"
        description="通过 Kubernetes API 创建原生 Service，将其指向带有匹配标签的 Pod。"
        width={600}
        footer={
          <>
            <Button size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={
                createMode === 'json'
                  ? !createJson.trim()
                  : !createForm.name.trim() || !createForm.port.trim()
              }
              loading={createServiceMutation.isPending}
              onClick={() => createServiceMutation.mutate()}
            >
              创建 Service
            </Button>
          </>
        }
      >
        <div className="mb-3 flex border border-line-strong">
          {([
            ['form', '表单'],
            ['json', 'JSON 清单'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={`mono h-8 flex-1 text-[9.5px] tracking-[0.14em] ${
                createMode === value ? 'bg-signal text-white' : 'text-ink-3 hover:bg-paper-2'
              }`}
              onClick={() => {
                if (value === 'json' && !createJson.trim()) {
                  setCreateJson(
                    JSON.stringify(
                      {
                        apiVersion: 'v1',
                        kind: 'Service',
                        metadata: {
                          name: createForm.name.trim() || 'my-service',
                          namespace: createForm.namespace.trim() || 'gaop-namespace',
                        },
                        spec: {
                          type: createForm.type,
                          selector: { app: 'my-app' },
                          ports: [
                            {
                              name: 'tcp-8080',
                              protocol: 'TCP',
                              port: Number(createForm.port) || 8080,
                              targetPort: Number(createForm.targetPort) || Number(createForm.port) || 8080,
                            },
                          ],
                        },
                      },
                      null,
                      2,
                    ),
                  )
                }
                setCreateMode(value)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {createMode === 'json' ? (
          <textarea
            className="field min-h-[420px] font-mono text-[10px] leading-relaxed"
            spellCheck={false}
            value={createJson}
            onChange={(event) => setCreateJson(event.target.value)}
            placeholder="粘贴 Kubernetes Service JSON 清单"
          />
        ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="名称" required hint="小写字母、数字与短横线">
            <input
              className="field font-mono text-[11px]"
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="my-service"
            />
          </Field>
          <Field label="命名空间" required>
            <input
              className="field font-mono text-[11px]"
              value={createForm.namespace}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, namespace: event.target.value }))}
              placeholder="gaop-namespace"
            />
          </Field>
          <Field label="类型">
            <select
              className="field"
              value={createForm.type}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, type: event.target.value }))}
            >
              <option value="ClusterIP">ClusterIP</option>
              <option value="NodePort">NodePort</option>
              <option value="LoadBalancer">LoadBalancer</option>
            </select>
          </Field>
          <Field label="协议">
            <select
              className="field"
              value={createForm.protocol}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, protocol: event.target.value }))}
            >
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
          </Field>
          <Field label="服务端口" required hint="Service 暴露的端口">
            <input
              className="field font-mono text-[11px]"
              value={createForm.port}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, port: event.target.value.replace(/[^\d]/g, '') }))}
              placeholder="8080"
            />
          </Field>
          <Field label="目标端口" hint="留空则与服务端口一致">
            <input
              className="field font-mono text-[11px]"
              value={createForm.targetPort}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, targetPort: event.target.value }))}
              placeholder="80 或 http"
            />
          </Field>
          {(createForm.type === 'NodePort' || createForm.type === 'LoadBalancer') && (
            <Field label="NodePort" hint="留空由集群自动分配 30000-32767">
              <input
                className="field font-mono text-[11px]"
                value={createForm.nodePort}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, nodePort: event.target.value.replace(/[^\d]/g, '') }))
                }
                placeholder="自动分配"
              />
            </Field>
          )}
          <div className={createForm.type === 'NodePort' || createForm.type === 'LoadBalancer' ? '' : 'col-span-2'}>
            <Field label="标签选择器" hint="每行一个 key=value">
              <textarea
                className="field min-h-[86px] font-mono text-[10.5px]"
                value={createForm.selector}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, selector: event.target.value }))}
                placeholder={'app=my-app\nrelease=prod'}
              />
            </Field>
          </div>
        </div>
        )}
      </Modal>
    </div>
  )
}
