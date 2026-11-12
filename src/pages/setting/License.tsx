import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Cpu, FileCode2, KeyRound, Languages, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { LicenseInfo } from '@/types'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { PasswordPrompt } from '@/components/PasswordPrompt'
import {
  Badge,
  Button,
  CopyText,
  Field,
  KV,
  Meter,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  useConfirm,
} from '@/components/ui'

interface VersionInfo {
  tag: string
  systemVersion: string
  releaseTime: string
  kubernetes: string
  etcd: string
  docker: string
}

interface MachineCode {
  code: string
  existGis: boolean
}

interface LangVersion {
  id?: number
  lang: string
  langVersion: string
  used?: number
  createTime?: number
}

interface AuthJar {
  id?: number
  jarName?: string
  storeJarName?: string
  className?: string
  createAt?: number
  updateAt?: number
  used?: number
}

export default function LicensePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const location = useLocation()
  const navigate = useNavigate()
  const requiresPassword = location.pathname === '/auth' || location.pathname === '/authpaas'
  const [authPassed, setAuthPassed] = useState(!requiresPassword)
  const [activateOpen, setActivateOpen] = useState(false)
  const [activeCode, setActiveCode] = useState('')
  const [frameworkOpen, setFrameworkOpen] = useState(false)
  const [frameworkKey, setFrameworkKey] = useState('')
  const [langOpen, setLangOpen] = useState(false)
  const [langFile, setLangFile] = useState<File | null>(null)
  const [langDetail, setLangDetail] = useState<LangVersion | null>(null)
  const langFileRef = useRef<HTMLInputElement | null>(null)
  const [jarOpen, setJarOpen] = useState(false)
  const [jarFile, setJarFile] = useState<File | null>(null)
  const [jarClass, setJarClass] = useState('')
  const [jarKey, setJarKey] = useState('')
  const jarFileRef = useRef<HTMLInputElement | null>(null)

  const versionQuery = useQuery({
    queryKey: ['version-info'],
    queryFn: () => api.get<VersionInfo>('/v1/pub/versionInfo'),
  })
  const licenceQuery = useQuery({
    queryKey: ['licence-info'],
    queryFn: () => api.get<LicenseInfo>('/v1/licence/info'),
  })
  const machineQuery = useQuery({
    queryKey: ['machine-code'],
    queryFn: () => api.get<MachineCode>('/v1/licence'),
  })
  const langQuery = useQuery({
    queryKey: ['lang-current'],
    queryFn: () => api.get<{ language: string; version: string }>('/v1/lang/current'),
  })
  const langVersionsQuery = useQuery({
    queryKey: ['lang-versions'],
    queryFn: () =>
      api.get<{ versionList?: LangVersion[]; total?: number }>('/v1/pub/lang/version', { page: 1, size: 100 }),
    enabled: langOpen,
  })
  const langDetailQuery = useQuery({
    queryKey: ['lang-detail', langDetail?.lang, langDetail?.langVersion],
    queryFn: () =>
      api.get<{ languageList?: Array<{ textKey?: string; content?: string; module?: string }> }>('/v1/lang/detail', {
        lang: langDetail?.lang,
        version: langDetail?.langVersion,
      }),
    enabled: !!langDetail,
  })

  const setLangMutation = useMutation({
    mutationFn: (item: LangVersion) =>
      api.post('/v1/lang/version', undefined, { lang: item.lang, version: item.langVersion }),
    onSuccess: () => {
      toast.success('语言包版本已切换')
      queryClient.invalidateQueries({ queryKey: ['lang-current'] })
      queryClient.invalidateQueries({ queryKey: ['lang-versions'] })
    },
    onError: (error) => toast.error('切换失败', errorMessage(error)),
  })
  const importLangMutation = useMutation({
    mutationFn: async () => {
      if (!langFile) throw new Error('请选择语言包文件')
      const form = new FormData()
      form.append('file', langFile)
      const response = await fetch(`${API_BASE}/v1/lang/import`, {
        method: 'POST',
        headers: useAuthStore.getState().token ? { token: useAuthStore.getState().token as string } : undefined,
        body: form,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
    },
    onSuccess: () => {
      toast.success('语言包已导入')
      setLangFile(null)
      queryClient.invalidateQueries({ queryKey: ['lang-versions'] })
    },
    onError: (error) => toast.error('导入失败', errorMessage(error)),
  })
  const removeLangMutation = useMutation({
    mutationFn: (item: LangVersion) =>
      api.del('/v1/lang/remove', undefined, { lang: item.lang, version: item.langVersion }),
    onSuccess: () => {
      toast.success('语言包已删除')
      queryClient.invalidateQueries({ queryKey: ['lang-versions'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })
  const jarQuery = useQuery({
    queryKey: ['auth-jars'],
    queryFn: () => api.get<{ list?: AuthJar[]; total?: number }>('/v1/load/list', { page: 1, size: 100 }),
    enabled: jarOpen,
  })
  const uploadJarMutation = useMutation({
    mutationFn: async () => {
      if (!jarFile) throw new Error('请选择 Jar 文件')
      const form = new FormData()
      form.append('file', jarFile)
      const query = jarClass.trim() ? `?className=${encodeURIComponent(jarClass.trim())}` : ''
      const response = await fetch(`${API_BASE}/v1/load/upload${query}`, {
        method: 'POST',
        headers: useAuthStore.getState().token ? { token: useAuthStore.getState().token as string } : undefined,
        body: form,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `上传失败 (${response.status})`)
      }
    },
    onSuccess: () => {
      toast.success('授权扩展 Jar 已上传')
      setJarFile(null)
      setJarClass('')
      queryClient.invalidateQueries({ queryKey: ['auth-jars'] })
    },
    onError: (error) => toast.error('上传失败', errorMessage(error)),
  })
  const updateJarKeyMutation = useMutation({
    mutationFn: () => {
      const key = jarKey.trim()
      if (!key) throw new Error('请填写解密公钥')
      return api.post('/v1/load/update', { publicKey: key })
    },
    onSuccess: () => {
      toast.success('默认解密公钥已更新')
      setJarKey('')
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  const version = versionQuery.data
  const licence = licenceQuery.data
  const machine = machineQuery.data

  const daysLeft = licence?.end ? Math.ceil((licence.end - Date.now()) / 86_400_000) : null
  const valid = !!licence?.authStatus && !licence?.expired

  const activateMutation = useMutation({
    mutationFn: () => api.post('/v1/licence', { activeCode: activeCode.trim() }),
    onSuccess: () => {
      toast.success('授权已激活')
      setActivateOpen(false)
      setActiveCode('')
      queryClient.invalidateQueries({ queryKey: ['licence-info'] })
      queryClient.invalidateQueries({ queryKey: ['machine-code'] })
    },
    onError: (error) => toast.error('激活失败', errorMessage(error)),
  })

  const clearMutation = useMutation({
    mutationFn: () => api.del('/v1/licence'),
    onSuccess: () => {
      toast.warn('授权已清除')
      queryClient.invalidateQueries({ queryKey: ['licence-info'] })
    },
    onError: (error) => toast.error('清除失败', errorMessage(error)),
  })

  async function clearLicence() {
    const ok = await confirm({
      title: '清除平台授权？',
      description: '清除后平台功能将受限，且所有在线用户会被登出。请谨慎操作。',
      danger: true,
      confirmText: '清除授权',
    })
    if (ok) clearMutation.mutate()
  }

  const gisQuery = useQuery({
    queryKey: ['gis-status'],
    queryFn: () => api.get<number | { status?: number }>('/v1/licence/gisStatus'),
  })
  const activateGisMutation = useMutation({
    mutationFn: () => api.get('/v1/licence/checkAndActiveGis'),
    onSuccess: () => {
      toast.success('GIS 组件检查完成')
      gisQuery.refetch()
    },
    onError: (error) => toast.error('GIS 激活失败', errorMessage(error)),
  })
  const logoutAllMutation = useMutation({
    mutationFn: () => api.get('/v1/licence/loginOutAllUser'),
    onSuccess: () => toast.success('已强制所有用户下线'),
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })
  const updateFrameworkMutation = useMutation({
    mutationFn: () => {
      const key = frameworkKey.trim()
      if (!key) throw new Error('请填写框架公钥')
      return api.post('/v1/licence/updateFramework', { encryptInfo: key })
    },
    onSuccess: () => {
      toast.success('框架公钥已更新')
      setFrameworkOpen(false)
      setFrameworkKey('')
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  async function logoutAll() {
    const ok = await confirm({
      title: '强制所有用户下线？',
      description: '所有在线会话将立即失效，用户需要重新登录。请在维护窗口内操作。',
      danger: true,
      confirmText: '全部下线',
    })
    if (ok) logoutAllMutation.mutate()
  }

  if (requiresPassword && !authPassed) {
    return (
      <div>
        <PasswordPrompt
          open
          type={0}
          title="验证管理员密码"
          description="授权管理页面受保护，请输入管理员密码后访问。"
          onOpenChange={() => undefined}
          onCancel={() => navigate(-1)}
          onSuccess={() => setAuthPassed(true)}
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        index="09 / 01"
        en="PLATFORM · VERSION & LICENSE"
        title="版本与授权"
        description="查看平台版本、运行组件与授权状态。授权文件与机器码绑定，迁移部署环境后需重新激活。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={valid ? 'ok' : 'bad'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{valid ? 'LICENCE ACTIVE' : 'LICENCE INVALID'}</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{version?.tag || '—'}</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              loading={licenceQuery.isFetching}
              onClick={() => {
                licenceQuery.refetch()
                versionQuery.refetch()
                machineQuery.refetch()
              }}
            >
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={() => setActivateOpen(true)}>
              <KeyRound size={11} /> 激活授权
            </Button>
            <Button size="sm" loading={activateGisMutation.isPending} onClick={() => activateGisMutation.mutate()}>
              检查 GIS
            </Button>
            <Button size="sm" variant="signal" onClick={() => setFrameworkOpen(true)}>
              更新框架
            </Button>
            <Button size="sm" onClick={() => setLangOpen(true)}>
              <Languages size={11} /> 语言包
            </Button>
            <Button size="sm" onClick={() => setJarOpen(true)}>
              <FileCode2 size={11} /> 授权扩展
            </Button>
            <Button size="sm" loading={logoutAllMutation.isPending} onClick={logoutAll}>
              全员下线
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="panel relative xl:col-span-7">
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <div className="mono text-[8.5px] tracking-[0.24em] text-mute">LICENCE STATUS</div>
              <div className="mt-2 text-[24px] font-semibold text-ink">
                {valid ? '授权有效' : licence?.expired ? '授权已过期' : '未激活'}
              </div>
            </div>
            {valid ? (
              <ShieldCheck size={34} strokeWidth={1.1} className="text-ok" />
            ) : (
              <ShieldAlert size={34} strokeWidth={1.1} className="text-signal" />
            )}
          </div>
          <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
            <div className="px-5 py-4">
              <div className="mono text-[8px] tracking-[0.18em] text-mute">EXPIRES AT</div>
              <div className="num mt-2 text-[24px] text-ink">
                {licence?.endIso8601?.slice(0, 10) || '—'}
              </div>
              <div className="mono mt-1 text-[9px] tracking-wider text-mute">
                {daysLeft !== null ? `${daysLeft} DAYS REMAINING` : 'UNLIMITED / UNKNOWN'}
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="mono text-[8px] tracking-[0.18em] text-mute">MACHINE BINDING</div>
              <div className="num mt-2 text-[24px] text-ink">{machine?.existGis ? 'GIS + CORE' : 'CORE'}</div>
              <div className="mono mt-1 text-[9px] tracking-wider text-mute">HARDWARE LOCKED</div>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="mono text-[8px] tracking-[0.18em] text-mute">LICENCE COVERAGE</span>
              <span className="mono text-[9px] text-ink-3">{valid ? '100%' : '0%'}</span>
            </div>
            <div className="h-[4px] w-full bg-white/10">
              <div className="h-full bg-signal transition-[width] duration-700" style={{ width: valid ? '100%' : '4%' }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <div className="mono text-[8px] tracking-[0.16em] text-mute">AUTHORIZATION CODE</div>
                <div className="mono mt-1 truncate text-[10px] text-ink-3">{licence?.code || '—'}</div>
              </div>
              <div>
                <div className="mono text-[8px] tracking-[0.16em] text-mute">TRIAL PERIOD</div>
                <div className="mono mt-1 text-[10px] text-ink-3">{licence?.trialPeriod ? formatDate(licence.trialPeriod, false) : '—'}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="mono text-[8px] tracking-[0.16em] text-mute">MSOP LICENCE SERVICE</span>
            <Button size="sm" variant="danger" onClick={clearLicence} loading={clearMutation.isPending}>
              <Trash2 size={10} /> 清除授权
            </Button>
          </div>
        </section>

        <div className="flex flex-col gap-4 xl:col-span-5">
          <Panel kicker="PLATFORM VERSION" title="平台版本">
            <div className="flex items-end justify-between">
              <div>
                <div className="label">系统版本</div>
                <div className="num mt-1 text-[34px] leading-none text-ink">{version?.systemVersion || '—'}</div>
              </div>
              <Badge tone="ok">
                <BadgeCheck size={10} /> STABLE
              </Badge>
            </div>
            <div className="mt-3 space-y-1">
              <KV k="构建标签" v={version?.tag || '—'} />
              <KV k="发布日期" v={version?.releaseTime || '—'} />
              <KV k="语言" v={`${langQuery.data?.language || 'zh_CN'} / ${langQuery.data?.version || 'default'}`} />
            </div>
          </Panel>

          <Panel kicker="MACHINE CODE" title="机器码">
            <p className="mb-3 text-[10.5px] leading-relaxed text-ink-3">
              将机器码提交至授权方以获取激活文件。机器码变化通常意味着硬件或容器环境发生变化。
            </p>
            <div className="border border-line bg-paper-2/40 p-3">
              <div className="mono break-all text-[9.5px] leading-relaxed text-ink-3">{machine?.code || '读取中…'}</div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="mono text-[8.5px] tracking-widest text-mute">HARDWARE FINGERPRINT</span>
              {machine?.code && <CopyText value={machine.code} label="复制机器码" />}
            </div>
          </Panel>
        </div>

        <Panel className="xl:col-span-12" kicker="RUNTIME COMPONENTS" title="运行组件">
          <div className="grid grid-cols-1 divide-line sm:grid-cols-3 sm:divide-x">
            {[
              ['KUBERNETES', version?.kubernetes, 'CONTAINER ORCHESTRATION'],
              ['ETCD', version?.etcd, 'CLUSTER STATE STORE'],
              ['DOCKER', version?.docker, 'CONTAINER RUNTIME'],
            ].map(([name, value, hint], index) => (
              <div key={name} className={index > 0 ? 'px-5 py-4 sm:border-l sm:border-line' : 'px-5 py-4'}>
                <div className="flex items-center gap-2">
                  <Cpu size={13} className="text-mute" />
                  <span className="mono text-[9px] tracking-[0.18em] text-mute">{name}</span>
                </div>
                <div className="num mt-2 text-[28px] leading-none text-ink">{value || '—'}</div>
                <div className="mono mt-2 text-[8px] tracking-[0.14em] text-mute">{hint}</div>
                <div className="mt-3">
                  <Meter value={100} tone="ok" />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Modal
        open={activateOpen}
        onOpenChange={setActivateOpen}
        kicker="LICENCE / ACTIVATE"
        title="激活平台授权"
        description="粘贴授权方签发的激活码。激活成功后平台将自动刷新授权状态。"
        width={540}
        footer={
          <>
            <Button size="sm" onClick={() => setActivateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!activeCode.trim()}
              loading={activateMutation.isPending}
              onClick={() => activateMutation.mutate()}
            >
              验证并激活
            </Button>
          </>
        }
      >
        <Field label="激活码" required hint="激活码仅可绑定当前机器码，请勿在多台环境间混用。">
          <textarea
            className="field font-mono text-[11px]"
            rows={6}
            value={activeCode}
            onChange={(event) => setActiveCode(event.target.value)}
            placeholder="粘贴授权激活码…"
          />
        </Field>
        <div className="mt-3 border border-line bg-paper-2/40 px-3 py-2">
          <div className="label mb-1">当前机器码</div>
          <div className="mono break-all text-[9px] leading-relaxed text-ink-3">{machine?.code || '—'}</div>
        </div>
      </Modal>

      <Modal
        open={frameworkOpen}
        onOpenChange={setFrameworkOpen}
        kicker="LICENCE / FRAMEWORK KEY"
        title="更新框架公钥"
        description="用于替换平台与授权框架之间的解密公钥。公钥由授权方提供，错误配置可能导致授权校验失败。"
        width={560}
        footer={
          <>
            <Button size="sm" onClick={() => setFrameworkOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!frameworkKey.trim()}
              loading={updateFrameworkMutation.isPending}
              onClick={() => updateFrameworkMutation.mutate()}
            >
              保存公钥
            </Button>
          </>
        }
      >
        <Field label="框架公钥" required hint="粘贴完整的公钥内容，保存后将立即生效。">
          <textarea
            className="field min-h-[180px] font-mono text-[10.5px] leading-relaxed"
            value={frameworkKey}
            onChange={(event) => setFrameworkKey(event.target.value)}
            placeholder="-----BEGIN PUBLIC KEY-----"
          />
        </Field>
      </Modal>

      <Modal
        open={langOpen}
        onOpenChange={setLangOpen}
        kicker="LICENCE / LANGUAGE PACKS"
        title="语言包管理"
        description="导入、启用或删除平台语言包版本。当前界面语言仍以平台默认中文展示。"
        width={860}
        footer={
          <Button size="sm" onClick={() => setLangOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-paper-2/40 px-3 py-2">
            <div>
              <div className="label">当前语言</div>
              <div className="mono mt-0.5 text-[11px] text-ink">
                {langQuery.data?.language || 'zh_CN'} / {langQuery.data?.version || 'default'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={langFileRef}
                type="file"
                accept=".zip,.json"
                className="hidden"
                onChange={(event) => setLangFile(event.target.files?.[0] ?? null)}
              />
              <Button size="sm" onClick={() => langFileRef.current?.click()}>
                <Upload size={11} /> {langFile ? langFile.name : '选择语言包'}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!langFile}
                loading={importLangMutation.isPending}
                onClick={() => importLangMutation.mutate()}
              >
                导入
              </Button>
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto border border-line">
            <div className="grid grid-cols-[1fr_1fr_0.7fr_1.2fr_160px] gap-2 border-b border-line bg-paper-2/60 px-3 py-2">
              {['语言', '版本', '状态', '导入时间', '操作'].map((item) => (
                <span key={item} className="label">
                  {item}
                </span>
              ))}
            </div>
            {(langVersionsQuery.data?.versionList ?? []).map((item) => (
              <div
                key={`${item.lang}-${item.langVersion}`}
                className="grid grid-cols-[1fr_1fr_0.7fr_1.2fr_160px] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0"
              >
                <span className="mono text-[10.5px] text-ink">{item.lang}</span>
                <span className="mono text-[10.5px] text-ink-3">{item.langVersion}</span>
                <Badge tone={item.used ? 'ok' : 'default'}>{item.used ? '使用中' : '未启用'}</Badge>
                <span className="mono text-[9px] text-ink-3">{formatDate(item.createTime)}</span>
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLangDetail(item)}
                  >
                    详情
                  </Button>
                  <Button
                    size="sm"
                    disabled={!!item.used}
                    loading={setLangMutation.isPending}
                    onClick={() => setLangMutation.mutate(item)}
                  >
                    启用
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={removeLangMutation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `删除语言包 ${item.lang} / ${item.langVersion}？`,
                        description: '删除后使用该语言包的客户端将回退到默认语言。',
                        confirmText: '删除',
                        danger: true,
                      })
                      if (ok) removeLangMutation.mutate(item)
                    }}
                  >
                    <Trash2 size={10} />
                  </Button>
                </div>
              </div>
            ))}
            {(langVersionsQuery.data?.versionList ?? []).length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-mute">
                {langVersionsQuery.isLoading ? '正在读取语言包…' : '暂无语言包版本'}
              </div>
            )}
          </div>

          {langDetail && (
            <div className="border border-line">
              <div className="flex items-center justify-between border-b border-line bg-paper-2/40 px-3 py-2">
                <span className="mono text-[9px] tracking-widest text-ink-3">
                  {langDetail.lang} / {langDetail.langVersion} · {langDetailQuery.data?.languageList?.length ?? 0} KEYS
                </span>
                <Button size="sm" variant="ghost" onClick={() => setLangDetail(null)}>
                  收起
                </Button>
              </div>
              <div className="max-h-[220px] overflow-y-auto">
                {(langDetailQuery.data?.languageList ?? []).slice(0, 100).map((entry, index) => (
                  <div key={`${entry.textKey}-${index}`} className="grid grid-cols-[180px_1fr] gap-2 border-b border-line/50 px-3 py-1.5 last:border-b-0">
                    <span className="mono truncate text-[9px] text-mute">{entry.textKey}</span>
                    <span className="truncate text-[10px] text-ink-3">{entry.content}</span>
                  </div>
                ))}
                {langDetailQuery.isLoading && (
                  <div className="px-3 py-6 text-center text-[11px] text-mute">正在读取语言标识…</div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={jarOpen}
        onOpenChange={setJarOpen}
        kicker="LICENCE / AUTH EXTENSION"
        title="授权扩展 Jar"
        description="上传自定义授权扩展 Jar 并维护默认解密公钥。扩展由平台在授权校验阶段动态加载。"
        width={780}
        footer={
          <Button size="sm" onClick={() => setJarOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="border border-line px-3 py-3">
            <div className="label mb-2">上传扩展 Jar</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                ref={jarFileRef}
                type="file"
                accept=".jar"
                className="hidden"
                onChange={(event) => setJarFile(event.target.files?.[0] ?? null)}
              />
              <Button size="sm" onClick={() => jarFileRef.current?.click()}>
                <Upload size={11} /> {jarFile ? jarFile.name : '选择 Jar 文件'}
              </Button>
              <input
                className="field h-8 font-mono text-[10.5px]"
                placeholder="className（可选）"
                value={jarClass}
                onChange={(event) => setJarClass(event.target.value)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={!jarFile}
                loading={uploadJarMutation.isPending}
                onClick={() => uploadJarMutation.mutate()}
              >
                上传
              </Button>
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto border border-line">
            <div className="grid grid-cols-[1.3fr_1.3fr_0.6fr_1fr] gap-2 border-b border-line bg-paper-2/60 px-3 py-2">
              {['Jar 文件', '类名', '状态', '更新时间'].map((item) => (
                <span key={item} className="label">
                  {item}
                </span>
              ))}
            </div>
            {(jarQuery.data?.list ?? []).map((item) => (
              <div
                key={item.id || item.jarName}
                className="grid grid-cols-[1.3fr_1.3fr_0.6fr_1fr] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0"
              >
                <span className="mono truncate text-[10px] text-ink">{item.jarName || item.storeJarName || '—'}</span>
                <span className="mono truncate text-[9.5px] text-mute">{item.className || '—'}</span>
                <Badge tone={item.used ? 'ok' : 'default'}>{item.used ? '启用' : '未启用'}</Badge>
                <span className="mono text-[9px] text-ink-3">{formatDate(item.updateAt ?? item.createAt)}</span>
              </div>
            ))}
            {(jarQuery.data?.list ?? []).length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-mute">
                {jarQuery.isLoading ? '正在读取授权扩展…' : '暂无授权扩展 Jar'}
              </div>
            )}
          </div>

          <div className="border border-line px-3 py-3">
            <div className="label mb-2">默认解密公钥</div>
            <textarea
              className="field min-h-[110px] font-mono text-[10px] leading-relaxed"
              placeholder="粘贴默认解密公钥"
              value={jarKey}
              onChange={(event) => setJarKey(event.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="primary"
                disabled={!jarKey.trim()}
                loading={updateJarKeyMutation.isPending}
                onClick={() => updateJarKeyMutation.mutate()}
              >
                更新公钥
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
