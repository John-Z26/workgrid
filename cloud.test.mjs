import assert from 'node:assert/strict'
import { cloudDataMatches, parseCloudSnapshot, shouldApplyCloudSnapshot, taskFingerprint } from './src/cloudData.ts'

const task = {
  id: 'cloud-task',
  title: '云同步测试',
  color: 'green',
  duration: 45,
  start: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  status: 'todo',
  completedAt: null,
  reminderMinutes: null,
  remindedAt: null,
  endReminder: false,
  endRemindedAt: null,
}

const snapshot = parseCloudSnapshot({ tasks: [task], revision: 3, updated_at: '2026-10-05T01:00:00.000Z' })
assert.equal(snapshot.tasks.length, 1)
assert.equal(snapshot.revision, 3)
assert.equal(taskFingerprint(snapshot.tasks), JSON.stringify([task]))
assert.equal(cloudDataMatches(snapshot.tasks, [{ ...task }]), true)
assert.equal(cloudDataMatches(snapshot.tasks, [{ ...task, duration: 60 }]), false)
const previousCloudFingerprint = taskFingerprint(snapshot.tasks)
const localEdit = [{ ...task, duration: 60 }]
const incomingEdit = [{ ...task, duration: 90 }]
assert.equal(shouldApplyCloudSnapshot(snapshot.tasks, previousCloudFingerprint, incomingEdit), true)
assert.equal(shouldApplyCloudSnapshot(localEdit, previousCloudFingerprint, incomingEdit), false)
assert.equal(shouldApplyCloudSnapshot(localEdit, previousCloudFingerprint, localEdit), true)
assert.throws(() => parseCloudSnapshot({ tasks: [{ ...task, duration: 0 }], revision: 1, updated_at: '2026-10-05T01:00:00.000Z' }))
assert.throws(() => parseCloudSnapshot({ tasks: [task, task], revision: 1, updated_at: '2026-10-05T01:00:00.000Z' }))
assert.throws(() => parseCloudSnapshot({ tasks: [], revision: 0, updated_at: '2026-10-05T01:00:00.000Z' }))

console.log('cloud sync tests passed')
