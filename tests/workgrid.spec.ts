import { expect, test, type Page } from '@playwright/test'

const STORAGE_KEY = 'workgrid.tasks.v2'

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'regression-task',
    title: '回归测试任务',
    color: 'blue',
    duration: 60,
    start: null,
    createdAt: '2026-10-05T00:00:00.000Z',
    status: 'todo',
    completedAt: null,
    reminderMinutes: null,
    remindedAt: null,
    endReminder: false,
    endRemindedAt: null,
    ...overrides,
  }
}

async function seedTasks(page: Page, tasks: unknown[]) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: STORAGE_KEY, value: tasks })
}

async function dragTarget(page: Page, dayIndex: number, slotIndex: number) {
  const surface = page.locator('.calendar-surface')
  await surface.evaluate((element, slot) => { element.scrollTop = slot * 22 - 120 }, slotIndex)
  const slot = page.locator('.day-track').nth(dayIndex).locator('.drop-slot').nth(slotIndex)
  await expect(slot).toBeAttached()
  const box = await slot.boundingBox()
  if (!box) throw new Error('Calendar target slot has no layout box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function guideSnapshot(page: Page) {
  const guide = page.locator('.drag-time-guide')
  await expect(guide).toBeVisible()
  return guide.evaluate((element) => ({
    time: (element as HTMLElement).dataset.time ?? '',
    top: Number.parseFloat((element as HTMLElement).style.top),
  }))
}

function expectValidGuide(snapshot: { time: string; top: number }) {
  expect(snapshot.time).toMatch(/^\d{2}:\d{2}$/)
  const [hours, minutes] = snapshot.time.split(':').map(Number)
  expect(snapshot.top).toBe(((hours * 60 + minutes) / 15) * 22)
}

async function savedStartTime(page: Page) {
  return page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]')
    return saved[0]?.start ? new Date(saved[0].start).toTimeString().slice(0, 5) : null
  }, STORAGE_KEY)
}

async function dispatchTouch(target: ReturnType<Page['locator']>, type: 'touchstart' | 'touchmove' | 'touchend', point: { x: number; y: number }) {
  await target.evaluate((element, { eventType, x, y }) => {
    const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: y, screenX: x, screenY: y })
    const activeTouches = eventType === 'touchend' ? [] : [touch]
    element.dispatchEvent(new TouchEvent(eventType, {
      bubbles: true,
      cancelable: true,
      touches: activeTouches,
      targetTouches: activeTouches,
      changedTouches: [touch],
    }))
  }, { eventType: type, ...point })
}

test('duration can be cleared and replaced with 56 minutes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  await seedTasks(page, [])
  await page.goto('/')

  await page.getByPlaceholder('输入工作内容').fill('自由时长任务')
  const duration = page.getByLabel('预计时长（分钟）')
  await duration.fill('')
  await expect(duration).toHaveValue('')
  await duration.fill('56')
  await page.getByRole('button', { name: '创建工作方块' }).click()

  await expect(page.locator('.task-card', { hasText: '自由时长任务' })).toContainText('56 分钟')
})

test('desktop drag shows one preview and a guide matching the final start time', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop pointer regression')
  await seedTasks(page, [task({ duration: 56 })])
  await page.goto('/')

  const card = page.locator('.task-card', { hasText: '回归测试任务' })
  const start = await card.boundingBox()
  if (!start) throw new Error('Task card has no layout box')
  const target = await dragTarget(page, 2, 42)

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  let snapshot: { time: string; top: number }
  let overlayCount: number
  let sourceOpacity: string
  try {
    await page.mouse.move(target.x, target.y, { steps: 8 })
    snapshot = await guideSnapshot(page)
    overlayCount = await page.locator('.drag-overlay').count()
    sourceOpacity = await page.locator('.task-card.is-dragging').evaluate((element) => getComputedStyle(element).opacity)
  } finally {
    await page.mouse.up()
  }

  expectValidGuide(snapshot!)
  expect(overlayCount!).toBe(1)
  expect(sourceOpacity!).toBe('0')
  const guideTime = snapshot!.time
  const guide = page.locator('.drag-time-guide')
  await expect(guide).toHaveCount(0)
  await expect(page.locator('.calendar-event')).toHaveAttribute('aria-label', new RegExp(`回归测试任务，待办，${guideTime} 至`))
  await expect.poll(() => savedStartTime(page)).toBe(guideTime)
})

test('mobile touch drag shows the guide and keeps the page within the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Real touch regression')
  await seedTasks(page, [task()])
  await page.goto('/')

  const card = page.locator('.task-card:not(.drag-overlay)', { hasText: '回归测试任务' })
  const handle = card.locator(':scope > .drag-handle')
  const start = await handle.boundingBox()
  if (!start) throw new Error('Touch handle has no layout box')
  const target = await dragTarget(page, 0, 38)
  const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 }

  let snapshot: { time: string; top: number }
  let overlayCount: number
  await dispatchTouch(card, 'touchstart', startPoint)
  try {
    for (let step = 1; step <= 8; step += 1) {
      const ratio = step / 8
      await dispatchTouch(card, 'touchmove', {
        x: startPoint.x + (target.x - startPoint.x) * ratio,
        y: startPoint.y + (target.y - startPoint.y) * ratio,
      })
    }
    snapshot = await guideSnapshot(page)
    overlayCount = await page.locator('.drag-overlay').count()
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  }

  expectValidGuide(snapshot!)
  expect(overlayCount!).toBe(1)
  await expect(page.locator('.drag-time-guide')).toHaveCount(0)

  await card.tap()
  await page.locator('.day-track').nth(0).locator('.drop-slot').nth(38).tap()
  await expect.poll(() => savedStartTime(page)).toBe('09:30')

  const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasPageOverflow).toBe(false)
})

test('views, batch controls, reminders, and legacy data migration still work', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  const todayAtTen = new Date()
  todayAtTen.setHours(10, 0, 0, 0)
  const legacyTask = task({ start: todayAtTen.toISOString() })
  delete legacyTask.reminderMinutes
  delete legacyTask.remindedAt
  delete legacyTask.endReminder
  delete legacyTask.endRemindedAt
  await seedTasks(page, [legacyTask])
  await page.goto('/')

  for (const view of ['今日', '月', '周', '日']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveClass(/is-active/)
  }
  await page.getByRole('button', { name: '周', exact: true }).click()
  await page.locator('.calendar-event', { hasText: '回归测试任务' }).click()
  await page.getByLabel('开始提醒').selectOption('5')
  await expect(page.getByLabel('结束时提醒')).toBeChecked()
  await page.getByRole('button', { name: '保存', exact: true }).click()

  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]')[0]
    return [saved?.reminderMinutes, saved?.endReminder]
  }, STORAGE_KEY)).toEqual([5, true])

  await page.getByRole('button', { name: '批量管理' }).click()
  await page.locator('.calendar-event', { hasText: '回归测试任务' }).click()
  await expect(page.getByText('已选择 1 项')).toBeVisible()
  await page.getByLabel('批量修改颜色').selectOption('green')
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]')[0]?.color, STORAGE_KEY)).toBe('green')
})
