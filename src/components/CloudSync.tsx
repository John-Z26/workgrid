import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, Cloud, CloudOff, LogOut, Mail, RefreshCw, Upload, X } from 'lucide-react'
import { cloudClient, cloudConfigured } from '../cloudClient'
import { cloudDataMatches, parseCloudSnapshot, shouldApplyCloudSnapshot, taskFingerprint, type CloudSnapshot } from '../cloudData'
import type { Task } from '../types'

type SyncPhase = 'local' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error'

interface InitialChoice {
  cloud: CloudSnapshot | null
  localCount: number
}

interface CloudSyncProps {
  tasks: Task[]
  setTasks: Dispatch<SetStateAction<Task[]>>
  onNotify: (message: string) => void
}

function syncLabel(phase: SyncPhase) {
  if (phase === 'loading') return '正在读取云端'
  if (phase === 'syncing') return '正在同步'
  if (phase === 'synced') return '已同步'
  if (phase === 'offline') return '离线，数据已保存在本机'
  if (phase === 'error') return '同步失败'
  return '本机模式'
}

function formatSyncTime(value: string | null) {
  if (!value) return '尚未同步'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export default function CloudSync({ tasks, setTasks, onNotify }: CloudSyncProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [phase, setPhase] = useState<SyncPhase>('local')
  const [messageSent, setMessageSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [initialChoice, setInitialChoice] = useState<InitialChoice | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [syncAttempt, setSyncAttempt] = useState(0)
  const tasksRef = useRef(tasks)
  const replaceTasksRef = useRef(setTasks)
  const notifyRef = useRef(onNotify)
  const lastCloudFingerprint = useRef<string | null>(null)
  const latestUploadId = useRef(0)
  const uploadQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { replaceTasksRef.current = setTasks }, [setTasks])
  useEffect(() => { notifyRef.current = onNotify }, [onNotify])

  const upload = useCallback(async (nextTasks: Task[], notify = false) => {
    if (!cloudClient || !userId) return false
    const client = cloudClient
    if (!navigator.onLine) { setPhase('offline'); return false }
    const uploadId = latestUploadId.current + 1
    latestUploadId.current = uploadId
    setPhase('syncing'); setSyncError(null)
    const operation = uploadQueue.current.then(async () => {
      if (!navigator.onLine) {
        if (uploadId === latestUploadId.current) setPhase('offline')
        return false
      }
      const { data, error } = await client
        .from('workgrid_data')
        .upsert({ user_id: userId, tasks: nextTasks }, { onConflict: 'user_id' })
        .select('tasks, revision, updated_at')
        .single()
      if (error) {
        if (uploadId === latestUploadId.current) {
          setPhase(navigator.onLine ? 'error' : 'offline')
          setSyncError(error.message)
          if (notify) notifyRef.current('云同步失败，本机数据不受影响')
        }
        return false
      }
      const snapshot = parseCloudSnapshot(data)
      const fingerprint = taskFingerprint(snapshot.tasks)
      lastCloudFingerprint.current = fingerprint
      setLastSyncedAt(snapshot.updatedAt)
      if (uploadId === latestUploadId.current) {
        setPhase(fingerprint === taskFingerprint(tasksRef.current) ? 'synced' : 'syncing')
        if (notify) notifyRef.current('已同步到云端')
      }
      return true
    })
    uploadQueue.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [userId])

  useEffect(() => {
    if (!cloudClient) return
    let active = true
    cloudClient.auth.getSession().then(({ data }) => {
      if (!active) return
      setUserId(data.session?.user.id ?? null)
      setUserEmail(data.session?.user.email ?? null)
    })
    const { data: listener } = cloudClient.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? null)
      if (!session) {
        setReady(false); setInitialChoice(null); setPhase('local'); setLastSyncedAt(null); lastCloudFingerprint.current = null
      }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!cloudClient || !userId) return
    let active = true
    setReady(false); setInitialChoice(null); setPhase('loading'); setSyncError(null)
    cloudClient.from('workgrid_data').select('tasks, revision, updated_at').eq('user_id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) { setPhase(navigator.onLine ? 'error' : 'offline'); setSyncError(error.message); return }
        if (!data) {
          if (tasksRef.current.length > 0) setInitialChoice({ cloud: null, localCount: tasksRef.current.length })
          else upload([], false).then((ok) => { if (ok && active) setReady(true) })
          return
        }
        try {
          const snapshot = parseCloudSnapshot(data)
          setLastSyncedAt(snapshot.updatedAt)
          if (cloudDataMatches(tasksRef.current, snapshot.tasks)) {
            lastCloudFingerprint.current = taskFingerprint(snapshot.tasks)
            setReady(true); setPhase('synced')
          } else {
            setInitialChoice({ cloud: snapshot, localCount: tasksRef.current.length })
          }
        } catch (caught) {
          setPhase('error'); setSyncError(caught instanceof Error ? caught.message : '云端数据无法读取')
        }
      })
    return () => { active = false }
  }, [userId, upload, syncAttempt])

  useEffect(() => {
    if (!cloudClient || !userId || !ready) return
    const fingerprint = taskFingerprint(tasks)
    if (fingerprint === lastCloudFingerprint.current) return
    const timer = window.setTimeout(() => upload(tasks), 700)
    return () => window.clearTimeout(timer)
  }, [tasks, userId, ready, upload])

  useEffect(() => {
    if (!cloudClient || !userId || !ready) return
    const client = cloudClient
    const channel = client.channel(`workgrid:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workgrid_data', filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === 'DELETE') return
        try {
          const snapshot = parseCloudSnapshot(payload.new)
          const fingerprint = taskFingerprint(snapshot.tasks)
          if (!shouldApplyCloudSnapshot(tasksRef.current, lastCloudFingerprint.current, snapshot.tasks)) return
          lastCloudFingerprint.current = fingerprint
          setLastSyncedAt(snapshot.updatedAt)
          setPhase('synced')
          if (fingerprint !== taskFingerprint(tasksRef.current)) replaceTasksRef.current(snapshot.tasks)
        } catch { setPhase('error'); setSyncError('收到的云端数据格式不正确') }
      })
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [userId, ready])

  useEffect(() => {
    function offline() { if (userId) setPhase('offline') }
    function online() { if (!userId) return; if (ready) upload(tasksRef.current); else setSyncAttempt((current) => current + 1) }
    window.addEventListener('offline', offline); window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [userId, ready, upload])

  if (!cloudConfigured || !cloudClient) return null

  async function sendLoginLink(event: React.FormEvent) {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!normalized) return
    setSubmitting(true); setSyncError(null)
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href
    const { error } = await cloudClient!.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: redirectTo } })
    setSubmitting(false)
    if (error) { setSyncError(error.message); return }
    setMessageSent(true)
  }

  async function chooseLocal() {
    const ok = await upload(tasksRef.current, true)
    if (ok) { setInitialChoice(null); setReady(true) }
  }

  function chooseCloud() {
    if (!initialChoice?.cloud) return
    lastCloudFingerprint.current = taskFingerprint(initialChoice.cloud.tasks)
    replaceTasksRef.current(initialChoice.cloud.tasks)
    setLastSyncedAt(initialChoice.cloud.updatedAt)
    setInitialChoice(null); setReady(true); setPhase('synced')
    notifyRef.current('已载入云端日程')
  }

  async function signOut() {
    await cloudClient!.auth.signOut()
    setMenuOpen(false); notifyRef.current('已退出云同步，本机数据仍会保留')
  }

  function retrySync() {
    if (ready) upload(tasksRef.current, true)
    else setSyncAttempt((current) => current + 1)
  }

  return <div className="cloud-sync">
    <button className={`icon-button cloud-sync-button phase-${phase}${menuOpen ? ' is-active' : ''}`} type="button" aria-label="云同步" title={`云同步：${syncLabel(phase)}`} onClick={() => setMenuOpen((current) => !current)}>
      {phase === 'offline' || phase === 'error' ? <CloudOff size={18} /> : phase === 'syncing' || phase === 'loading' ? <RefreshCw className="spin" size={18} /> : <Cloud size={18} />}
      {userId && <span className="sync-indicator" aria-hidden="true" />}
    </button>

    {menuOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setMenuOpen(false)}>
      <section className="data-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon"><Cloud size={18} /></span><div><h2 id="cloud-title">云同步</h2><p>{userId ? '账户与同步状态' : '登录后在不同设备使用同一份日程'}</p></div></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
        {!userId ? <form onSubmit={sendLoginLink}>
          {messageSent ? <div className="login-sent"><span><Check size={18} /></span><strong>登录链接已发送</strong><p>请在邮件中打开链接，返回 WorkGrid 后会自动登录。</p><button className="text-button login-other-email" type="button" onClick={() => setMessageSent(false)}>使用其他邮箱</button></div> : <><label htmlFor="cloud-email">邮箱</label><div className="cloud-email-row"><Mail size={17} /><input id="cloud-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></div><p className="privacy-note">每个账户的数据相互隔离，不会公开给其他用户。</p><div className="dialog-actions"><button className="primary-button" type="submit" disabled={submitting}>{submitting ? '正在发送...' : '发送登录链接'}</button></div></>}
        </form> : <>
          <div className="account-summary"><div><span>账户</span><strong>{userEmail}</strong></div><div><span>同步状态</span><strong className={`sync-phase phase-${phase}`}>{syncLabel(phase)}</strong></div><div><span>云端内容</span><strong>{tasks.length} 个工作方块</strong></div><div><span>最近同步</span><strong>{formatSyncTime(lastSyncedAt)}</strong></div></div>
          {syncError && <div className="error-message" role="alert"><CloudOff size={17} />同步暂不可用，本机数据仍已保存。</div>}
          <div className="dialog-actions"><button className="secondary-button account-signout" type="button" onClick={signOut}><LogOut size={15} />退出</button><button className="primary-button" type="button" disabled={phase === 'syncing' || phase === 'loading'} onClick={retrySync}><RefreshCw size={15} />{ready ? '立即同步' : '重试连接'}</button></div>
        </>}
      </section>
    </div>}

    {initialChoice && <div className="modal-backdrop sync-choice-backdrop" role="presentation">
      <section className="data-dialog sync-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-choice-title">
        <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon"><Upload size={18} /></span><div><h2 id="sync-choice-title">选择首次同步数据</h2><p>确认哪一份日程作为云端数据</p></div></div></div>
        <div className="sync-choice-grid"><div><span>本机</span><strong>{initialChoice.localCount} 个工作方块</strong></div><div><span>云端</span><strong>{initialChoice.cloud ? `${initialChoice.cloud.tasks.length} 个工作方块` : '暂无数据'}</strong></div></div>
        <p className="privacy-note">上传本机数据会替换这个账户当前的云端日程。使用云端数据会替换当前浏览器中的日程，导出的备份不受影响。</p>
        <div className="dialog-actions sync-choice-actions"><button className="text-button" type="button" onClick={signOut}>保持本机模式</button>{initialChoice.cloud && <button className="secondary-button" type="button" onClick={chooseCloud}>使用云端数据</button>}<button className="primary-button" type="button" onClick={chooseLocal}><Upload size={15} />上传本机数据</button></div>
      </section>
    </div>}
  </div>
}
