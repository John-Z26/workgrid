import { addDays, addMonths, endOfMonth, isAfter, startOfDay } from 'date-fns'
import type { RecurrenceFrequency, RecurrenceRule } from './types'

export function recurrenceLabel(rule: RecurrenceRule | null | undefined) {
  if (!rule) return '不重复'
  if (rule.frequency === 'daily') return '每天'
  if (rule.frequency === 'weekdays') return '工作日'
  if (rule.frequency === 'monthly') return '每月'
  return rule.weekdays?.length ? `每周 ${rule.weekdays.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}` : '每周'
}

export function recurrenceDates(start: Date, rule: RecurrenceRule, limit = 366): Date[] {
  const dates: Date[] = []
  const until = startOfDay(new Date(rule.until))
  if (rule.frequency === 'monthly') {
    let month = new Date(start.getFullYear(), start.getMonth(), 1, start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds())
    while (dates.length < limit && !isAfter(startOfDay(month), until)) {
      const date = new Date(month)
      date.setDate(Math.min(start.getDate(), endOfMonth(month).getDate()))
      if (date >= start && !isAfter(startOfDay(date), until)) dates.push(date)
      month = addMonths(month, 1)
    }
    return dates
  }
  let cursor = new Date(start)
  while (dates.length < limit && !isAfter(startOfDay(cursor), until)) {
    const weekday = cursor.getDay()
    const matches = rule.frequency === 'daily'
      || (rule.frequency === 'weekdays' && weekday >= 1 && weekday <= 5)
      || (rule.frequency === 'weekly' && (rule.weekdays?.length ? rule.weekdays.includes(weekday) : weekday === start.getDay()))
    if (matches && cursor >= start) dates.push(new Date(cursor))
    cursor = addDays(cursor, 1)
  }
  return dates
}
