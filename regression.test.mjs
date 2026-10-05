import assert from 'node:assert/strict'
import { dropDateFromPosition, parseDurationInput } from './src/scheduling.ts'
import { dueEndReminderTasks, dueReminderTasks } from './src/reminders.ts'

assert.equal(parseDurationInput(''), null)
assert.equal(parseDurationInput('0'), null)
assert.equal(parseDurationInput('056'), 56)
assert.equal(parseDurationInput('56'), 56)
assert.equal(parseDurationInput('720'), 720)
assert.equal(parseDurationInput('721'), null)
assert.equal(parseDurationInput('1.5'), null)

const day = new Date(2026, 9, 5)
const midnightDrop = dropDateFromPosition(day, 100, 100, 22)
const morningDrop = dropDateFromPosition(day, 100 + 30 * 22, 100, 22)
const lastSlotDrop = dropDateFromPosition(day, 100 + 96 * 22 + 50, 100, 22)
assert.deepEqual([midnightDrop.getHours(), midnightDrop.getMinutes()], [0, 0])
assert.deepEqual([morningDrop.getHours(), morningDrop.getMinutes()], [7, 30])
assert.deepEqual([lastSlotDrop.getHours(), lastSlotDrop.getMinutes()], [23, 45])

const scheduledTask = {
  id: 'regression-task',
  title: '回归测试',
  color: 'blue',
  duration: 56,
  start: '2026-10-05T08:00:00.000Z',
  createdAt: '2026-10-05T07:00:00.000Z',
  status: 'todo',
  completedAt: null,
  reminderMinutes: 0,
  remindedAt: null,
  endReminder: true,
  endRemindedAt: null,
}

assert.equal(dueReminderTasks([scheduledTask], new Date('2026-10-05T08:00:00.000Z')).length, 1)
assert.equal(dueEndReminderTasks([scheduledTask], new Date('2026-10-05T08:55:59.000Z')).length, 0)
assert.equal(dueEndReminderTasks([scheduledTask], new Date('2026-10-05T08:56:00.000Z')).length, 1)
assert.equal(dueEndReminderTasks([{ ...scheduledTask, endRemindedAt: '2026-10-05T08:56:00.000Z' }], new Date('2026-10-05T08:57:00.000Z')).length, 0)

console.log('regression tests passed')
