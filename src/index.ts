/**
 * dsh-smart-reminder 宿插件入口。
 * @module dsh-smart-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import { ReminderStore } from './host/store.ts'
import { ReminderScheduler } from './host/scheduler.ts'
import { HolidaySync } from './host/holiday-sync.ts'
import { registerReminderRoutes } from './host/routes.ts'
import { registerReminderTools } from './host/tools.ts'

export const name = 'dsh-smart-reminder'
export const inject = ['webServer', 'tools']

export function apply(ctx: Context): void {
  const store = new ReminderStore()
  const scheduler = new ReminderScheduler(ctx, store)
  const holidaySync = new HolidaySync()

  ctx.effect(() => {
    // 启动定时调度器
    scheduler.start()

    // 注册 REST 路由与 Agent 工具
    const disposeRoutes = registerReminderRoutes(ctx, store, holidaySync)
    const disposeTools = registerReminderTools(ctx, store)

    // 节假日数据：启动后延迟几秒异步拉取一次（失败的兜底是内置表）
    const thisYear = new Date().getFullYear()
    const bootstrapTimer = setTimeout(() => {
      holidaySync.ensureFresh([thisYear, thisYear + 1])
    }, 4000)
    if (typeof (bootstrapTimer as any).unref === 'function') (bootstrapTimer as any).unref()

    return () => {
      clearTimeout(bootstrapTimer)
      scheduler.stop()
      disposeRoutes()
      disposeTools()
    }
  }, 'dsh-smart-reminder: scheduler, routes and tools')
}

export default { name, apply, inject }
