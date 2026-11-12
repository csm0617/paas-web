import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Layers, RotateCw, Save, Server } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { Badge, Button, PageHeader, Panel, StatusDot } from '@/components/ui'

const DEFAULT_MAP_HOST = `${window.location.hostname}:63000/GIS-Manager-Web/#/`

const ENTRIES = [
  { label: '地图数据', en: 'DATA', path: '/map-setting/data/dataType/map', description: '管理地图、影像、矢量与实体模型数据。' },
  { label: '地图服务', en: 'SERVICE', path: '/map-setting/service/serviceType/MapService', description: '发布与维护地图、栅格、文件与模型服务。' },
  { label: '运行日志', en: 'LOG', path: '/map-setting/log', description: '查看 GIS 服务运行日志。' },
  { label: '操作记录', en: 'OP LOG', path: '/map-setting/operationLog', description: '审计 GIS 管理端的操作记录。' },
]

function storedMapHost() {
  if (typeof window === 'undefined') return DEFAULT_MAP_HOST
  return localStorage.getItem('map') || DEFAULT_MAP_HOST
}

function iframePath(pathname: string) {
  const parts = pathname.replace(/^\/map-setting\/?/, '').split('/').filter(Boolean)
  const [section, key, value] = parts
  switch (section) {
    case 'data':
      return key && value ? `DataManager?${key}=${value}` : 'DataManager'
    case 'service':
      return key && value ? `Service?${key}=${value}` : 'Service'
    case 'log':
      return 'Log'
    case 'operationLog':
      return 'OperationLog'
    default:
      return ''
  }
}

export default function MapSettingPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [base, setBase] = useState(storedMapHost)
  const [draft, setDraft] = useState(storedMapHost)
  const [nonce, setNonce] = useState(0)

  const gisQuery = useQuery({
    queryKey: ['gis-status'],
    queryFn: () => api.get<number>('/v1/licence/gisStatus'),
    retry: 0,
  })

  const suffix = iframePath(location.pathname)
  const src = useMemo(() => {
    if (!suffix || !base.trim()) return ''
    const host = /^https?:\/\//.test(base.trim()) ? base.trim() : `http://${base.trim()}`
    return `${host.replace(/\/?$/, '/')}${suffix}`
  }, [base, suffix])

  const gisReady = gisQuery.data === 1

  function saveHost() {
    const next = draft.trim() || DEFAULT_MAP_HOST
    localStorage.setItem('map', next)
    setBase(next)
    setNonce((value) => value + 1)
  }

  return (
    <div>
      <PageHeader
        index="10 / 01"
        en="GIS · MAP SETTINGS"
        title="地图配置"
        description="通过内嵌 GIS 管理端维护地图数据与服务。地图管理端独立部署，本页仅提供统一入口。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={gisReady ? 'ok' : 'warn'} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                GIS {gisReady ? 'READY' : gisQuery.isLoading ? 'CHECKING' : 'NOT ACTIVATED'}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">FRAME / GIS-MANAGER-WEB</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={gisQuery.isFetching} onClick={() => gisQuery.refetch()}>
              <RotateCw size={11} /> 检测状态
            </Button>
            {src && (
              <Button size="sm" variant="signal" onClick={() => setNonce((value) => value + 1)}>
                <ExternalLink size={11} /> 重新载入
              </Button>
            )}
          </>
        }
      />

      <Panel
        className="mb-4"
        kicker="GIS / ENDPOINT"
        title="管理端地址"
        actions={<Badge tone={gisReady ? 'ok' : 'warn'}>{gisReady ? 'AUTHORIZED' : `STATUS ${gisQuery.data ?? '—'}`}</Badge>}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="field h-9 flex-1 font-mono text-[11px]"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={DEFAULT_MAP_HOST}
          />
          <Button size="sm" variant="signal" onClick={saveHost}>
            <Save size={11} /> 保存地址
          </Button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
          默认指向当前主机的 63000 端口。若 GIS 管理端部署在其他节点，请填写完整地址，例如 172.16.209.25:63000/GIS-Manager-Web/#/。
        </p>
      </Panel>

      {!suffix ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ENTRIES.map((entry) => (
            <Panel key={entry.path} corner className="p-0">
              <button className="w-full text-left" onClick={() => navigate(entry.path)}>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex h-10 w-10 items-center justify-center border border-line-strong bg-paper-2">
                    {entry.en === 'LOG' || entry.en === 'OP LOG' ? (
                      <Layers size={16} className="text-ink-3" />
                    ) : (
                      <Server size={16} className="text-ink-3" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">{entry.label}</div>
                    <div className="mono mt-1 text-[8.5px] tracking-widest text-mute">{entry.en}</div>
                  </div>
                </div>
                <div className="border-t border-line px-4 py-2 text-[10px] leading-relaxed text-ink-3">
                  {entry.description}
                </div>
              </button>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel
          bodyClassName="p-0"
          kicker="GIS / CONSOLE"
          title="地图管理端"
          actions={
            <span className="mono max-w-[420px] truncate text-[8.5px] tracking-wider text-mute">{src}</span>
          }
        >
          {!gisReady && (
            <div className="border-b border-line bg-warn/5 px-4 py-2.5 text-[10.5px] leading-relaxed text-warn">
              GIS 授权状态为 {gisQuery.data ?? '未知'}，管理端可能无法访问。请先在「版本与授权」中完成 GIS 授权。
            </div>
          )}
          <iframe
            key={`${src}-${nonce}`}
            src={src}
            title="GIS Manager"
            className="h-[calc(100vh-330px)] min-h-[520px] w-full border-0 bg-paper-2"
          />
        </Panel>
      )}
    </div>
  )
}
