import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileArchive, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge, Button, Modal, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'

interface PackageItem {
  id?: string | number
  realStoreFilename?: string
  execFileName?: string
  updatedAt?: number | string
  status?: number | string | null
  execFaultMessage?: string | null
  relationSoftwareId?: string | null
}

interface PackageList {
  list: PackageItem[]
  total: number
}

interface ClientItem {
  id?: number
  clientFilename?: string
  clientStoreFilename?: string
  version?: string
  type?: string
  md5?: string
  updatedAt?: number
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/gaop'

function statusOf(status?: number | string | null) {
  if (status === 1 || status === '1') return { label: 'READY', tone: 'ok' as const }
  if (status === 2 || status === '2') return { label: 'PROCESSING', tone: 'warn' as const }
  if (status === 0 || status === '0') return { label: 'FAILED', tone: 'bad' as const }
  return { label: status === null || status === undefined ? 'UNKNOWN' : String(status), tone: 'default' as const }
}

export default function PackagePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const token = useAuthStore((state) => state.token)
  const [keyword, setKeyword] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [clientOpen, setClientOpen] = useState(false)
  const [clientType, setClientType] = useState('windows')
  const [clientVersion, setClientVersion] = useState('')
  const [clientFile, setClientFile] = useState<File | null>(null)
  const [clientKeyword, setClientKeyword] = useState('')
  const clientFileRef = useRef<HTMLInputElement | null>(null)

  const query = useQuery({
    queryKey: ['cs-packages', keyword],
    queryFn: () => api.get<PackageList>('/v1/cs_software/upload', { page: 1, size: 100, keyword }),
    refetchInterval: 30_000,
  })

  const packages = query.data?.list ?? []

  const clientsQuery = useQuery({
    queryKey: ['client-packages', clientKeyword],
    queryFn: () =>
      api.get<{ clientList?: ClientItem[]; total?: number }>('/v1/pub/client/getList', {
        page: 1,
        size: 100,
        fileNameKeyword: clientKeyword,
      }),
    enabled: clientOpen,
  })

