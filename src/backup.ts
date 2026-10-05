import type { Task, TaskColor, WorkGridBackup } from './types'

export const BACKUP_FORMAT = 'workgrid-backup'
export const BACKUP_SCHEMA_VERSION = 3
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024
export const APP_VERSION = '0.5.0'

const COLORS: TaskColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple']

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export interface BackupStats {
  total: number
  scheduled: number
  unscheduled: number
  firstStart: string | null
  lastStart: string | null
}

export interface ImportPlan {
  backup: WorkGridBackup
  incomingStats: BackupStats
  added: number
  duplicates: number
  conflicts: number
  mergedTasks: Task[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function validateTask(value: unknown, index: number): Task {
  if (!isRecord(value)) throw new BackupError(`第 ${index + 1} 个工作方块格式不正确`)

  const { id, title, color, duration, start, createdAt } = value
  if (typeof id !== 'string' || id.length < 1 || id.length > 200) {
    throw new BackupError(`第 ${index + 1} 个工作方块缺少有效编号`)
  }
  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 60) {
    throw new BackupError(`第 ${index + 1} 个工作方块标题无效`)
  }
  if (typeof color !== 'string' || !COLORS.includes(color as TaskColor)) {
    throw new BackupError(`第 ${index + 1} 个工作方块颜色无效`)
  }
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 15 || duration > 720 || duration % 15 !== 0) {
    throw new BackupError(`第 ${index + 1} 个工作方块时长无效`)
  }
  if (start !== null && !isIsoDate(start)) {
    throw new BackupError(`第 ${index + 1} 个工作方块开始时间无效`)
  }
  if (!isIsoDate(createdAt)) {
    throw new BackupError(`第 ${index + 1} 个工作方块创建时间无效`)
  }

  const status = value.status ?? 'todo'
  const completedAt = value.completedAt ?? null
  const reminderMinutes = value.reminderMinutes ?? null
  const remindedAt = value.remindedAt ?? null
  if (status !== 'todo' && status !== 'in-progress' && status !== 'completed') {
    throw new BackupError(`第 ${index + 1} 个工作方块状态无效`)
  }
  if (completedAt !== null && !isIsoDate(completedAt)) {
    throw new BackupError(`第 ${index + 1} 个工作方块完成时间无效`)
  }
  if (reminderMinutes !== null && (typeof reminderMinutes !== 'number' || ![0, 5, 10, 15, 30, 60, 1440].includes(reminderMinutes))) {
    throw new BackupError(`第 ${index + 1} 个工作方块提醒时间无效`)
  }
  if (remindedAt !== null && !isIsoDate(remindedAt)) {
    throw new BackupError(`第 ${index + 1} 个工作方块提醒记录无效`)
  }

  return {
    id,
    title: title.trim(),
    color: color as TaskColor,
    duration: duration as number,
    start: start as string | null,
    createdAt,
    status,
    completedAt: completedAt as string | null,
    reminderMinutes: reminderMinutes as number | null,
    remindedAt: remindedAt as string | null,
  }
}

export function createBackup(tasks: Task[]): WorkGridBackup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    taskCount: tasks.length,
    tasks,
  }
}

export function backupStats(tasks: Task[]): BackupStats {
  const starts = tasks
    .map((task) => task.start)
    .filter((start): start is string => start !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right))

  return {
    total: tasks.length,
    scheduled: starts.length,
    unscheduled: tasks.length - starts.length,
    firstStart: starts[0] ?? null,
    lastStart: starts.at(-1) ?? null,
  }
}

export function parseBackupText(text: string): WorkGridBackup {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new BackupError('无法读取该备份，文件可能已损坏')
  }

  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    throw new BackupError('这不是有效的 WorkGrid 备份文件')
  }
  if (typeof value.schemaVersion !== 'number') {
    throw new BackupError('备份文件缺少数据版本')
  }
  if (value.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupError('该备份由更高版本生成，请先更新 WorkGrid')
  }
  if (value.schemaVersion < 1) {
    throw new BackupError('该备份版本过旧，当前版本无法读取')
  }
  if (typeof value.appVersion !== 'string' || !isIsoDate(value.exportedAt)) {
    throw new BackupError('备份文件信息不完整')
  }
  if (!Array.isArray(value.tasks) || !Number.isInteger(value.taskCount)) {
    throw new BackupError('备份文件中的工作方块列表无效')
  }
  if (value.taskCount !== value.tasks.length) {
    throw new BackupError('备份数量与实际内容不一致，文件可能不完整')
  }

  const tasks = value.tasks.map(validateTask)
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) throw new BackupError('备份中包含重复编号，未导入任何数据')
    ids.add(task.id)
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: value.appVersion,
    exportedAt: value.exportedAt,
    taskCount: tasks.length,
    tasks,
  }
}

function tasksEqual(left: Task, right: Task) {
  return left.id === right.id
    && left.title === right.title
    && left.color === right.color
    && left.duration === right.duration
    && left.start === right.start
    && left.createdAt === right.createdAt
    && left.status === right.status
    && left.completedAt === right.completedAt
    && left.reminderMinutes === right.reminderMinutes
    && left.remindedAt === right.remindedAt
}

function nextUniqueId(usedIds: Set<string>) {
  let id: string = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  while (usedIds.has(id)) {
    id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
  return id
}

export function planImport(currentTasks: Task[], backup: WorkGridBackup): ImportPlan {
  const currentById = new Map(currentTasks.map((task) => [task.id, task]))
  const usedIds = new Set(currentById.keys())
  const additions: Task[] = []
  let duplicates = 0
  let conflicts = 0

  for (const imported of backup.tasks) {
    const existing = currentById.get(imported.id)
    if (!existing) {
      additions.push(imported)
      usedIds.add(imported.id)
      continue
    }
    if (tasksEqual(existing, imported)) {
      duplicates += 1
      continue
    }
    conflicts += 1
    const newId = nextUniqueId(usedIds)
    usedIds.add(newId)
    additions.push({ ...imported, id: newId })
  }

  return {
    backup,
    incomingStats: backupStats(backup.tasks),
    added: additions.length,
    duplicates,
    conflicts,
    mergedTasks: [...additions, ...currentTasks],
  }
}

export function backupFileName(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `workgrid-backup-${year}-${month}-${day}.json`
}

export function downloadBackup(backup: WorkGridBackup) {
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = backupFileName(new Date(backup.exportedAt))
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
