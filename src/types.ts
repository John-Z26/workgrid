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

export interface Task {
  id: string
  title: string
  color: TaskColor
  duration: number
  start: string | null
  createdAt: string
  status: TaskStatus
  completedAt: string | null
}

export interface TaskDraft {
  title: string
  color: TaskColor
  duration: number
}

export interface WorkGridBackup {
  format: 'workgrid-backup'
  schemaVersion: 2
  appVersion: string
  exportedAt: string
  taskCount: number
  tasks: Task[]
}
