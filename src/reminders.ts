import type { Task } from './types'

export function dueReminderTasks(tasks: Task[], now = new Date()) {
  const nowMs = now.getTime()
  return tasks.filter((task) => {
    if (!task.start || task.reminderMinutes === null || task.remindedAt || task.status === 'completed') return false
    const startMs = Date.parse(task.start)
    const reminderMs = startMs - task.reminderMinutes * 60_000
    return nowMs >= reminderMs && nowMs < startMs + Math.max(task.duration, 15) * 60_000
  })
}

export function reminderLabel(minutes: number | null) {
  if (minutes === null) return '不提醒'
  if (minutes === 0) return '开始时'
  if (minutes === 1440) return '提前 1 天'
  if (minutes >= 60) return `提前 ${minutes / 60} 小时`
  return `提前 ${minutes} 分钟`
}
