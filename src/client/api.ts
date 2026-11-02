/**
 * 前端 API 封装（增加打勾完成、推迟、导出与网关状态检测功能）。
 * @module dsh-smart-reminder/client/api
 */

import type { ReminderItem } from '../core/types.ts'

export class ReminderApi {
  async getGatewayStatus(): Promise<{ ok: boolean; hasGateway: boolean; platforms: string[] }> {
    try {
      const res = await fetch('/api/reminders/gateway-status')
      return await res.json()
    } catch {
      return { ok: false, hasGateway: false, platforms: [] }
    }
  }

  async getList(): Promise<ReminderItem[]> {
    try {
      const res = await fetch('/api/reminders/list')
      const json = await res.json()
      return json.ok ? json.items : []
    } catch {
      return []
    }
  }

  async save(item: Partial<ReminderItem>): Promise<ReminderItem | null> {
    try {
      const res = await fetch('/api/reminders/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
      })
      const json = await res.json()
      return json.ok ? json.item : null
    } catch {
      return null
    }
  }

  async toggleComplete(id: string): Promise<ReminderItem | null> {
    try {
      const res = await fetch('/api/reminders/toggle-complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = await res.json()
      return json.ok ? json.item : null
    } catch {
      return null
    }
  }

  async snooze(id: string, minutes: number): Promise<ReminderItem | null> {
    try {
      const res = await fetch('/api/reminders/snooze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, minutes }),
      })
      const json = await res.json()
      return json.ok ? json.item : null
    } catch {
      return null
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const res = await fetch('/api/reminders/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = await res.json()
      return json.ok && json.deleted
    } catch {
      return false
    }
  }

  async testNotify(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch('/api/reminders/test-notify')
      return await res.json()
    } catch {
      return { ok: false, message: '请求失败' }
    }
  }

  /** 法定节假日 / 调休数据（休 / 班）。失败时返回空表，由内置兜底表接管 */
  async getHolidayData(years: number[]): Promise<{
    ok: boolean
    marks: Record<string, 'rest' | 'work'>
    info: { lastAttemptAt: number; years: Array<{ year: number; published: boolean; fetchedAt: number; source: string }> }
  }> {
    const empty = { ok: false, marks: {}, info: { lastAttemptAt: 0, years: [] } }
    try {
      const res = await fetch(`/api/reminders/holiday-data?years=${years.join(',')}`)
      const json = await res.json()
      if (!json || !json.ok) return empty
      return { ok: true, marks: json.marks || {}, info: json.info || empty.info }
    } catch {
      return empty
    }
  }
}
