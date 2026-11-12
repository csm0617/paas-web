import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { toast } from '@/stores/toast'
import { Badge, Button, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'
import { cn } from '@/lib/utils'

interface SettingItem {
  key: string
  val?: string | null
  desc?: string | null
  createdAt?: number | null
  updatedAt?: number | null
}

function groupOf(key: string) {
  return key.includes('.') ? key.split('.')[0] : 'general'
}

const groupLabels: Record<string, string> = {
  alarm: '告警阈值',
  backup: '备份策略',
  log: '日志留存',
  system: '系统参数',
  general: '通用设置',
}

export default function GlobalSettingsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [activeGroup, setActiveGroup] = useState('ALL')

  const query = useQuery({
    queryKey: ['global-settings'],
    queryFn: () => api.get<SettingItem[]>('/settings'),
  })

  const settings = query.data ?? []

  useEffect(() => {
    if (!query.data) return
    const next: Record<string, string> = {}
    query.data.forEach((item) => {
      next[item.key] = item.val ?? ''
    })
    setDraft(next)
  }, [query.data])

  const groups = useMemo(() => {
    const set = new Set(settings.map((item) => groupOf(item.key)))
    return ['ALL', ...Array.from(set)]
  }, [settings])

  const filtered = useMemo(() => {
    if (activeGroup === 'ALL') return settings
    return settings.filter((item) => groupOf(item.key) === activeGroup)
  }, [settings, activeGroup])

  const saveMutation = useMutation({
    mutationFn: (item: SettingItem) =>
      api.put(`/settings/${encodeURIComponent(item.key)}`, { val: draft[item.key] ?? '' }),
    onSuccess: (_data, item) => {
      toast.success(`已保存 ${item.desc || item.key}`)
      queryClient.invalidateQueries({ queryKey: ['global-settings'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const resetMutation = useMutation({
    mutationFn: () => api.post('/settings/reset_setting'),
    onSuccess: () => {
      toast.success('全局配置已重置为默认值')
      queryClient.invalidateQueries({ queryKey: ['global-settings'] })
    },
    onError: (error) => toast.error('重置失败', errorMessage(error)),
  })

  const dirtyCount = settings.filter((item) => (draft[item.key] ?? '') !== (item.val ?? '')).length

  return (
    <div>
      <PageHeader
        index="07 / 04"
        en="ACCESS · GLOBAL SETTINGS"
        title="全局设置"
        description="平台级参数集中在此维护，保存后立即写入配置并对巡检、告警与日志策略生效。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={dirtyCount ? 'warn' : 'ok'} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {settings.length} PARAMETERS · {dirtyCount} UNSAVED
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">SETTINGS / GLOBAL</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="danger"
              loading={resetMutation.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: '重置全部全局配置？',
                  description: '所有参数将恢复为平台默认值，可能影响告警、备份与日志策略，请确认后继续。',
                  confirmText: '确认重置',
                  danger: true,
                })
                if (ok) resetMutation.mutate()
              }}
            >
              <RotateCcw size={11} /> 重置配置
            </Button>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {groups.map((group) => (
          <button
            key={group}
            onClick={() => setActiveGroup(group)}
            className={cn(
              'mono border px-3 py-1.5 text-[9px] tracking-[0.14em] transition-colors',
              activeGroup === group
                ? 'border-ink bg-ink text-paper'
                : 'border-line-strong text-ink-3 hover:border-ink hover:text-ink',
            )}
          >
            {group === 'ALL' ? '全部' : groupLabels[group] || group.toUpperCase()}
            <span className="ml-2 opacity-60">
              {group === 'ALL' ? settings.length : settings.filter((item) => groupOf(item.key) === group).length}
            </span>
          </button>
        ))}
      </div>

      <Panel kicker="PARAMETER REGISTRY" title="参数清单" bodyClassName="p-0">
        <div className="divide-y divide-line/70">
          {filtered.map((item) => {
            const dirty = (draft[item.key] ?? '') !== (item.val ?? '')
            return (
              <div key={item.key} className="grid grid-cols-1 gap-3 px-4 py-3.5 md:grid-cols-12 md:items-center">
                <div className="md:col-span-4">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={11} className="text-mute" />
                    <span className="text-[11.5px] text-ink">{item.desc || item.key}</span>
                    {dirty && <Badge tone="warn">UNSAVED</Badge>}
                  </div>
                  <div className="mono mt-1 text-[8.5px] tracking-widest text-mute">{item.key}</div>
                </div>
                <div className="md:col-span-5">
                  <input
                    className="field h-9 font-mono text-[11px]"
                    value={draft[item.key] ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, [item.key]: event.target.value }))}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 md:col-span-3">
                  <span className="mono text-[8.5px] text-mute">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : 'DEFAULT'}
                  </span>
                  <Button
                    size="sm"
                    variant={dirty ? 'signal' : 'default'}
                    disabled={!dirty}
                    loading={saveMutation.isPending && saveMutation.variables?.key === item.key}
                    onClick={() => saveMutation.mutate(item)}
                  >
                    <Save size={10} /> 保存
                  </Button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-[11px] text-mute">
              {query.isLoading ? '正在读取平台参数…' : '当前分组下没有参数'}
            </div>
          )}
        </div>
      </Panel>

      <div className="mt-3 border border-line bg-paper-2/40 px-4 py-2.5">
        <p className="text-[10.5px] leading-relaxed text-ink-3">
          参数以键值对形式持久化，修改将即时生效。调整告警阈值前请确认当前集群负载，避免产生大量告警。
        </p>
      </div>
    </div>
  )
}
