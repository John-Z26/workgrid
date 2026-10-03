import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import {
  BackupError,
  MAX_BACKUP_BYTES,
  backupFileName,
  backupStats,
  createBackup,
  downloadBackup,
  parseBackupText,
  planImport,
  type ImportPlan,
} from '../backup'
import type { Task } from '../types'

type DialogMode = 'export' | 'import' | null
type ImportMode = 'merge' | 'replace'

interface DataManagementProps {
  tasks: Task[]
  canUndoImport: boolean
  onImport: (nextTasks: Task[], message: string) => boolean
  onUndoImport: () => void
  onNotify: (message: string) => void
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function formatDate(value: string | null) {
  if (!value) return '无已安排日程'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

export default function DataManagement({
  tasks,
  canUndoImport,
  onImport,
  onUndoImport,
  onNotify,
}: DataManagementProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const stats = backupStats(tasks)

  function closeDialog() {
    setDialog(null)
    setImportPlan(null)
    setError(null)
    setFileName('')
    setImportMode('merge')
    setConfirmReplace(false)
    setReading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function openDialog(mode: Exclude<DialogMode, null>) {
    setMenuOpen(false)
    setDialog(mode)
    setError(null)
    setConfirmReplace(false)
  }

  function handleExport() {
    const backup = createBackup(tasks)
    downloadBackup(backup)
    closeDialog()
    onNotify(`已导出 ${tasks.length} 个工作方块`)
  }

  async function handleFile(file: File | undefined) {
    setError(null)
    setImportPlan(null)
    setConfirmReplace(false)
    if (!file) return
    setFileName(file.name)

    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('请选择 WorkGrid 导出的 .json 备份文件')
      return
    }
    if (file.size > MAX_BACKUP_BYTES) {
      setError('备份文件超过 5MB，暂时无法导入')
      return
    }

    setReading(true)
    try {
      const backup = parseBackupText(await file.text())
      setImportPlan(planImport(tasks, backup))
    } catch (caught) {
      setError(caught instanceof BackupError ? caught.message : '读取备份时发生错误，未修改现有日程')
    } finally {
      setReading(false)
    }
  }

  function applyImport() {
    if (!importPlan) return
    if (importMode === 'replace' && !confirmReplace) {
      setConfirmReplace(true)
      return
    }

    const nextTasks = importMode === 'merge' ? importPlan.mergedTasks : importPlan.backup.tasks
    const message = importMode === 'merge'
      ? `已导入 ${importPlan.added} 个工作方块，跳过 ${importPlan.duplicates} 个重复项`
      : `已恢复 ${importPlan.backup.taskCount} 个工作方块`

    if (onImport(nextTasks, message)) closeDialog()
  }

  return (
    <div className="data-management">
      <button
        className={`icon-button${menuOpen ? ' is-active' : ''}`}
        type="button"
        aria-label="数据管理"
        aria-expanded={menuOpen}
        title="数据管理"
        onClick={() => setMenuOpen((current) => !current)}
      >
        <Database size={18} aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="data-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => openDialog('export')}>
            <Download size={16} aria-hidden="true" />
            <span><strong>导出备份</strong><small>保存到本机文件</small></span>
          </button>
          <button type="button" role="menuitem" onClick={() => openDialog('import')}>
            <Upload size={16} aria-hidden="true" />
            <span><strong>导入恢复</strong><small>从备份文件恢复</small></span>
          </button>
          {canUndoImport && (
            <>
              <div className="menu-divider" />
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onUndoImport() }}>
                <RotateCcw size={16} aria-hidden="true" />
                <span><strong>撤销上次导入</strong><small>恢复导入前的数据</small></span>
              </button>
            </>
          )}
        </div>
      )}

      {dialog === 'export' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeDialog}>
          <section className="data-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-heading">
              <div className="dialog-title"><span className="dialog-icon"><Download size={18} /></span><div><h2 id="export-title">导出备份</h2><p>把当前数据保存为本地文件</p></div></div>
              <button className="icon-button" type="button" aria-label="关闭" title="关闭" onClick={closeDialog}><X size={18} /></button>
            </div>

            <div className="backup-summary">
              <div><span>工作方块</span><strong>{stats.total} 个</strong></div>
              <div><span>已安排</span><strong>{stats.scheduled} 个</strong></div>
              <div><span>待安排</span><strong>{stats.unscheduled} 个</strong></div>
              <div><span>日程范围</span><strong>{stats.firstStart ? `${formatDate(stats.firstStart)} - ${formatDate(stats.lastStart)}` : '暂无'}</strong></div>
            </div>

            <div className="file-preview"><FileJson size={19} /><span><strong>{backupFileName()}</strong><small>JSON 备份文件</small></span></div>
            <p className="privacy-note">备份只会下载到你的设备，不会上传到服务器。文件包含工作内容，请妥善保管。</p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeDialog}>取消</button>
              <button className="primary-button" type="button" onClick={handleExport}><Download size={16} />下载备份</button>
            </div>
          </section>
        </div>
      )}

      {dialog === 'import' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeDialog}>
          <section className="data-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-heading">
              <div className="dialog-title"><span className="dialog-icon"><Upload size={18} /></span><div><h2 id="import-title">导入恢复</h2><p>从 WorkGrid 备份恢复工作方块</p></div></div>
              <button className="icon-button" type="button" aria-label="关闭" title="关闭" onClick={closeDialog}><X size={18} /></button>
            </div>

            {!importPlan && (
              <div className="file-picker">
                <input
                  ref={inputRef}
                  id="backup-file"
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => handleFile(event.target.files?.[0])}
                />
                <FileJson size={24} aria-hidden="true" />
                <div><strong>{fileName || '选择备份文件'}</strong><span>仅支持 WorkGrid 导出的 JSON 文件，最大 5MB</span></div>
                <label className="secondary-button" htmlFor="backup-file">选择文件</label>
              </div>
            )}

            {reading && <div className="reading-state">正在检查备份文件...</div>}
            {error && <div className="error-message" role="alert"><AlertTriangle size={17} />{error}</div>}

            {importPlan && !confirmReplace && (
              <>
                <div className="validation-success"><CheckCircle2 size={17} /><span>文件检查通过</span><small>{fileName}</small></div>
                <div className="backup-summary import-summary">
                  <div><span>备份时间</span><strong>{formatDateTime(importPlan.backup.exportedAt)}</strong></div>
                  <div><span>工作方块</span><strong>{importPlan.incomingStats.total} 个</strong></div>
                  <div><span>待安排 / 已安排</span><strong>{importPlan.incomingStats.unscheduled} / {importPlan.incomingStats.scheduled}</strong></div>
                  <div><span>日程范围</span><strong>{importPlan.incomingStats.firstStart ? `${formatDate(importPlan.incomingStats.firstStart)} - ${formatDate(importPlan.incomingStats.lastStart)}` : '暂无'}</strong></div>
                  <div><span>可新增 / 重复</span><strong>{importPlan.added} / {importPlan.duplicates}</strong></div>
                  <div><span>编号冲突</span><strong>{importPlan.conflicts} 个</strong></div>
                </div>

                <fieldset className="import-options">
                  <legend>导入方式</legend>
                  <label className={importMode === 'merge' ? 'is-selected' : ''}>
                    <input type="radio" name="import-mode" value="merge" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />
                    <span><strong>合并到当前数据</strong><small>保留现有工作，只加入备份中的新内容，推荐</small></span>
                  </label>
                  <label className={importMode === 'replace' ? 'is-selected' : ''}>
                    <input type="radio" name="import-mode" value="replace" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                    <span><strong>覆盖当前全部数据</strong><small>用备份中的 {importPlan.backup.taskCount} 个方块替换当前 {tasks.length} 个</small></span>
                  </label>
                </fieldset>
              </>
            )}

            {confirmReplace && importPlan && (
              <div className="replace-confirmation">
                <span className="warning-icon"><AlertTriangle size={22} /></span>
                <h3>确认覆盖当前数据？</h3>
                <p>当前浏览器中的 {tasks.length} 个工作方块将被替换为备份中的 {importPlan.backup.taskCount} 个。</p>
                <p>WorkGrid 会先创建恢复点，完成后可通过“撤销上次导入”找回当前数据。</p>
              </div>
            )}

            <div className="dialog-actions">
              {importPlan && !confirmReplace && <button className="text-button" type="button" onClick={() => { setImportPlan(null); setFileName(''); setError(null); if (inputRef.current) inputRef.current.value = '' }}>重新选择</button>}
              {confirmReplace && <button className="secondary-button" type="button" onClick={() => setConfirmReplace(false)}>返回</button>}
              <button className="secondary-button" type="button" onClick={closeDialog}>取消</button>
              {importPlan && (
                <button
                  className={confirmReplace ? 'danger-primary-button' : 'primary-button'}
                  type="button"
                  disabled={importMode === 'merge' && importPlan.added === 0}
                  onClick={applyImport}
                >
                  {confirmReplace ? '确认覆盖' : importMode === 'merge' ? `导入 ${importPlan.added} 个` : '继续覆盖'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
