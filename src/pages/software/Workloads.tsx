import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Boxes, Layers, RefreshCw, RotateCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem, ServiceList } from '@/types'
import { Badge, Button, Field, Modal, PageHeader, Panel, StatusDot } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

function nameOf(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function imageOf(service: ServiceItem) {
  if (typeof service.imageInfo === 'string') return service.imageInfo
  return service.imageInfo?.image || service.imageInfo?.imageName || '—'
}

export default function WorkloadsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [scaleTarget, setScaleTarget] = useState<ServiceItem | null>(null)
  const [scale, setScale] = useState(1)

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
        imageOf(service).toLowerCase().includes(q) ||
        (service.service?.metadata?.namespace || '').toLowerCase().includes(q),
    )
  }, [services, keyword])

  const restartMutation = useMutation({
    mutationFn: (name: string) => api.put('/v1/service/reStart', [name]),
    onSuccess: () => {
      toast.success('滚动重启已下发')
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('重启失败', errorMessage(error)),
  })

  const scaleMutation = useMutation({
    mutationFn: ({ name, replicas }: { name: string; replicas: number }) =>
      api.put('/v1/service/scale', undefined, { serviceName: name, scale: replicas }),
    onSuccess: () => {
      toast.success('副本数已更新')
      setScaleTarget(null)
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  const totalReady = services.reduce((sum, service) => sum + (service.deployment?.status?.readyReplicas ?? 0), 0)
  const totalDesired = services.reduce((sum, service) => sum + (service.deployment?.spec?.replicas ?? 0), 0)
  const images = new Set(services.map(imageOf)).size

  return (
    <div>
      <PageHeader
        index="02 / 03"
        en="SOFTWARE · WORKLOADS"
        title="工作负载"
        description="以 Deployment 视角审视微服务编排：副本就绪度、镜像版本与滚动更新结果。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={totalReady >= totalDesired ? 'ok' : 'warn'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {totalReady}/{totalDesired} REPLICAS READY
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{services.length} DEPLOYMENTS</span>
          </>
        }
        actions={
          <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        {[
          ['Deployment', services.length, 'WORKLOADS'],
          ['就绪副本', `${totalReady}/${totalDesired}`, 'REPLICAS'],
          ['镜像版本', images, 'IMAGE TAGS'],
          ['异常重启', services.reduce((sum, s) => sum + (s.restartCount ?? 0), 0), 'RESTARTS'],
        ].map(([label, value, hint]) => (
          <div key={label} className="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[30px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </div>
        ))}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field h-9 w-[260px] pl-8 text-[12px]"
            placeholder="搜索 Deployment / 镜像 / 命名空间"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <span className="mono ml-auto text-[9px] tracking-widest text-mute">{filtered.length} WORKLOADS</span>
      </div>

      <div className="space-y-2.5">
        {filtered.map((service, index) => {
          const desired = service.deployment?.spec?.replicas ?? 0
          const ready = service.deployment?.status?.readyReplicas ?? 0
          const available = service.deployment?.status?.availableReplicas ?? 0
          const healthy = desired > 0 && ready >= desired
          return (
            <article
              key={nameOf(service)}
              className="panel group flex flex-col gap-4 p-0 transition-shadow hover:shadow-[3px_3px_0_rgba(21,24,27,0.08)] lg:flex-row lg:items-stretch"
            >
              <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3 lg:w-[280px] lg:border-b-0 lg:border-r">
                <span className="mono text-[9px] text-mute">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={healthy ? 'ok' : 'warn'} />
                    <span className="truncate font-mono text-[12px] text-ink">{nameOf(service)}</span>
                  </div>
                  <div className="mono mt-1 truncate text-[8.5px] tracking-widest text-mute">
                    {service.service?.metadata?.namespace || 'default'} / Deployment
                  </div>
                </div>
              </div>

              <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="label mb-1">容器镜像</div>
                  <div className="mono truncate text-[10px] text-ink-3">{imageOf(service)}</div>
                </div>
                <div>
                  <div className="label mb-1.5">副本</div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(12, Math.max(desired, 1)) }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-5 w-[6px]',
                          i < ready ? 'bg-ok' : i < desired ? 'bg-warn/50' : 'bg-line',
                        )}
                      />
                    ))}
                    <span className="num ml-2 text-[14px] text-ink">
                      {ready}
                      <span className="text-[10px] text-mute">/{desired}</span>
                    </span>
                  </div>
                </div>
                <div>
                  <div className="label mb-1">可用 / 更新</div>
                  <div className="mono text-[10.5px] text-ink">
                    {available} / {service.deployment?.status?.updatedReplicas ?? 0}
                  </div>
                </div>
                <div>
                  <div className="label mb-1">重启</div>
                  <div className={cn('mono text-[10.5px]', (service.restartCount ?? 0) > 0 ? 'text-signal' : 'text-ink')}>
                    {service.restartCount ?? 0}
                  </div>
                </div>
                <div>
                  <div className="label mb-1">创建时间</div>
                  <div className="mono text-[9.5px] text-mute">
                    {formatDate(service.deployment?.metadata?.creationTimestamp, false)}
                  </div>
                </div>
              </div>

              <div className="flex flex-none items-center gap-1.5 border-t border-line px-4 py-2 lg:border-l lg:border-t-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(`/software/workloads/deploymentViewer/${encodeURIComponent(nameOf(service))}`)}
                >
                  详情 <ArrowUpRight size={10} />
                </Button>
                <Button size="sm" onClick={() => restartMutation.mutate(nameOf(service))} loading={restartMutation.isPending}>
                  <RotateCw size={10} /> 重启
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setScaleTarget(service)
                    setScale(desired || 1)
                  }}
                >
                  <Layers size={10} /> 副本
                </Button>
              </div>
            </article>
          )
        })}

        {!query.isLoading && filtered.length === 0 && (
          <Panel>
            <div className="flex flex-col items-center gap-2 py-12 text-mute">
              <Boxes size={26} strokeWidth={1.2} />
              <span className="text-[11.5px]">暂无工作负载</span>
            </div>
          </Panel>
        )}
      </div>

      <Modal
        open={!!scaleTarget}
        onOpenChange={(open) => !open && setScaleTarget(null)}
        kicker="WORKLOAD / SCALE"
        title={`调整「${scaleTarget ? nameOf(scaleTarget) : ''}」副本`}
        description="副本变更将触发 Deployment 滚动更新。"
        width={400}
        footer={
          <>
            <Button size="sm" onClick={() => setScaleTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={scaleMutation.isPending}
              onClick={() => scaleTarget && scaleMutation.mutate({ name: nameOf(scaleTarget), replicas: scale })}
            >
              应用
            </Button>
          </>
        }
      >
        <Field label="副本数">
          <input
            type="number"
            min={0}
            max={50}
            className="field h-12 text-center text-[20px]"
            value={scale}
            onChange={(event) => setScale(Math.max(0, Number(event.target.value)))}
          />
        </Field>
        <div className="mt-3">
          <Badge tone="info">当前 {scaleTarget?.deployment?.spec?.replicas ?? 0} 副本</Badge>
        </div>
      </Modal>
    </div>
  )
}
