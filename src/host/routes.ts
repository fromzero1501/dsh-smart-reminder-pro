/**
 * Web API 路由注册（供 Client 侧日历视图与数据交互调用）。
 * 增加：环境依赖检测（自动检测宿主是否已装配 dsh-message-gateway 及其支持的渠道）。
 * @module dsh-smart-reminder/host/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ReminderStore } from './store.ts'
import type { HolidaySync } from './holiday-sync.ts'
import { sendSystemNotification } from './notifier.ts'
import { generateIcalString } from '../core/ical.ts'

export function registerReminderRoutes(ctx: Context, store: ReminderStore, holidaySync?: HolidaySync): () => void {
  const server = (ctx as any).webServer
  if (!server) return () => {}

  // 1. 获取环境能力状态（是否已安装并连接消息网关）
  const d0 = server.register({
    kind: 'exact',
    path: '/api/reminders/gateway-status',
    handler: async (_req: any, res: any) => {
      let hasGateway = false
      let platforms: string[] = []

      try {
        const tools = (ctx as any).tools
        if (tools && typeof tools.get === 'function') {
          const sendTool = tools.get('send_chat_message')
          if (sendTool) {
            hasGateway = true
            platforms = ['wecom-aibot', 'telegram', 'discord', 'email']
          }
        }
      } catch {}

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, hasGateway, platforms }))
    },
  })

  // 2. 获取所有提醒事项
  const d1 = server.register({
    kind: 'exact',
    path: '/api/reminders/list',
    handler: async (_req: any, res: any) => {
      const items = store.getAll()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, items }))
    },
  })

  // 3. 创建或更新提醒事项
  const d2 = server.register({
    kind: 'exact',
    path: '/api/reminders/save',
    handler: async (req: any, res: any) => {
      try {
        let bodyStr = ''
        req.on('data', (c: Buffer) => { bodyStr += c.toString('utf-8') })
        req.on('end', () => {
          try {
            const body = JSON.parse(bodyStr || '{}')
            if (!body.title || !body.dueAt) {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'title and dueAt are required' }))
              return
            }

            let saved
            if (body.id) {
              saved = store.update(body.id, body)
            } else {
              saved = store.add(body)
            }
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true, item: saved }))
          } catch (e: any) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      } catch (e: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(e) }))
      }
    },
  })

  // 4. 切换事项打勾完成状态 (Toggle Complete)
  const d3 = server.register({
    kind: 'exact',
    path: '/api/reminders/toggle-complete',
    handler: async (req: any, res: any) => {
      try {
        let bodyStr = ''
        req.on('data', (c: Buffer) => { bodyStr += c.toString('utf-8') })
        req.on('end', () => {
          const body = JSON.parse(bodyStr || '{}')
          if (!body.id) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'id is required' }))
            return
          }
          const item = store.toggleComplete(body.id)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: !!item, item }))
        })
      } catch (e: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(e) }))
      }
    },
  })

  // 5. 一键推迟 (Snooze)
  const d4 = server.register({
    kind: 'exact',
    path: '/api/reminders/snooze',
    handler: async (req: any, res: any) => {
      try {
        let bodyStr = ''
        req.on('data', (c: Buffer) => { bodyStr += c.toString('utf-8') })
        req.on('end', () => {
          const body = JSON.parse(bodyStr || '{}')
          if (!body.id) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'id is required' }))
            return
          }
          const minutes = Number(body.minutes || 15)
          const item = store.snooze(body.id, minutes)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: !!item, item }))
        })
      } catch (e: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(e) }))
      }
    },
  })

  // 6. 删除提醒事项
  const d5 = server.register({
    kind: 'exact',
    path: '/api/reminders/delete',
    handler: async (req: any, res: any) => {
      try {
        let bodyStr = ''
        req.on('data', (c: Buffer) => { bodyStr += c.toString('utf-8') })
        req.on('end', () => {
          try {
            const body = JSON.parse(bodyStr || '{}')
            if (!body.id) {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'id is required' }))
              return
            }
            const success = store.delete(body.id)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true, deleted: success }))
          } catch (e: any) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      } catch (e: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(e) }))
      }
    },
  })

  // 7. 导出标准 .ics 日历文件
  const d6 = server.register({
    kind: 'exact',
    path: '/api/reminders/export.ics',
    handler: async (_req: any, res: any) => {
      const items = store.getAll()
      const ics = generateIcalString(items)
      res.writeHead(200, {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="dsh-reminders.ics"',
      })
      res.end(ics)
    },
  })

  // 8. 测试系统弹窗通知
  const d7 = server.register({
    kind: 'exact',
    path: '/api/reminders/test-notify',
    handler: async (_req: any, res: any) => {
      const ok = await sendSystemNotification({
        title: '⏰ DSH 智能提醒',
        message: '📌 事项： 开研发周会',
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok, message: ok ? '系统通知已发送' : '通知发送失败' }))
    },
  })

  // 9. 法定节假日 / 调休数据（休 / 班）
  const d8 = server.register({
    kind: 'exact',
    path: '/api/reminders/holiday-data',
    handler: async (req: any, res: any) => {
      try {
        const now = new Date()
        const fallback = [now.getFullYear(), now.getFullYear() + 1]
        let years = fallback
        try {
          const url = new URL(String(req.url || ''), 'http://127.0.0.1')
          const raw = url.searchParams.get('years')
          if (raw) {
            const parsed = raw
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((y) => Number.isFinite(y) && y > 1900 && y < 2200)
            if (parsed.length > 0) years = [...new Set(parsed)]
          }
        } catch {}

        if (holidaySync) {
          holidaySync.ensureFresh(years)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(
            JSON.stringify({
              ok: true,
              marks: holidaySync.marksFor(years),
              info: holidaySync.info(),
            }),
          )
          return
        }

        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, marks: {}, info: { lastAttemptAt: 0, years: [] } }))
      } catch (e: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(e) }))
      }
    },
  })

  return () => {
    d0()
    d1()
    d2()
    d3()
    d4()
    d5()
    d6()
    d7()
    d8()
  }
}
