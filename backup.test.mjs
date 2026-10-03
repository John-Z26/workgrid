import assert from 'node:assert/strict'
import {
  BackupError,
  createBackup,
  parseBackupText,
  planImport,
} from './src/backup.ts'

const task = {
  id: 'task-1',
  title: '验收任务',
  color: 'blue',
  duration: 60,
  start: null,
  createdAt: '2026-10-03T08:00:00.000Z',
}

const backup = createBackup([task])
const parsed = parseBackupText(JSON.stringify(backup))
assert.equal(parsed.taskCount, 1)
assert.deepEqual(parsed.tasks[0], { ...task, status: 'todo', completedAt: null })

const versionOneBackup = { ...backup, schemaVersion: 1 }
const migrated = parseBackupText(JSON.stringify(versionOneBackup))
assert.equal(migrated.schemaVersion, 2)
assert.equal(migrated.tasks[0].status, 'todo')
assert.equal(migrated.tasks[0].completedAt, null)

for (const value of [
  '{',
  JSON.stringify({ ...backup, format: 'other' }),
  JSON.stringify({ ...backup, schemaVersion: 99 }),
  JSON.stringify({ ...backup, taskCount: 2 }),
  JSON.stringify({ ...backup, taskCount: 2, tasks: [task, task] }),
  JSON.stringify({ ...backup, tasks: [{ ...task, color: 'invalid' }] }),
]) {
  assert.throws(() => parseBackupText(value), BackupError)
}

const duplicatePlan = planImport([task], backup)
assert.equal(duplicatePlan.added, 0)
assert.equal(duplicatePlan.duplicates, 1)

const newTask = { ...task, id: 'task-2', title: '新任务' }
const newPlan = planImport([task], createBackup([newTask]))
assert.equal(newPlan.added, 1)
assert.equal(newPlan.mergedTasks.length, 2)

const conflictPlan = planImport([task], createBackup([{ ...task, title: '同编号的另一个版本' }]))
assert.equal(conflictPlan.conflicts, 1)
assert.equal(conflictPlan.added, 1)
assert.notEqual(conflictPlan.mergedTasks[0].id, task.id)

const completedTask = { ...task, id: 'task-3', status: 'completed', completedAt: '2026-10-03T09:00:00.000Z' }
const completedRoundTrip = parseBackupText(JSON.stringify(createBackup([completedTask])))
assert.equal(completedRoundTrip.tasks[0].status, 'completed')
assert.equal(completedRoundTrip.tasks[0].completedAt, completedTask.completedAt)

console.log('backup tests passed')
