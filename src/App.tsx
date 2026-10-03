import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, GripVertical, Pause, Pencil, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { addMinutes, format, isBefore, isSameDay, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { monthDays, monthLabel, moveAnchor, normalizeDropDate, taskIsVisible, taskStartsIn, viewTitle, weekDays } from './calendar'
import DataManagement from './components/DataManagement'
import { clearImportRecovery, loadImportRecovery, loadTasks, makeId, saveImportRecovery, saveTasks } from './storage'
import type { Task, TaskColor, TaskDraft, TaskStatus, ViewMode } from './types'

const COLORS: Array<{ value: TaskColor; label: string }> = [
  { value: 'red', label: '红色' }, { value: 'orange', label: '橙色' }, { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' }, { value: 'blue', label: '蓝色' }, { value: 'indigo', label: '靛色' }, { value: 'purple', label: '紫色' },
]
const VIEW_LABELS: Record<ViewMode, string> = { today: '今日', month: '月', week: '周', day: '日' }
const STATUS_LABELS: Record<TaskStatus, string> = { todo: '待办', 'in-progress': '进行中', completed: '已完成' }
const EMPTY_DRAFT: TaskDraft = { title: '', color: 'blue', duration: 60 }
const SLOT_MINUTES = 15
const SLOT_HEIGHT = 22
const WORK_START = 8
const WORK_END = 20
const SLOT_COUNT = ((WORK_END - WORK_START) * 60) / SLOT_MINUTES

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function toDateTimeLocal(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  if (!value) return null
  const date = new Date(value)
  date.setMinutes(Math.round(date.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES, 0, 0)
  return date.toISOString()
}

function TaskCard({ task, selected, dragging, onSelect, onEdit, onDragStart, onDragEnd }: {
  task: Task; selected: boolean; dragging: boolean; onSelect: () => void; onEdit: () => void
  onDragStart: (event: React.DragEvent) => void; onDragEnd: () => void
}) {
  return (
    <article className={`task-card color-${task.color}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onSelect} aria-label={`${task.title}，${durationLabel(task.duration)}`}>
      <GripVertical className="drag-handle" size={15} aria-hidden="true" />
      <div className="task-copy"><strong>{task.title}</strong><span><Clock3 size={13} />{durationLabel(task.duration)}</span></div>
      <button className="icon-button task-edit" type="button" aria-label={`编辑 ${task.title}`} title="编辑任务" onClick={(event) => { event.stopPropagation(); onEdit() }}><Pencil size={15} /></button>
    </article>
  )
}

interface LaidOutTask { task: Task; lane: number; laneCount: number; top: number; height: number }

function layoutDayTasks(tasks: Task[], preview: { id: string; duration: number } | null): LaidOutTask[] {
  const dayStart = WORK_START * 60
  const dayEnd = WORK_END * 60
  const candidates = tasks.filter((task) => task.start).map((task) => {
    const start = new Date(task.start!)
    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const duration = preview?.id === task.id ? preview.duration : task.duration
    return { task, startMinutes, endMinutes: startMinutes + duration, duration }
  }).filter((item) => item.endMinutes > dayStart && item.startMinutes < dayEnd)
    .sort((left, right) => left.startMinutes - right.startMinutes || right.duration - left.duration)

  const result: LaidOutTask[] = []
  let index = 0
  while (index < candidates.length) {
    const group = [candidates[index]]
    let groupEnd = candidates[index].endMinutes
    let next = index + 1
    while (next < candidates.length && candidates[next].startMinutes < groupEnd) {
      group.push(candidates[next]); groupEnd = Math.max(groupEnd, candidates[next].endMinutes); next += 1
    }
    const laneEnds: number[] = []
    const assignments = group.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMinutes)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = item.endMinutes
      return { item, lane }
    })
    assignments.forEach(({ item, lane }) => {
      const visibleStart = Math.max(item.startMinutes, dayStart)
      const visibleEnd = Math.min(item.endMinutes, dayEnd)
      result.push({ task: item.task, lane, laneCount: laneEnds.length, top: ((visibleStart - dayStart) / SLOT_MINUTES) * SLOT_HEIGHT, height: Math.max(SLOT_HEIGHT, ((visibleEnd - visibleStart) / SLOT_MINUTES) * SLOT_HEIGHT) })
    })
    index = next
  }
  return result
}

function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks)
  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [editingStart, setEditingStart] = useState('')
  const [editingStatus, setEditingStatus] = useState<TaskStatus>('todo')
  const [resizePreview, setResizePreview] = useState<{ id: string; duration: number } | null>(null)
  const [pendingSchedule, setPendingSchedule] = useState<{ taskId: string; slot: Date } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [canUndoImport, setCanUndoImport] = useState(() => loadImportRecovery() !== null)

  useEffect(() => saveTasks(tasks), [tasks])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 2400); return () => window.clearTimeout(timer) }, [toast])

  const unscheduled = useMemo(() => tasks.filter((task) => !task.start), [tasks])
  const visibleTasks = useMemo(() => tasks.filter((task) => taskIsVisible(task, anchor, view)), [tasks, anchor, view])
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const today = startOfDay(new Date())
  const todayTasks = tasks.filter((task) => task.start && isSameDay(new Date(task.start), today))
  const completedTodayTasks = todayTasks.filter((task) => task.status === 'completed')
  const overdueTasks = tasks.filter((task) => task.start && isBefore(new Date(task.start), today) && task.status !== 'completed')

  function notify(message: string) { setToast(message) }
  function selectView(next: ViewMode) { setView(next); if (next === 'today') setAnchor(new Date()) }

  function updateStatus(taskId: string, status: TaskStatus) {
    setTasks((current) => current.map((task) => {
      if (status === 'in-progress' && task.id !== taskId && task.status === 'in-progress') return { ...task, status: 'todo', completedAt: null }
      if (task.id !== taskId) return task
      return { ...task, status, completedAt: status === 'completed' ? new Date().toISOString() : null }
    }))
    notify(status === 'completed' ? '任务已完成' : status === 'in-progress' ? '任务已开始' : '任务已重新打开')
  }

  function createTask(event: React.FormEvent) {
    event.preventDefault(); const title = draft.title.trim(); if (!title) return
    setTasks((current) => [{ id: makeId(), title, color: draft.color, duration: draft.duration, start: null, createdAt: new Date().toISOString(), status: 'todo', completedAt: null }, ...current])
    setDraft((current) => ({ ...current, title: '' })); notify('已创建工作方块')
  }

  function scheduleTask(taskId: string, slot: Date, reopenCompleted?: boolean) {
    const normalized = normalizeDropDate(slot, view)
    const moving = tasks.find((task) => task.id === taskId)
    if (moving?.status === 'completed' && reopenCompleted === undefined) {
      setPendingSchedule({ taskId, slot: normalized })
      return
    }
    const movingEnd = moving ? addMinutes(normalized, moving.duration) : normalized
    const overlapping = tasks.some((task) => {
      if (task.id === taskId || !task.start) return false
      const start = new Date(task.start); return start < movingEnd && addMinutes(start, task.duration) > normalized
    })
    setTasks((current) => current.map((task) => task.id === taskId ? {
      ...task,
      start: normalized.toISOString(),
      status: reopenCompleted ? 'todo' : task.status,
      completedAt: reopenCompleted ? null : task.completedAt,
    } : task))
    setSelectedTaskId(null); notify(overlapping ? '已安排，与其他工作时间重叠' : '已安排到日历')
  }

  function handleDrop(event: React.DragEvent, slot: Date) {
    event.preventDefault(); const taskId = event.dataTransfer.getData('application/workgrid-task') || draggingTaskId
    if (taskId) scheduleTask(taskId, slot); setDraggingTaskId(null)
  }

  function unscheduleTask(taskId: string) {
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, start: null, status: task.status === 'in-progress' ? 'todo' : task.status } : task))
    setSelectedTaskId(null); notify('已移回待安排')
  }

  function beginEdit(task: Task) {
    setEditingTaskId(task.id); setEditingDraft({ title: task.title, color: task.color, duration: task.duration })
    setEditingStart(toDateTimeLocal(task.start)); setEditingStatus(task.status)
  }

  function saveEdit(event: React.FormEvent) {
    event.preventDefault(); if (!editingTaskId || !editingDraft.title.trim()) return
    setTasks((current) => current.map((task) => {
      if (editingStatus === 'in-progress' && task.id !== editingTaskId && task.status === 'in-progress') return { ...task, status: 'todo', completedAt: null }
      if (task.id !== editingTaskId) return task
      return { ...task, ...editingDraft, title: editingDraft.title.trim(), start: fromDateTimeLocal(editingStart), status: editingStatus, completedAt: editingStatus === 'completed' ? task.completedAt ?? new Date().toISOString() : null }
    }))
    setEditingTaskId(null); notify('修改已保存')
  }

  function deleteEditingTask() {
    if (!editingTaskId) return
    setTasks((current) => current.filter((task) => task.id !== editingTaskId)); setSelectedTaskId((current) => current === editingTaskId ? null : current); setEditingTaskId(null); notify('工作方块已删除')
  }

  function importTasks(nextTasks: Task[], message: string) {
    try { saveImportRecovery(tasks); saveTasks(nextTasks); setTasks(nextTasks); setSelectedTaskId(null); setEditingTaskId(null); setCanUndoImport(true); notify(message); return true }
    catch { notify('浏览器存储空间不足，导入未完成'); return false }
  }

  function undoLastImport() {
    const recovery = loadImportRecovery(); if (!recovery) { setCanUndoImport(false); notify('没有可恢复的导入记录'); return }
    try { saveTasks(recovery); setTasks(recovery); clearImportRecovery(); setCanUndoImport(false); setSelectedTaskId(null); notify('已撤销上次导入') }
    catch { notify('恢复失败，当前数据未改变') }
  }

  function moveToToday(taskId: string) {
    setTasks((current) => current.map((task) => {
      if (task.id !== taskId || !task.start) return task
      const old = new Date(task.start); const next = new Date(); next.setHours(old.getHours(), old.getMinutes(), 0, 0)
      return { ...task, start: next.toISOString(), status: 'todo', completedAt: null }
    })); notify('已移到今天')
  }

  function moveAllOverdue() {
    const ids = new Set(overdueTasks.map((task) => task.id))
    setTasks((current) => current.map((task) => {
      if (!ids.has(task.id) || !task.start) return task
      const old = new Date(task.start); const next = new Date(); next.setHours(old.getHours(), old.getMinutes(), 0, 0)
      return { ...task, start: next.toISOString(), status: 'todo', completedAt: null }
    })); notify(`已将 ${ids.size} 项工作移到今天`)
  }

  function startResize(event: React.PointerEvent, task: Task) {
    if (event.pointerType === 'touch') return
    event.preventDefault(); event.stopPropagation(); const startY = event.clientY; const original = task.duration
    const onMove = (moveEvent: PointerEvent) => { const slots = Math.round((moveEvent.clientY - startY) / SLOT_HEIGHT); setResizePreview({ id: task.id, duration: Math.max(15, Math.min(720, original + slots * SLOT_MINUTES)) }) }
    const onUp = (upEvent: PointerEvent) => {
      const slots = Math.round((upEvent.clientY - startY) / SLOT_HEIGHT); const duration = Math.max(15, Math.min(720, original + slots * SLOT_MINUTES))
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, duration } : item)); setResizePreview(null)
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); notify(`时长已调整为 ${durationLabel(duration)}`)
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  function dragProps(task: Task) {
    return { draggable: true, onDragStart: (event: React.DragEvent) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/workgrid-task', task.id); setDraggingTaskId(task.id) }, onDragEnd: () => setDraggingTaskId(null) }
  }

  function renderCalendarEvent(item: LaidOutTask) {
    const { task } = item; const duration = resizePreview?.id === task.id ? resizePreview.duration : task.duration
    const start = new Date(task.start!); const end = addMinutes(start, duration)
    const style = { top: item.top, height: item.height, left: `calc(${(item.lane / item.laneCount) * 100}% + 3px)`, width: `calc(${100 / item.laneCount}% - 6px)` }
    return (
      <article key={task.id} className={`calendar-event color-${task.color} status-${task.status}${draggingTaskId === task.id ? ' is-dragging' : ''}`} style={style} aria-label={`${task.title}，${STATUS_LABELS[task.status]}，${format(start, 'HH:mm')} 至 ${format(end, 'HH:mm')}`} onClick={(event) => { event.stopPropagation(); beginEdit(task) }} {...dragProps(task)}>
        <div className="event-main"><strong>{task.title}</strong><span>{format(start, 'HH:mm')} - {format(end, 'HH:mm')}</span></div>
        <div className="event-actions" onClick={(event) => event.stopPropagation()}>{task.status === 'completed' ? <button type="button" aria-label="重新打开" title="重新打开" onClick={() => updateStatus(task.id, 'todo')}><RotateCcw size={13} /></button> : <><button type="button" aria-label={task.status === 'in-progress' ? '暂停' : '开始'} title={task.status === 'in-progress' ? '暂停' : '开始'} onClick={() => updateStatus(task.id, task.status === 'in-progress' ? 'todo' : 'in-progress')}>{task.status === 'in-progress' ? <Pause size={13} /> : <Play size={13} />}</button><button type="button" aria-label="完成" title="完成" onClick={() => updateStatus(task.id, 'completed')}><Check size={14} /></button></>}</div>
        <button className="resize-handle" type="button" aria-label="调整时长" title="拖动调整时长" onPointerDown={(event) => startResize(event, task)} />
      </article>
    )
  }

  function renderTimeline(days: Date[]) {
    const slots = Array.from({ length: SLOT_COUNT }, (_, index) => index)
    return (
      <div className="duration-timeline" style={{ '--day-count': days.length, '--slot-height': `${SLOT_HEIGHT}px` } as React.CSSProperties}>
        <div className="timeline-header-corner" />
        {days.map((day) => <div className={`day-heading${isSameDay(day, new Date()) ? ' is-today' : ''}`} key={`heading-${day.toISOString()}`}><span>{format(day, 'EEE', { locale: zhCN })}</span><strong>{format(day, 'd')}</strong></div>)}
        <div className="time-rail">{Array.from({ length: WORK_END - WORK_START + 1 }, (_, index) => <span key={index} style={{ top: index * SLOT_HEIGHT * 4 }}>{String(WORK_START + index).padStart(2, '0')}:00</span>)}</div>
        {days.map((day) => {
          const layout = layoutDayTasks(tasks.filter((task) => task.start && isSameDay(new Date(task.start), day)), resizePreview)
          return <div className="day-track" key={day.toISOString()}><div className="drop-slots">{slots.map((slotIndex) => { const slot = new Date(day); slot.setHours(WORK_START, slotIndex * SLOT_MINUTES, 0, 0); return <div key={slotIndex} className="drop-slot" role="button" aria-label={`${format(slot, 'M 月 d 日 HH:mm')} 时间格`} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('is-over') }} onDragLeave={(event) => event.currentTarget.classList.remove('is-over')} onDrop={(event) => { event.currentTarget.classList.remove('is-over'); handleDrop(event, slot) }} onClick={() => selectedTaskId && scheduleTask(selectedTaskId, slot)} /> })}</div><div className="event-layer">{layout.map(renderCalendarEvent)}</div></div>
        })}
      </div>
    )
  }

  function renderMonth() {
    const days = monthDays(anchor)
    return <div className="month-view"><div className="month-weekdays">{['一','二','三','四','五','六','日'].map((day) => <span key={day}>周{day}</span>)}</div><div className="month-grid">{days.map((day) => {
      const label = monthLabel(day, anchor); const dayTasks = tasks.filter((task) => taskStartsIn(task, day, 'month'))
      return <div className={`month-cell${label.isOutside ? ' is-outside' : ''}${isSameDay(day, new Date()) ? ' is-today' : ''}`} key={day.toISOString()} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('is-over') }} onDragLeave={(event) => event.currentTarget.classList.remove('is-over')} onDrop={(event) => { event.currentTarget.classList.remove('is-over'); handleDrop(event, day) }} onClick={() => selectedTaskId && scheduleTask(selectedTaskId, day)} role="button" aria-label={`${format(day, 'M 月 d 日')}，${dayTasks.length} 项工作`}><span className="month-date">{label.day}</span><div className="month-events">{dayTasks.slice(0, 3).map((task) => <button key={task.id} type="button" className={`month-event color-${task.color} status-${task.status}`} onClick={(event) => { event.stopPropagation(); beginEdit(task) }}><span>{task.status === 'completed' && <Check size={11} />}{task.title}</span><small>{format(new Date(task.start!), 'HH:mm')}</small></button>)}{dayTasks.length > 3 && <button type="button" className="more-events" onClick={(event) => { event.stopPropagation(); setAnchor(day); setView('day') }}>+{dayTasks.length - 3} 项</button>}</div></div>
    })}</div></div>
  }

  function renderToday() {
    const completedMinutes = completedTodayTasks.reduce((sum, task) => sum + task.duration, 0)
    const plannedMinutes = todayTasks.reduce((sum, task) => sum + task.duration, 0)
    return <><div className="today-stats"><div><span>已完成</span><strong>{completedTodayTasks.length} / {todayTasks.length} 项</strong></div><div><span>计划时间</span><strong>{durationLabel(plannedMinutes)}</strong></div><div><span>完成时间</span><strong>{durationLabel(completedMinutes)}</strong></div></div>{overdueTasks.length > 0 && <section className="overdue-section"><div className="overdue-heading"><div><h3>以前未完成</h3><span>{overdueTasks.length} 项需要重新安排</span></div><button className="secondary-button" type="button" onClick={moveAllOverdue}>全部移到今天</button></div><div className="overdue-list">{overdueTasks.map((task) => <div className={`overdue-item color-${task.color}`} key={task.id}><span className="overdue-dot" /><div><strong>{task.title}</strong><small>{format(new Date(task.start!), 'M 月 d 日 HH:mm')} · {durationLabel(task.duration)}</small></div><button type="button" onClick={() => moveToToday(task.id)}>移到今天</button></div>)}</div></section>}<div className="calendar-surface today-timeline">{renderTimeline([today])}</div></>
  }

  function calendarBody() {
    if (view === 'today') return renderToday()
    if (view === 'month') return <div className="calendar-surface">{renderMonth()}</div>
    if (view === 'week') return <div className="calendar-surface">{renderTimeline(weekDays(anchor))}</div>
    return <div className="calendar-surface">{renderTimeline([anchor])}</div>
  }

  function dropToBacklog(event: React.DragEvent) { event.preventDefault(); const taskId = event.dataTransfer.getData('application/workgrid-task') || draggingTaskId; if (taskId) unscheduleTask(taskId); setDraggingTaskId(null) }

  const totalMinutes = visibleTasks.reduce((sum, task) => sum + task.duration, 0)
  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark"><CalendarDays size={18} /></span><span>WorkGrid</span></div><div className="view-switcher" role="group" aria-label="日历视图">{(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => <button key={mode} type="button" className={view === mode ? 'is-active' : ''} onClick={() => selectView(mode)}>{VIEW_LABELS[mode]}</button>)}</div><div className="date-controls"><DataManagement tasks={tasks} canUndoImport={canUndoImport} onImport={importTasks} onUndoImport={undoLastImport} onNotify={notify} /><span className="toolbar-divider" />{view !== 'today' && <><button className="icon-button" type="button" aria-label="上一周期" title="上一周期" onClick={() => setAnchor((date) => moveAnchor(date, view, -1))}><ChevronLeft size={18} /></button><button className="today-button" type="button" onClick={() => setAnchor(new Date())}>今天</button><button className="icon-button" type="button" aria-label="下一周期" title="下一周期" onClick={() => setAnchor((date) => moveAnchor(date, view, 1))}><ChevronRight size={18} /></button></>}</div></header>
      <div className="workspace">
        <aside className="task-panel" onDragOver={(event) => event.preventDefault()} onDrop={dropToBacklog}><div className="panel-heading"><div><h1>待安排</h1><span>{unscheduled.length} 个方块</span></div>{selectedTask && <button className="clear-selection" type="button" onClick={() => setSelectedTaskId(null)}><X size={14} />取消选择</button>}</div><form className="task-form" onSubmit={createTask}><label className="sr-only" htmlFor="task-title">工作内容</label><div className="input-row"><input id="task-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="输入工作内容" maxLength={60} /><button className="primary-icon-button" type="submit" aria-label="创建工作方块" title="创建工作方块"><Plus size={18} /></button></div><label className="field-label" htmlFor="task-duration">预计时长</label><select id="task-duration" value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: Number(event.target.value) }))}>{[15,30,60,90,120,180].map((duration) => <option key={duration} value={duration}>{durationLabel(duration)}</option>)}</select><div className="color-field"><span className="field-label">颜色</span><div className="color-picker" role="group" aria-label="方块颜色">{COLORS.map((color) => <button key={color.value} className={`color-swatch color-${color.value}`} type="button" aria-label={color.label} aria-pressed={draft.color === color.value} title={color.label} onClick={() => setDraft((current) => ({ ...current, color: color.value }))}>{draft.color === color.value && <Check size={12} />}</button>)}</div></div></form><div className="task-list" aria-live="polite">{unscheduled.map((task) => <TaskCard key={task.id} task={task} selected={selectedTaskId === task.id} dragging={draggingTaskId === task.id} onSelect={() => setSelectedTaskId((current) => current === task.id ? null : task.id)} onEdit={() => beginEdit(task)} {...dragProps(task)} />)}{unscheduled.length === 0 && <div className="empty-state"><Check size={20} /><span>工作已全部安排</span></div>}</div></aside>
        <main className="calendar-panel"><div className="calendar-heading"><div><h2>{viewTitle(view === 'today' ? today : anchor, view)}</h2><span>{view === 'today' ? '聚焦今天的工作执行' : format(anchor, 'yyyy 年', { locale: zhCN })}</span></div>{view !== 'today' && <div className="work-total"><Clock3 size={15} />当前视图 {durationLabel(totalMinutes)}</div>}</div>{calendarBody()}</main>
      </div>
      {editingTaskId && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingTaskId(null)}><section className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><h2 id="edit-title">编辑工作方块</h2><button className="icon-button" type="button" aria-label="关闭" title="关闭" onClick={() => setEditingTaskId(null)}><X size={18} /></button></div><form onSubmit={saveEdit}><label htmlFor="edit-task-title">工作内容</label><input id="edit-task-title" autoFocus value={editingDraft.title} onChange={(event) => setEditingDraft((current) => ({ ...current, title: event.target.value }))} maxLength={60} /><label htmlFor="edit-start">开始时间</label><input id="edit-start" type="datetime-local" step="900" value={editingStart} onChange={(event) => setEditingStart(event.target.value)} /><span className="dialog-label">预计时长</span><div className="duration-stepper"><button type="button" aria-label="减少 15 分钟" onClick={() => setEditingDraft((current) => ({ ...current, duration: Math.max(15, current.duration - 15) }))}>−</button><strong>{durationLabel(editingDraft.duration)}</strong><button type="button" aria-label="增加 15 分钟" onClick={() => setEditingDraft((current) => ({ ...current, duration: Math.min(720, current.duration + 15) }))}>＋</button></div><span className="dialog-label">状态</span><div className="status-switcher" role="group" aria-label="任务状态">{(['todo','in-progress','completed'] as TaskStatus[]).map((status) => <button key={status} type="button" className={editingStatus === status ? 'is-active' : ''} onClick={() => setEditingStatus(status)}>{status === 'todo' ? <Circle size={14} /> : status === 'in-progress' ? <Play size={14} /> : <CheckCircle2 size={14} />}{STATUS_LABELS[status]}</button>)}</div><span className="dialog-label">颜色</span><div className="color-picker" role="group" aria-label="方块颜色">{COLORS.map((color) => <button key={color.value} className={`color-swatch color-${color.value}`} type="button" aria-label={color.label} aria-pressed={editingDraft.color === color.value} onClick={() => setEditingDraft((current) => ({ ...current, color: color.value }))}>{editingDraft.color === color.value && <Check size={12} />}</button>)}</div><div className="dialog-actions">{tasks.find((task) => task.id === editingTaskId)?.start && <button className="secondary-button" type="button" onClick={() => { unscheduleTask(editingTaskId); setEditingTaskId(null) }}><RotateCcw size={16} />移回待安排</button>}<button className="danger-button" type="button" aria-label="删除工作方块" title="删除" onClick={deleteEditingTask}><Trash2 size={17} /></button><button className="primary-button" type="submit">保存</button></div></form></section></div>}
      {pendingSchedule && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingSchedule(null)}><section className="edit-dialog reschedule-dialog" role="dialog" aria-modal="true" aria-labelledby="reschedule-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><h2 id="reschedule-title">重新安排已完成任务</h2><button className="icon-button" type="button" aria-label="关闭" onClick={() => setPendingSchedule(null)}><X size={18} /></button></div><p>这个任务已经完成。移动到新时间后，是否将它重新打开为待办？</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPendingSchedule(null)}>取消</button><button className="secondary-button" type="button" onClick={() => { scheduleTask(pendingSchedule.taskId, pendingSchedule.slot, false); setPendingSchedule(null) }}>保持完成</button><button className="primary-button" type="button" onClick={() => { scheduleTask(pendingSchedule.taskId, pendingSchedule.slot, true); setPendingSchedule(null) }}>重新打开并移动</button></div></section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

export default App
