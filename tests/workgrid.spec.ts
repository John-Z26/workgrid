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

async function seedCloudSession(page: Page) {
  const user = { id: '00000000-0000-4000-8000-000000000006', email: 'tester@example.com', aud: 'authenticated', role: 'authenticated' }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: user.role, exp: 4102444800 })).toString('base64url')
  await page.addInitScript(({ session }) => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), {
    session: {
      access_token: `${header}.${payload}.signature`,
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
      expires_at: 4102444800,
      token_type: 'bearer',
      user,
    },
  })
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

async function expectPreviewAlignedWithGuide(page: Page) {
  await expect.poll(async () => {
    const guideBox = await page.locator('.drag-time-guide').boundingBox()
    const previewBox = await page.locator('.drag-overlay').boundingBox()
    if (!guideBox || !previewBox) return Number.POSITIVE_INFINITY
    return Math.abs(previewBox.y - guideBox.y)
  }).toBeLessThanOrEqual(3)
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
    await expectPreviewAlignedWithGuide(page)
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
  for (let step = 1; step <= 8; step += 1) {
    const ratio = step / 8
    await dispatchTouch(card, 'touchmove', {
      x: startPoint.x + (target.x - startPoint.x) * ratio,
      y: startPoint.y + (target.y - startPoint.y) * ratio,
    })
  }
  snapshot = await guideSnapshot(page)
  await expectPreviewAlignedWithGuide(page)
  overlayCount = await page.locator('.drag-overlay').count()

  expectValidGuide(snapshot!)
  expect(overlayCount!).toBe(1)

  const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasPageOverflow).toBe(false)
})

test('dragging an existing calendar event keeps its preview on the snapped time guide', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop calendar event regression')
  const scheduled = new Date()
  scheduled.setHours(12, 15, 0, 0)
  await seedTasks(page, [task({ start: scheduled.toISOString(), duration: 45 })])
  await page.goto('/')

  const target = await dragTarget(page, 1, 32)
  const event = page.locator('.calendar-event', { hasText: '回归测试任务' })
  const start = await event.boundingBox()
  if (!start) throw new Error('Calendar event has no layout box')

  await page.mouse.move(start.x + start.width / 2, start.y + 12)
  await page.mouse.down()
  try {
    await page.mouse.move(target.x, target.y, { steps: 8 })
    await guideSnapshot(page)
    await expectPreviewAlignedWithGuide(page)
  } finally {
    await page.mouse.up()
  }

  const guideTime = await page.locator('.calendar-event').getAttribute('aria-label')
  await expect.poll(() => savedStartTime(page)).toBe(guideTime?.match(/，(\d{2}:\d{2}) 至/)?.[1] ?? null)
})

test('mobile tap scheduling remains available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile scheduling regression')
  await seedTasks(page, [task()])
  await page.goto('/')

  await page.locator('.task-card', { hasText: '回归测试任务' }).tap()
  await page.locator('.calendar-surface').evaluate((element) => { element.scrollTop = 38 * 22 - 120 })
  await page.locator('.day-track').nth(0).locator('.drop-slot').nth(38).tap()

  await expect.poll(() => savedStartTime(page)).toBe('09:30')
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

test('cloud login sends an email code with a link fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  await seedTasks(page, [])
  let requestedEmail = ''
  await page.route('http://127.0.0.1:54321/auth/v1/otp**', async (route) => {
    requestedEmail = route.request().postDataJSON().email
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/')

  await page.getByRole('button', { name: '云同步' }).click()
  await page.getByLabel('邮箱').fill('Tester@Example.com')
  await page.getByRole('button', { name: '发送验证码' }).click()

  await expect(page.getByText('验证码已发送')).toBeVisible()
  await expect(page.getByLabel('邮箱验证码')).toBeVisible()
  await expect(page.getByRole('button', { name: /秒后可重新发送/ })).toBeDisabled()
  expect(requestedEmail).toBe('tester@example.com')
})

test('cloud login explains when email sending is rate limited', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  await seedTasks(page, [])
  await page.route('http://127.0.0.1:54321/auth/v1/otp**', async (route) => {
    await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }) })
  })
  await page.goto('/')

  await page.getByRole('button', { name: '云同步' }).click()
  await page.getByLabel('邮箱').fill('tester@example.com')
  await page.getByRole('button', { name: '发送验证码' }).click()

  await expect(page.getByRole('alert')).toHaveText('发送请求过于频繁，请等待几分钟后再试。')
  await expect(page.getByLabel('邮箱')).toHaveValue('tester@example.com')
})

