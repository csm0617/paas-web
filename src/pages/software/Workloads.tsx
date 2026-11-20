import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dump, load } from 'js-yaml'
import { Plus } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem, ServiceList } from '@/types'
import { Button, Modal, PageToolbar, Panel, useConfirm } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

function nameOf(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function imageShort(service: ServiceItem) {
  const images = (service.deployment?.spec?.template?.spec?.containers ?? []).map((container) => {
    const parts = (container.image || '').split('/')
    return parts[1] || parts[2] ? `${parts[1] || '--'}/${parts[2] || '--'}` : '--'
  })
  return images.join(',') || '--'
}

function statusOf(service: ServiceItem) {
  const ready = service.deployment?.status?.readyReplicas ?? 0
  const desired = service.deployment?.spec?.replicas ?? 0
  const tone = service.terminated
    ? 'text-danger'
    : ready > 0 && desired > 0 && ready < desired
      ? 'text-[#2884d8]'
      : ready > 0
        ? 'text-ok'
        : desired > 0
          ? 'text-warn'
          : 'text-danger'
  const text = service.terminated
    ? '已停止'
    : ready > 0 && desired > 0 && ready < desired
      ? '滚动发布中'
      : ready > 0
        ? '运行中'
        : desired > 0
          ? '启动中'
          : '已停止'
  const runText = desired === 0 ? '全部停止' : ready === desired ? '全部运行' : '部分运行'
  return { text, tone, ready, desired, runText }
}

function toYaml(deployment: unknown) {
  if (!deployment) return ''
  const clone = JSON.parse(JSON.stringify(deployment)) as Record<string, unknown>
  const metadata = clone.metadata as Record<string, unknown> | undefined
  if (metadata) delete metadata.managedFields
  return dump(clone)
}

function deploymentYaml(service: ServiceItem) {
  return toYaml(service.deployment)
}

const YamlEditor = lazy(() => import('@/components/yaml/YamlEditor'))

/* 厂商内置的框架系统服务，禁止删除 */
const FRAMEWORK_SERVICES = new Set([
  'zk',
  'redis',
  'mysql',
  'kafka',
  'gaop-startup',
  'gaop-gateway-auth',
  'gaop-gateway',
  'gaop-image-uploader',
  'gaop-be',
  'gaop-mysql',
  'gaop-fdfs',
  'gaop-web',
  'gaop-auth',
  'gaop-login',
  'gaop-redis',
  'gaop-radondb-mysql-leader',
  'service-top-high-priority-class',
  'service-high-priority-class',
  'service-low-priority-class',
  'service-mid-priority-class',
  'high-priority-class',
])

function isFrameworkService(service: ServiceItem) {
  const metadata = service.deployment?.metadata
  const appType = metadata?.labels?.['system/appType']
  if (appType) return appType.startsWith('gaop')
  return FRAMEWORK_SERVICES.has(metadata?.name || nameOf(service))
}

const DEPLOY_TEMPLATE = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ''
  namespace: gaop-namespace
  labels:
    app: ''
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ''
  template:
    metadata:
      labels:
        app: ''
    spec:
      containers:
        - name: ''
          image: ''
`

function validateCreateYaml(text: string): string[] {
  if (!text.trim()) return ['YAML 内容不能为空']
  try {
    const body = load(text) as Record<string, unknown> | undefined
    if (!body) return ['YAML 内容不是合法的对象']
    const errors: string[] = []
    if (body.kind !== 'Deployment') errors.push('kind 必须为 Deployment')
    const metadata = body.metadata as { name?: string } | undefined
    if (!metadata?.name) errors.push('metadata.name 不能为空')
    else if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(metadata.name))
      errors.push('metadata.name 只能包含小写字母、数字和中划线')
    return errors
  } catch (error) {
    return [`YAML 解析失败：${(error as Error).message}`]
  }
}

export default function WorkloadsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [keyword, setKeyword] = useState('')
  const [yamlTarget, setYamlTarget] = useState<ServiceItem | null>(null)
  const [yamlDraft, setYamlDraft] = useState('')
  const [yamlOrigin, setYamlOrigin] = useState('')
  const [yamlErrors, setYamlErrors] = useState<string[]>([])
  const [yamlLoading, setYamlLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createYaml, setCreateYaml] = useState(DEPLOY_TEMPLATE)
  const [createErrors, setCreateErrors] = useState<string[]>(validateCreateYaml(DEPLOY_TEMPLATE))

  const query = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
    refetchInterval: 30_000,
  })

  const services = query.data?.services ?? []

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (service) =>
        nameOf(service).toLowerCase().includes(q) ||
        imageShort(service).toLowerCase().includes(q) ||
        (service.service?.metadata?.namespace || '').toLowerCase().includes(q),
    )
  }, [services, keyword])

  const deleteMutation = useMutation({
    mutationFn: (names: string[]) => api.del('/v1/service', names),
    onSuccess: () => {
      toast.success('删除指令已下发')
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const saveYamlMutation = useMutation({
    mutationFn: () => {
      if (!yamlTarget?.deployment) throw new Error('未获取到 Deployment 信息')
      const namespace = yamlTarget.deployment.metadata?.namespace || 'gaop-namespace'
      const name = yamlTarget.deployment.metadata?.name || nameOf(yamlTarget)
      let body: unknown
      try {
        body = load(yamlDraft)
      } catch (error) {
        throw new Error(`YAML 解析失败：${(error as Error).message}`)
      }
      return api.put(`/k8s/apis/apps/v1/namespaces/${namespace}/deployments/${name}`, body)
    },
    onSuccess: () => {
      toast.success('YAML 已保存', 'Deployment 将按新配置滚动更新')
      setYamlTarget(null)
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const body = load(createYaml) as Record<string, unknown>
      const metadata = body.metadata as { name?: string; namespace?: string } | undefined
      if (!metadata?.name) throw new Error('metadata.name 不能为空')
      const namespace = metadata.namespace || 'gaop-namespace'
      return api.post(`/k8s/apis/apps/v1/namespaces/${namespace}/deployments`, body)
    },
    onSuccess: () => {
      toast.success('部署文件创建成功')
      setCreateOpen(false)
      setCreateYaml(DEPLOY_TEMPLATE)
      setCreateErrors(validateCreateYaml(DEPLOY_TEMPLATE))
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  async function remove(names: string[]) {
    if (names.length === 0) return
    const ok = await confirm({
      title: names.length > 1 ? `删除 ${names.length} 个工作负载？` : `删除工作负载「${names[0]}」？`,
      description: '删除后对应 Deployment 将被移除，服务将停止运行。',
      confirmText: '删除',
      danger: true,
    })
    if (ok) deleteMutation.mutate(names)
  }

  async function openYaml(service: ServiceItem) {
    const namespace = service.deployment?.metadata?.namespace || 'gaop-namespace'
    const name = service.deployment?.metadata?.name || nameOf(service)
    setYamlTarget(service)
    setYamlDraft('')
    setYamlOrigin('')
    setYamlErrors([])
    setYamlLoading(true)
    let text = ''
    try {
      const full = await api.get<Record<string, unknown>>(
        `/k8s/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
      )
      text = toYaml(full)
    } catch (error) {
      text = deploymentYaml(service)
      toast.error('读取 Deployment 失败，已展示本地缓存', errorMessage(error))
    }
    setYamlDraft(text)
    setYamlOrigin(text)
    const { validateDeploymentYaml } = await import('@/components/yaml/YamlEditor')
    setYamlErrors(validateDeploymentYaml(text))
    setYamlLoading(false)
  }

  const columns: Array<Column<ServiceItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 80,
      align: 'center',
      cell: (_row, index) => <span className="text-[14px] text-ink">{index + 1}</span>,
    },
    {
      key: 'key',
      header: '服务标识',
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{nameOf(row)}</span>,
    },
    {
      key: 'status',
      header: '状态',
      width: 140,
      align: 'center',
      cell: (row) => {
        const status = statusOf(row)
        return (
          <div className="leading-[1.5715]">
            <div className={cn('text-[14px]', status.tone)}>{status.text}</div>
            <div className="text-[14px] text-ink-3">
              {status.ready}/{status.desired}
              {status.runText}
            </div>
          </div>
        )
      },
    },
    {
      key: 'image',
      header: '镜像',
      width: 200,
      align: 'center',
      cell: (row) => (
        <span className="mx-auto block max-w-[240px] truncate text-[14px] text-ink" title={imageShort(row)}>
          {imageShort(row)}
        </span>
      ),
    },
    {
      key: 'created',
      header: '创建时间',
      width: 200,
      align: 'center',
      cell: (row) => (
        <span className="whitespace-nowrap text-[14px] text-ink">
          {row.deployment?.metadata?.creationTimestamp
            ? formatDate(row.deployment.metadata.creationTimestamp, true)
            : '--'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: 200,
      align: 'center',
      cell: (row) => {
        const locked = isFrameworkService(row)
        return (
          <div className="flex items-center justify-center gap-2.5 text-[14px]">
            <button
              className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
              onClick={() => openYaml(row)}
            >
              查看/编辑Yaml
            </button>
            <button
              disabled={locked}
              title={locked ? '框架系统服务是禁止删除的' : undefined}
              className={cn(
                'transition-colors',
                locked
                  ? 'cursor-not-allowed text-mute'
                  : 'text-[#ff7b7b] hover:text-[#ff9a9a]',
              )}
              onClick={() => {
                if (!locked) remove([nameOf(row)])
              }}
            >
              删除
            </button>
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageToolbar
        search={{ value: keyword, onChange: setKeyword, placeholder: '请输入部署文件名搜索' }}
      >
        <Button
          size="sm"
          variant="signal"
          onClick={() => {
            setCreateYaml(DEPLOY_TEMPLATE)
            setCreateErrors(validateCreateYaml(DEPLOY_TEMPLATE))
            setCreateOpen(true)
          }}
        >
          <Plus size={11} /> 创建部署文件
        </Button>
      </PageToolbar>

      <Panel title="部署文件" bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => nameOf(row)}
          loading={query.isLoading}
          rowHeight={77}
          emptyTitle="暂无部署文件"
          emptyDescription="命名空间内没有可展示的 Deployment。"
        />
      </Panel>

      <Modal
        open={!!yamlTarget}
        onOpenChange={(open) => {
          if (!open) setYamlTarget(null)
        }}
        title="YAML"
        width={1080}
        footer={
          <>
            <Button size="sm" onClick={() => setYamlTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={yamlLoading || yamlDraft === yamlOrigin || yamlErrors.length > 0}
              loading={saveYamlMutation.isPending}
              onClick={() => saveYamlMutation.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="h-[560px] overflow-hidden border border-[#33506e]">
          {yamlLoading ? (
            <div className="flex h-full items-center justify-center text-[14px] text-mute">
              正在读取 Deployment…
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-[14px] text-mute">
                  编辑器加载中…
                </div>
              }
            >
              <YamlEditor
                value={yamlDraft}
                onChange={setYamlDraft}
                onValidate={setYamlErrors}
                height="100%"
              />
            </Suspense>
          )}
        </div>
        <div className="mt-2 flex min-h-8 items-start gap-4 border border-line bg-[#0c1b2a] px-3 py-1.5 text-[12px] text-ink-3">
          <span className="flex-none pt-[1px]">错误信息栏</span>
          {yamlErrors.length > 0 ? (
            <span className="min-w-0 flex-1 whitespace-pre-wrap text-danger">
              {yamlErrors.slice(0, 6).join('\n')}
              {yamlErrors.length > 6 ? `\n… 还有 ${yamlErrors.length - 6} 条` : ''}
            </span>
          ) : (
            <span className="text-mute">暂无错误信息</span>
          )}
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setCreateYaml(DEPLOY_TEMPLATE)
            setCreateErrors(validateCreateYaml(DEPLOY_TEMPLATE))
          }
        }}
        title="创建部署文件"
        width={1080}
        footer={
          <>
            <Button size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={createErrors.length > 0}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="h-[560px] overflow-hidden border border-[#33506e]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-[14px] text-mute">
                编辑器加载中…
              </div>
            }
          >
            <YamlEditor
              value={createYaml}
              onChange={(value) => {
                setCreateYaml(value)
                setCreateErrors(validateCreateYaml(value))
              }}
              height="100%"
            />
          </Suspense>
        </div>
        <div className="mt-2 flex min-h-8 items-start gap-4 border border-line bg-[#0c1b2a] px-3 py-1.5 text-[12px] text-ink-3">
          <span className="flex-none pt-[1px]">错误信息栏</span>
          {createErrors.length > 0 ? (
            <span className="min-w-0 flex-1 whitespace-pre-wrap text-danger">
              {createErrors.slice(0, 6).join('\n')}
            </span>
          ) : (
            <span className="text-mute">暂无错误信息</span>
          )}
        </div>
      </Modal>
    </div>
  )
}