  const uploadClientMutation = useMutation({
    mutationFn: async () => {
      if (!clientFile) throw new Error('请选择客户端包文件')
      if (!clientType.trim()) throw new Error('请填写客户端类型')
      const form = new FormData()
      form.append('type', clientType.trim())
      form.append('version', clientVersion.trim() || 'latest')
      form.append('file', clientFile)
      const response = await fetch(`${API_BASE}/v1/pub/client/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: form,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `上传失败 (${response.status})`)
      }
    },
    onSuccess: () => {
      toast.success('客户端包已上传')
      setClientFile(null)
      setClientVersion('')
      queryClient.invalidateQueries({ queryKey: ['client-packages'] })
    },
    onError: (error) => toast.error('上传失败', errorMessage(error)),
  })

  const deleteClientMutation = useMutation({
    mutationFn: (id: number) => api.del('/v1/pub/client/delete/bath', [id]),
    onSuccess: () => {
      toast.success('客户端包已删除')
      queryClient.invalidateQueries({ queryKey: ['client-packages'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function downloadClient(item: ClientItem) {
    if (!item.id) return
    try {
      const response = await fetch(
        `${API_BASE}/v1/pub/client/download/single?clientId=${encodeURIComponent(String(item.id))}`,
        { credentials: 'include', headers: token ? { token } : undefined },
      )
      if (!response.ok) throw new Error(`下载失败 (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = item.clientFilename || `client-${item.version || item.id}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      toast.error('下载失败', errorMessage(error))
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string | number) =>
      api.del('/v1/cs_software', undefined, { uploadStoreRecordId: id }),
    onSuccess: () => {
      toast.success('程序包已删除')
      queryClient.invalidateQueries({ queryKey: ['cs-packages'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function upload() {
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`${API_BASE}/v1/cs_software/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: form,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && payload.code !== 0)) {
        throw new Error(payload?.msg || '上传失败')
      }
      toast.success('程序包已上传')
      setUploadOpen(false)
      setFile(null)
      queryClient.invalidateQueries({ queryKey: ['cs-packages'] })
    } catch (error) {
      toast.error('上传失败', errorMessage(error))
    } finally {
      setUploading(false)
    }
  }

  async function download(item: PackageItem) {
    if (!item.id) return
    try {
      const response = await fetch(
        `${API_BASE}/v1/cs_software/download?uploadStoreId=${encodeURIComponent(String(item.id))}`,
        { credentials: 'include', headers: token ? { token } : undefined },
      )
      if (!response.ok) throw new Error(`下载失败 (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = item.realStoreFilename || 'package.zip'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error('下载失败', errorMessage(error))
    }
  }

  async function remove(item: PackageItem) {
    if (!item.id) return
    const ok = await confirm({
      title: `删除程序包「${item.realStoreFilename || item.execFileName || item.id}」？`,
      description: '删除后关联软件将无法回滚到该程序包。',
      danger: true,
      confirmText: '删除程序包',
    })
    if (ok) deleteMutation.mutate(item.id)
  }

  const columns = useMemo<Array<Column<PackageItem>>>(
    () => [
      {
        key: 'name',
        header: '程序包 / PACKAGE',
        sortValue: (row) => row.realStoreFilename || '',
        cell: (row) => (
          <div className="flex items-center gap-2.5">
            <FileArchive size={13} className="text-mute" />
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-ink">
                {row.realStoreFilename || row.execFileName || '—'}
              </div>
              <div className="mono mt-0.5 truncate text-[8.5px] tracking-wider text-mute">
                {row.execFileName || '—'}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: '状态',
        cell: (row) => {
          const status = statusOf(row.status)
          return (
            <div className="flex items-center gap-1.5">
              <StatusDot tone={status.tone === 'bad' ? 'bad' : status.tone === 'warn' ? 'warn' : 'ok'} />
              <span className="mono text-[9px] tracking-widest text-ink-3">{status.label}</span>
            </div>
          )
        },
      },
      {
        key: 'software',
        header: '关联软件',
        cell: (row) => (
          <span className="mono text-[9.5px] text-ink-3">{row.relationSoftwareId || '—'}</span>
        ),
      },
      {
        key: 'updated',
        header: '更新时间',
        sortValue: (row) => Number(row.updatedAt ?? 0),
        cell: (row) => <span className="mono text-[9.5px] text-mute">{formatDate(row.updatedAt, false)}</span>,
      },
      {
        key: 'error',
        header: '异常信息',
        cell: (row) => (
          <span className="line-clamp-2 block max-w-[260px] text-[10px] leading-relaxed text-signal">
            {row.execFaultMessage || ''}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (row) => (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" onClick={() => download(row)}>
              <Download size={10} /> 下载
            </Button>
            <Button size="sm" variant="danger" onClick={() => remove(row)}>
              <Trash2 size={10} /> 删除
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div>
      <PageHeader
        index="03 / 04"
        en="REGISTRY · SOFTWARE PACKAGES"
        title="程序包"
        description="上传与服务绑定的程序包（zip），用于软件部署与版本回滚。程序包按软件关联后可在应用管理中引用。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {packages.length} PACKAGES · {query.data?.total ?? 0} TOTAL
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">ZIP / ROLLBACK</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" onClick={() => setClientOpen(true)}>
              <FileArchive size={11} /> 客户端包
            </Button>
            <Button
              size="sm"
              variant="signal"
              onClick={() => {
                setFile(null)
                setUploadOpen(true)
              }}
            >
              <Upload size={11} /> 上传程序包
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['程序包', packages.length, 'PACKAGES'],
          ['可用', packages.filter((item) => statusOf(item.status).tone === 'ok').length, 'READY'],
          ['处理中', packages.filter((item) => statusOf(item.status).tone === 'warn').length, 'PROCESSING'],
          ['异常', packages.filter((item) => statusOf(item.status).tone === 'bad').length, 'FAILED'],
        ].map(([label, value, hint]) => (
          <Panel key={label} bodyClassName="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </Panel>
        ))}
      </div>

      <Panel
        kicker="PACKAGE STORE"
        title="程序包清单"
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-1.5 border border-line-strong bg-paper px-2">
            <Search size={11} className="text-mute" />
            <input
              className="h-7 w-44 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-mute"
              placeholder="搜索文件名"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={packages}
          rowKey={(row) => String(row.id ?? row.realStoreFilename)}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="暂无程序包"
          emptyDescription="上传 zip 程序包后，可在软件配置中关联并用于版本回滚。"
          emptyAction={
            <Button
              size="sm"
              variant="signal"
              onClick={() => {
                setFile(null)
                setUploadOpen(true)
              }}
            >
              <Upload size={11} /> 上传程序包
            </Button>
          }
        />
      </Panel>

      <Modal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        kicker="PACKAGE / UPLOAD"
        title="上传程序包"
        description="仅支持 zip 压缩包。上传后平台会解析并登记程序包信息。"
        width={480}
        footer={
          <>
            <Button size="sm" onClick={() => setUploadOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" disabled={!file} loading={uploading} onClick={upload}>
              上传
            </Button>
          </>
        }
      >
        <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-paper-2/30 py-10 transition-colors hover:border-signal"
        >
          <Upload size={20} className="text-mute" />
          <span className="text-[11.5px] text-ink">{file ? file.name : '选择 zip 程序包'}</span>
          <span className="mono text-[8.5px] tracking-widest text-mute">
            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'CLICK TO SELECT'}
          </span>
        </button>
      </Modal>

      <Modal
        open={clientOpen}
        onOpenChange={setClientOpen}
        kicker="PACKAGES / CLIENT DISTRIBUTION"
        title="客户端包"
        description="管理 CS 架构应用的客户端安装包。上传后可按类型与版本下发，供终端下载安装。"
        width={820}
        footer={
          <Button size="sm" onClick={() => setClientOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 border border-line bg-paper-2/40 px-3 py-3 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
            <input
              className="field h-8 font-mono text-[10.5px]"
              placeholder="类型，如 windows"
              value={clientType}
              onChange={(event) => setClientType(event.target.value)}
            />
            <input
              className="field h-8 font-mono text-[10.5px]"
              placeholder="版本，如 1.0.0"
              value={clientVersion}
              onChange={(event) => setClientVersion(event.target.value)}
            />
            <input
              ref={clientFileRef}
              type="file"
              className="hidden"
              onChange={(event) => setClientFile(event.target.files?.[0] ?? null)}
            />
            <Button size="sm" onClick={() => clientFileRef.current?.click()}>
              <Upload size={11} /> {clientFile ? clientFile.name : '选择客户端包'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!clientFile}
              loading={uploadClientMutation.isPending}
              onClick={() => uploadClientMutation.mutate()}
            >
              上传
            </Button>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className="field h-9 w-full pl-8 text-[11px]"
              placeholder="按文件名搜索客户端包"
              value={clientKeyword}
              onChange={(event) => setClientKeyword(event.target.value)}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto border border-line">
            <div className="grid grid-cols-[1.4fr_0.7fr_0.8fr_1fr_120px] gap-2 border-b border-line bg-paper-2/60 px-3 py-2">
              {['文件名', '类型', '版本', '更新时间', '操作'].map((item) => (
                <span key={item} className="label">
                  {item}
                </span>
              ))}
            </div>
            {(clientsQuery.data?.clientList ?? []).map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1.4fr_0.7fr_0.8fr_1fr_120px] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0"
              >
                <span className="mono truncate text-[10px] text-ink">{item.clientFilename || item.clientStoreFilename || '—'}</span>
                <Badge>{item.type || '—'}</Badge>
                <span className="mono text-[9.5px] text-ink-3">{item.version || '—'}</span>
                <span className="mono text-[9px] text-ink-3">{formatDate(item.updatedAt)}</span>
                <div className="flex justify-end gap-1">
                  <Button size="sm" onClick={() => downloadClient(item)}>
                    <Download size={10} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={deleteClientMutation.isPending}
                    onClick={async () => {
                      if (!item.id) return
                      const ok = await confirm({
                        title: `删除客户端包「${item.clientFilename || item.id}」？`,
                        description: '删除后终端将无法再下载该版本客户端。',
                        confirmText: '删除',
                        danger: true,
                      })
                      if (ok) deleteClientMutation.mutate(item.id)
                    }}
                  >
                    <Trash2 size={10} />
                  </Button>
                </div>
              </div>
            ))}
            {(clientsQuery.data?.clientList ?? []).length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-mute">
                {clientsQuery.isLoading ? '正在读取客户端包…' : '暂无客户端包'}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
