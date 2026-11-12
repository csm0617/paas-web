import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6">
      <div className="w-full max-w-[480px] border border-line bg-paper/80 p-8">
        <div className="mono text-[9px] tracking-[0.24em] text-signal">ERROR / 404</div>
        <h1 className="serif-title mt-3 text-[38px] leading-none text-ink">页面不存在</h1>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
          请求的控制台资源不存在或已被移除。请检查地址，或返回系统总览继续操作。
        </p>
        <div className="mt-6 flex gap-2">
          <button className="btn btn-primary" onClick={() => navigate('/global/system-overview')}>
            <ArrowLeft size={12} /> 返回总览
          </button>
          <button className="btn" onClick={() => navigate(-1)}>
            上一页
          </button>
        </div>
      </div>
      <div className="mono mt-6 text-[8.5px] tracking-[0.18em] text-mute">MSOP CONSOLE / BUILD 0.0.3</div>
    </div>
  )
}
