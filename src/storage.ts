import { addDays, setHours, startOfDay } from 'date-fns'
import type { Task } from './types'

const STORAGE_KEY = 'workgrid.tasks.v2'
const RECOVERY_KEY = 'workgrid.import-recovery.v1'

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function initialTasks(): Task[] {
  const today = startOfDay(new Date())
  return [
    {
      id: makeId(),
      title: '整理本周工作重点',
      color: 'blue',
      duration: 60,
      start: null,
      createdAt: new Date().toISOString(),
      status: 'todo',
      completedAt: null,
      reminderMinutes: null,
      remindedAt: null,
      endReminder: false,
      endRemindedAt: null,
      tags: [],
    },
    {
      id: makeId(),
      title: '回复客户邮件',
      color: 'orange',
      duration: 30,
      start: null,
      createdAt: new Date().toISOString(),
      status: 'todo',
      completedAt: null,
      reminderMinutes: null,
      remindedAt: null,
      endReminder: false,
      endRemindedAt: null,
      tags: [],
    },
    {
      id: makeId(),
      title: '产品周会',
      color: 'indigo',
      duration: 60,
      start: setHours(today, 10).toISOString(),
      createdAt: new Date().toISOString(),
      status: 'todo',
      completedAt: null,
      reminderMinutes: 10,
      remindedAt: null,
      endReminder: true,
      endRemindedAt: null,
      tags: [],
    },
    {
      id: makeId(),
      title: '专注工作',
      color: 'yellow',
      duration: 120,
      start: setHours(addDays(today, 1), 14).toISOString(),
      createdAt: new Date().toISOString(),
      status: 'todo',
      completedAt: null,
      reminderMinutes: null,
      remindedAt: null,
      endReminder: false,
      endRemindedAt: null,
      tags: [],
    },
  ]
}

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialTasks()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(migrateTask) : initialTasks()
  } catch {
    return initialTasks()
  }
}

export function saveTasks(tasks: Task[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

function migrateTask(value: Partial<Task> & Pick<Task, 'id' | 'title' | 'color' | 'duration' | 'start' | 'createdAt'>): Task {
  return {
    ...value,
    status: value.status ?? 'todo',
    completedAt: value.completedAt ?? null,
    reminderMinutes: value.reminderMinutes ?? null,
    remindedAt: value.remindedAt ?? null,
    endReminder: value.endReminder ?? (value.reminderMinutes != null),
    endRemindedAt: value.endRemindedAt ?? null,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 8) : [],
  }
}

export function saveImportRecovery(tasks: Task[]) {
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(tasks))
}

export function loadImportRecovery(): Task[] | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(migrateTask) : null
  } catch {
    return null
  }
}

export function clearImportRecovery() {
  localStorage.removeItem(RECOVERY_KEY)
}

export { makeId }
