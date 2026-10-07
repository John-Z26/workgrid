import assert from 'node:assert/strict'
import { recurrenceDates, recurrenceLabel } from './src/recurrence.ts'

const start = new Date('2026-10-05T09:00:00+08:00')
assert.equal(recurrenceDates(start, { frequency: 'daily', until: '2026-10-07T00:00:00+08:00' }).length, 3)
assert.deepEqual(recurrenceDates(start, { frequency: 'weekdays', until: '2026-10-11T00:00:00+08:00' }).map((date) => date.getDay()), [1, 2, 3, 4, 5])
assert.deepEqual(recurrenceDates(start, { frequency: 'weekly', weekdays: [1, 3], until: '2026-10-12T00:00:00+08:00' }).map((date) => date.getDate()), [5, 7, 12])
assert.deepEqual(recurrenceDates(new Date('2026-01-31T09:00:00+08:00'), { frequency: 'monthly', until: '2026-04-30T00:00:00+08:00' }).map((date) => date.getDate()), [31, 28, 31, 30])
assert.equal(recurrenceLabel({ frequency: 'daily', until: '2026-10-07' }), '每天')
console.log('recurrence tests passed')