test('cloud login verifies the email code in the current browser', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  await seedTasks(page, [])
  const user = { id: '00000000-0000-4000-8000-000000000007', email: 'tester@example.com', aud: 'authenticated', role: 'authenticated' }
  let requestedToken = ''
  await page.route('http://127.0.0.1:54321/auth/v1/otp**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('http://127.0.0.1:54321/auth/v1/verify**', async (route) => {
    requestedToken = route.request().postDataJSON().token
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'verified-access-token', refresh_token: 'verified-refresh-token', expires_in: 3600, token_type: 'bearer', user }),
    })
  })
  await page.route('http://127.0.0.1:54321/rest/v1/workgrid_data**', async (route) => {
    if (route.request().method() !== 'GET') return route.abort()
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.pgrst.object+json',
      body: JSON.stringify({ tasks: [], revision: 1, updated_at: '2026-10-05T04:00:00.000Z' }),
    })
  })
  await page.goto('/')

  await page.getByRole('button', { name: '云同步' }).click()
  await page.getByLabel('邮箱').fill('tester@example.com')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByLabel('邮箱验证码').fill('12345678')
  await page.getByRole('button', { name: '验证并登录' }).click()

  await expect(page.getByText('账户与同步状态')).toBeVisible()
  await expect(page.getByText('tester@example.com')).toBeVisible()
  expect(requestedToken).toBe('12345678')
})

test('first cloud sign-in requires a choice before replacing local tasks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  const localTask = task({ id: 'local-task', title: '本机工作' })
  const cloudTask = task({ id: 'cloud-task', title: '云端工作', color: 'purple', duration: 90 })
  await seedTasks(page, [localTask])
  await seedCloudSession(page)
  await page.route('http://127.0.0.1:54321/rest/v1/workgrid_data**', async (route) => {
    if (route.request().method() !== 'GET') return route.abort()
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.pgrst.object+json',
      body: JSON.stringify({ tasks: [cloudTask], revision: 2, updated_at: '2026-10-05T02:00:00.000Z' }),
    })
  })
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: '选择首次同步数据' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('本机')
  await expect(dialog).toContainText('云端')
  await expect(page.locator('.task-card', { hasText: '本机工作' })).toBeVisible()

  await dialog.getByRole('button', { name: '使用云端数据' }).click()
  await expect(page.locator('.task-card', { hasText: '云端工作' })).toBeVisible()
  await expect(page.locator('.task-card', { hasText: '本机工作' })).toHaveCount(0)
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]')[0]?.id, STORAGE_KEY)).toBe('cloud-task')
})

test('cloud initialization can retry without losing local tasks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  const localTask = task({ id: 'offline-task', title: '离线保留工作' })
  const cloudTask = task({ id: 'retry-cloud-task', title: '重连后的云端工作' })
  await seedTasks(page, [localTask])
  await seedCloudSession(page)
  let attempts = 0
  let connectionRestored = false
  await page.route('http://127.0.0.1:54321/rest/v1/workgrid_data**', async (route) => {
    if (route.request().method() !== 'GET') return route.abort()
    attempts += 1
    if (!connectionRestored) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporarily unavailable' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.pgrst.object+json',
      body: JSON.stringify({ tasks: [cloudTask], revision: 4, updated_at: '2026-10-05T03:00:00.000Z' }),
    })
  })
  await page.goto('/')

  await page.getByRole('button', { name: '云同步' }).click()
  const accountDialog = page.getByRole('dialog', { name: '云同步' })
  await expect(accountDialog.getByText('同步失败')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.task-card', { hasText: '离线保留工作' })).toBeVisible()
  connectionRestored = true
  const choiceDialog = page.getByRole('dialog', { name: '选择首次同步数据' })
  await page.waitForFunction(() => {
    const headings = [...document.querySelectorAll('[role="dialog"] h2')]
    const buttons = [...document.querySelectorAll('button')]
    return headings.some((heading) => heading.textContent === '选择首次同步数据')
      || buttons.some((button) => button.textContent?.includes('重试连接') && !button.disabled)
  })
  if (!await choiceDialog.isVisible()) {
    await accountDialog.getByRole('button', { name: '重试连接' }).click()
  }

  await expect(choiceDialog).toBeVisible()
  expect(attempts).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.task-card', { hasText: '离线保留工作' })).toBeVisible()
})

