export type ViewMode = 'today' | 'month' | 'week' | 'day'

export type TaskStatus = 'todo' | 'in-progress' | 'completed'

export type TaskColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'indigo'
  | 'purple'

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  weekdays?: number[]
  until: string
}

export interface Task {
  id: string
  title: string
  color: TaskColor
  duration: number
  start: string | null
  createdAt: string
  status: TaskStatus
  completedAt: string | null
  reminderMinutes: number | null
  remindedAt: string | null
  endReminder: boolean
  endRemindedAt: string | null
  tags: string[]
  deletedAt: string | null
  seriesId?: string | null
  recurrence?: RecurrenceRule | null
}

export interface TaskDraft {
  title: string
  color: TaskColor
  duration: number
  tags: string[]
}

export interface WorkGridBackup {
  format: 'workgrid-backup'
  schemaVersion: 6
  appVersion: string
  exportedAt: string
  taskCount: number
  tasks: Task[]
}
