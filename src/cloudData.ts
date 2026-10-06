import { validateTaskList } from './backup.ts'
import type { Task } from './types.ts'

export interface CloudSnapshot {
  tasks: Task[]
  revision: number
  updatedAt: string
}

export function taskFingerprint(tasks: Task[]) {
  return JSON.stringify(tasks)
}

export function parseCloudSnapshot(value: unknown): CloudSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('云端数据格式不正确')
  }
  const row = value as Record<string, unknown>
  if (typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1) {
    throw new Error('云端数据版本无效')
  }
  if (typeof row.updated_at !== 'string' || Number.isNaN(Date.parse(row.updated_at))) {
    throw new Error('云端更新时间无效')
  }
  return {
    tasks: validateTaskList(row.tasks),
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

export function cloudDataMatches(left: Task[], right: Task[]) {
  return taskFingerprint(left) === taskFingerprint(right)
}

export type IncomingCloudAction = 'unchanged' | 'apply-cloud' | 'conflict'

export function classifyIncomingCloudSnapshot(localTasks: Task[], lastCloudFingerprint: string | null, incomingTasks: Task[]): IncomingCloudAction {
  const localFingerprint = taskFingerprint(localTasks)
  const incomingFingerprint = taskFingerprint(incomingTasks)
  if (localFingerprint === incomingFingerprint) return 'unchanged'
  if (localFingerprint === lastCloudFingerprint) return 'apply-cloud'
  return 'conflict'
}

export function shouldApplyCloudSnapshot(localTasks: Task[], lastCloudFingerprint: string | null, incomingTasks: Task[]) {
  return classifyIncomingCloudSnapshot(localTasks, lastCloudFingerprint, incomingTasks) !== 'conflict'
}

export function cloudSyncErrorMessage(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '当前设备处于离线状态'
  if (typeof error !== 'object' || error === null) return '云端服务暂时不可用'
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message.trim()
    : ''
  if (/fetch|network|timeout/i.test(message)) return '网络连接异常'
  return message ? `服务返回：${message}` : '云端服务暂时不可用'
}

export function loginErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return '登录链接发送失败，请稍后重试。'
  const details = error as { code?: unknown; message?: unknown; status?: unknown }
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : ''
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : ''
  if (details.status === 429 || code.includes('rate_limit') || message.includes('rate limit')) return '发送请求过于频繁，请等待几分钟后再试。'
  if (code.includes('invalid') || message.includes('invalid email')) return '邮箱地址无效，请检查后重试。'
  if (message.includes('fetch') || message.includes('network')) return '无法连接登录服务，请检查网络后重试。'
  return '登录链接发送失败，请稍后重试。'
}

export function otpVerificationErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return '验证码验证失败，请稍后重试。'
  const details = error as { code?: unknown; message?: unknown; status?: unknown }
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : ''
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : ''
  if (details.status === 429 || code.includes('rate_limit') || message.includes('rate limit')) return '验证请求过于频繁，请稍后再试。'
  if (code.includes('expired') || code.includes('invalid') || message.includes('expired') || message.includes('invalid')) return '验证码无效或已过期，请重新发送。'
  if (message.includes('fetch') || message.includes('network')) return '无法连接登录服务，请检查网络后重试。'
  return '验证码验证失败，请稍后重试。'
}