test('concurrent cloud changes pause syncing and require an explicit version choice', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  const baseTask = task({ id: 'base-task', title: '同步前任务' })
  const remoteTask = task({ id: 'remote-task', title: '另一台设备的任务', color: 'purple' })
  await seedTasks(page, [baseTask])
  await seedCloudSession(page)
  let getCount = 0
  let patchCount = 0
  await page.route('http://127.0.0.1:54321/rest/v1/workgrid_data**', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      getCount += 1
      const snapshot = getCount === 1
        ? { tasks: [baseTask], revision: 8, updated_at: '2026-10-05T05:00:00.000Z' }
        : { tasks: [remoteTask], revision: 9, updated_at: '2026-10-05T05:01:00.000Z' }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) })
      return
    }
    if (method === 'PATCH') {
      patchCount += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return
    }
    await route.abort()
  })
  await page.goto('/')
  await expect(page.locator('.task-card', { hasText: '同步前任务' })).toBeVisible()

  await page.getByPlaceholder('输入工作内容').fill('本机新增任务')
  await page.getByRole('button', { name: '创建工作方块' }).click()

  const conflictDialog = page.getByRole('dialog', { name: '发现同步冲突' })
  await expect(conflictDialog).toBeVisible({ timeout: 10_000 })
  await expect(conflictDialog).toContainText('本机版本')
  await expect(conflictDialog).toContainText('2 个工作方块')
  await expect(conflictDialog).toContainText('云端版本')
  await expect(page.locator('.task-card', { hasText: '本机新增任务' })).toBeVisible()
  expect(patchCount).toBe(1)

  await conflictDialog.getByRole('button', { name: '保留云端版本' }).click()
  await expect(page.locator('.task-card', { hasText: '另一台设备的任务' })).toBeVisible()
  await expect(page.locator('.task-card', { hasText: '本机新增任务' })).toHaveCount(0)
})

test('a cloud conflict can be resolved by keeping and uploading the local version', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  const baseTask = task({ id: 'local-base-task', title: '原有任务' })
  const remoteTask = task({ id: 'newer-remote-task', title: '云端抢先修改' })
  await seedTasks(page, [baseTask])
  await seedCloudSession(page)
  let getCount = 0
  let patchCount = 0
  let uploadedTasks: unknown[] = []
  await page.route('http://127.0.0.1:54321/rest/v1/workgrid_data**', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      getCount += 1
      const snapshot = getCount === 1
        ? { tasks: [baseTask], revision: 11, updated_at: '2026-10-05T07:00:00.000Z' }
        : { tasks: [remoteTask], revision: 12, updated_at: '2026-10-05T07:01:00.000Z' }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) })
      return
    }
    if (method === 'PATCH') {
      patchCount += 1
      if (patchCount === 1) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
      uploadedTasks = route.request().postDataJSON().tasks
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: uploadedTasks, revision: 13, updated_at: '2026-10-05T07:02:00.000Z' }) })
      return
    }
    await route.abort()
  })
  await page.goto('/')
  await page.getByPlaceholder('输入工作内容').fill('需要保留的本机修改')
  await page.getByRole('button', { name: '创建工作方块' }).click()

  const conflictDialog = page.getByRole('dialog', { name: '发现同步冲突' })
  await expect(conflictDialog).toBeVisible({ timeout: 10_000 })
  await conflictDialog.getByRole('button', { name: '保留本机版本' }).click()

  await expect(conflictDialog).toHaveCount(0)
  await expect(page.locator('.task-card', { hasText: '需要保留的本机修改' })).toBeVisible()
  await expect(page.locator('.task-card', { hasText: '云端抢先修改' })).toHaveCount(0)
  expect(patchCount).toBe(2)
  expect(uploadedTasks).toHaveLength(2)
})

test('deleting cloud data signs out without deleting local tasks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once in the desktop project')
  const localTask = task({ id: 'kept-local-task', title: '需要保留的本机任务' })
  await seedTasks(page, [localTask])
  await seedCloudSession(page)
  let deleteCount = 0
  await page.route('http://127.0.0.1:54321/rest/v1/workgrid_data**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [localTask], revision: 3, updated_at: '2026-10-05T06:00:00.000Z' }) })
      return
    }
    if (route.request().method() === 'DELETE') {
      deleteCount += 1
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.abort()
  })
  await page.route('http://127.0.0.1:54321/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }))
  await page.goto('/')
  await expect(page.locator('.task-card', { hasText: '需要保留的本机任务' })).toBeVisible()

  await page.getByRole('button', { name: '云同步' }).click()
  const accountDialog = page.getByRole('dialog', { name: '云同步' })
  await accountDialog.getByRole('button', { name: '删除云端数据' }).click()
  const confirmDialog = page.getByRole('dialog', { name: '删除云端数据？' })
  await expect(confirmDialog).toContainText('本机日程不受影响')
  await confirmDialog.getByRole('button', { name: '确认删除' }).click()

  await expect(page.getByText('云端数据已删除，本机日程仍会保留')).toBeVisible()
  await expect(page.locator('.task-card', { hasText: '需要保留的本机任务' })).toBeVisible()
  expect(deleteCount).toBe(1)
  await page.getByRole('button', { name: '云同步' }).click()
  await expect(page.getByRole('dialog', { name: '云同步' }).getByRole('button', { name: '发送验证码' })).toBeVisible()
})
