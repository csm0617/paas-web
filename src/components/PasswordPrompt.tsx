import { useMutation } from '@tanstack/react-query'
import SparkMD5 from 'spark-md5'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { Button, Field, Modal } from '@/components/ui'

/* 平台密码校验使用固定盐值 + MD5，与旧站 /v1/pub/check/password 契约保持一致。 */
const PASSWORD_SALT = 'jgb159357'

export interface PasswordPromptProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  onCancel?: () => void
  title?: string
  description?: string
  type?: number
}

export function PasswordPrompt({
  open,
  onOpenChange,
  onSuccess,
  onCancel,
  title = '验证管理员密码',
  description = '该操作涉及敏感数据，需验证管理员密码后执行。',
  type = 1,
}: PasswordPromptProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function close() {
    onOpenChange(false)
    onCancel?.()
  }

  useEffect(() => {
    if (open) {
      setValue('')
      setError(null)
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!value.trim()) throw new Error('请输入密码')
      const hash = SparkMD5.hash(`${value}${PASSWORD_SALT}`).toUpperCase()
      const ok = await api.post<boolean>('/v1/pub/check/password', undefined, { type, password: hash })
      if (!ok) throw new Error('密码不正确')
    },
    onSuccess: () => {
      onSuccess()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      kicker="SECURITY / PASSWORD"
      title={title}
      description={description}
      width={420}
      footer={
        <>
          <Button size="sm" onClick={close}>
            取消
          </Button>
          <Button size="sm" variant="signal" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            验证并执行
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Field label="管理员密码" required>
          <input
            type="password"
            className="field h-9 font-mono text-[11px]"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') mutation.mutate()
            }}
            autoFocus
          />
        </Field>
        {error && <div className="text-[10.5px] text-signal">{error}</div>}
        <div className="mono text-[8.5px] leading-relaxed tracking-wider text-mute">
          密码经 MD5 加盐摘要后发送，不会以明文传输。
        </div>
      </div>
    </Modal>
  )
}
