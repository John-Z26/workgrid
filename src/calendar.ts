import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  isSameHour,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Task, ViewMode } from './types'

export const WORK_START = 8
export const WORK_END = 20

export function weekStart(date: Date) {
  return startOfWeek(date, { weekStartsOn: 1 })
}

export function weekDays(date: Date) {
  const start = weekStart(date)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export function monthDays(date: Date) {
  const first = startOfWeek(startOfMonth(date), { weekStartsOn: 1 })
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

export function moveAnchor(date: Date, view: ViewMode, amount: number) {
  if (view === 'month') return addDays(date, amount * 28)
  if (view === 'week') return addDays(date, amount * 7)
  return addDays(date, amount)
}

export function viewTitle(date: Date, view: ViewMode) {
  if (view === 'today') return format(date, 'M 月 d 日 EEEE', { locale: zhCN })
  if (view === 'month') return format(date, 'yyyy 年 M 月', { locale: zhCN })
  if (view === 'week') {
    const days = weekDays(date)
    const first = days[0]
    const last = days[6]
    if (first.getMonth() === last.getMonth()) {
      return `${format(first, 'yyyy 年 M 月 d 日')} - ${format(last, 'd 日')}`
    }
    return `${format(first, 'yyyy 年 M 月 d 日')} - ${format(last, 'M 月 d 日')}`
  }
  return format(date, 'yyyy 年 M 月 d 日 EEEE', { locale: zhCN })
}

export function taskStartsIn(task: Task, slot: Date, view: ViewMode) {
  if (!task.start) return false
  const start = new Date(task.start)
  if (view === 'month') return isSameDay(start, slot)
  return isSameHour(start, slot) && Math.floor(start.getMinutes() / 15) === Math.floor(slot.getMinutes() / 15)
}

export function taskIsVisible(task: Task, anchor: Date, view: ViewMode) {
  if (!task.start) return false
  const start = new Date(task.start)
  if (view === 'month') return isSameMonth(start, anchor)
  if (view === 'week') {
    const first = weekStart(anchor)
    const last = addDays(first, 7)
    return start >= first && start < last
  }
  return isSameDay(start, anchor)
}

export function normalizeDropDate(date: Date, view: ViewMode) {
  if (view === 'month') {
    const result = startOfDay(date)
    result.setHours(9)
    return result
  }
  return date
}

export function monthLabel(date: Date, anchor: Date) {
  const isOutside = date < startOfMonth(anchor) || date > endOfMonth(anchor)
  return { day: format(date, 'd'), isOutside }
}
