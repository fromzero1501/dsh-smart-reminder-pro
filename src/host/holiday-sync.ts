/**
 * 法定节假日与调休（休 / 班）数据同步，宿主侧实现。
 *
 * 数据来源：NateScarlet/holiday-cn 的年度 JSON（社区按国务院办公厅通知维护，一年更新一次）。
 * 国内直连实测（2026-11）：fastly.jsdelivr.net 与 gcore.jsdelivr.net 可用，
 * cdn.jsdelivr.net 与 raw.githubusercontent.com 直连被重置，故镜像按可用性排序回退。
 *
 * 设计边界：
 * - 只读公开静态文件，纯 GET，不带任何参数或标识。
 * - 每天最多尝试一次（成功或失败都记时间戳），不做常驻定时器。
 * - 结构不合 / 年份不符 → 整批丢弃；空 days 视为「该年安排尚未公布」，不覆盖已有有效数据。
 * - 只提供「某天是休还是班」的查询，不影响任何提醒与调度逻辑。
 * @module dsh-smart-reminder/host/holiday-sync
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type StatutoryMark = 'rest' | 'work'

export interface HolidayDay {
  date: string
  name: string
  isOffDay: boolean
}

export interface HolidayYearEntry {
  year: number
  days: HolidayDay[]
  papers: string[]
  fetchedAt: number
  source: string
}

interface HolidayCacheShape {
  version: 1
  lastAttemptAt: number
  years: Record<string, HolidayYearEntry>
}

export interface HolidaySyncInfo {
  lastAttemptAt: number
  years: Array<{ year: number; published: boolean; fetchedAt: number; source: string }>
}

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 9000
const REPO = 'NateScarlet/holiday-cn'

const DEFAULT_CACHE_FILE = join(
  process.env.DSH_HOME || join(homedir(), '.dsh'),
  'smart-reminder-holidays.json',
)

/** 镜像按国内可达性排序；全部失败则视为本次拉取失败 */
const MIRRORS: Array<(year: number) => string> = [
  (y) => `https://fastly.jsdelivr.net/gh/${REPO}@master/${y}.json`,
  (y) => `https://gcore.jsdelivr.net/gh/${REPO}@master/${y}.json`,
  (y) => `https://ghproxy.net/https://raw.githubusercontent.com/${REPO}/master/${y}.json`,
  (y) => `https://raw.githubusercontent.com/${REPO}/master/${y}.json`,
]

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 日期必须是真实存在的日历日期（挡住 2026-13-01、2026-02-30 这类脏值） */
function isRealDate(text: string): boolean {
  const m = DATE_RE.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

function isValidDay(v: any): v is HolidayDay {
  return !!v && typeof v.date === 'string' && isRealDate(v.date) && typeof v.name === 'string' && typeof v.isOffDay === 'boolean'
}

/** 校验并抽取年度数据；结构不合或年份不符返回 null（空 days 合法，代表尚未公布） */
export function parseYearPayload(raw: any, expectedYear: number): { days: HolidayDay[]; papers: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  if (Number(raw.year) !== expectedYear) return null
  if (!Array.isArray(raw.days)) return null
  for (const d of raw.days) {
    if (!isValidDay(d)) return null
    if (Number(d.date.slice(0, 4)) !== expectedYear) return null
  }
  const papers = Array.isArray(raw.papers) ? raw.papers.filter((p: any) => typeof p === 'string') : []
  return { days: raw.days.slice() as HolidayDay[], papers }
}

function dateKeyOf(date: string): string {
  return date
}

async function fetchYear(year: number): Promise<HolidayYearEntry | null> {
  const fetchFn = (globalThis as any).fetch
  if (typeof fetchFn !== 'function') return null

  for (const mirror of MIRRORS) {
    const url = mirror(year)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'dsh-smart-reminder (holiday sync)' },
      })
      if (!res || !res.ok) continue
      const json = await res.json()
      const parsed = parseYearPayload(json, year)
      if (!parsed) continue
      return { year, days: parsed.days, papers: parsed.papers, fetchedAt: Date.now(), source: url }
    } catch {
      // 该镜像不可用，继续下一个
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

export class HolidaySync {
  private filePath: string
  private cache: HolidayCacheShape = { version: 1, lastAttemptAt: 0, years: {} }
  private running: Promise<void> | null = null

  constructor(customPath?: string) {
    this.filePath = customPath || DEFAULT_CACHE_FILE
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (!raw || typeof raw !== 'object') return
      const years: Record<string, HolidayYearEntry> = {}
      for (const key of Object.keys(raw.years || {})) {
        const entry = raw.years[key]
        if (!entry || !Array.isArray(entry.days)) continue
        if (!entry.days.every(isValidDay)) continue
        const year = Number(entry.year || key)
        if (!Number.isFinite(year)) continue
        years[String(year)] = {
          year,
          days: entry.days,
          papers: Array.isArray(entry.papers) ? entry.papers.filter((p: any) => typeof p === 'string') : [],
          fetchedAt: Number(entry.fetchedAt) || 0,
          source: typeof entry.source === 'string' ? entry.source : 'cache',
        }
      }
      this.cache = {
        version: 1,
        lastAttemptAt: Number(raw.lastAttemptAt) || 0,
        years,
      }
    } catch (e) {
      console.warn('[dsh-smart-reminder] holiday cache load error', e)
      this.cache = { version: 1, lastAttemptAt: 0, years: {} }
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
    } catch (e) {
      console.error('[dsh-smart-reminder] holiday cache save error', e)
    }
  }

  /** 指定年份里各天的休 / 班标记 */
  marksFor(years: number[]): Record<string, StatutoryMark> {
    const marks: Record<string, StatutoryMark> = {}
    for (const y of years) {
      const entry = this.cache.years[String(y)]
      if (!entry) continue
      for (const day of entry.days) {
        marks[dateKeyOf(day.date)] = day.isOffDay ? 'rest' : 'work'
      }
    }
    return marks
  }

  info(): HolidaySyncInfo {
    return {
      lastAttemptAt: this.cache.lastAttemptAt,
      years: Object.values(this.cache.years)
        .sort((a, b) => a.year - b.year)
        .map((e) => ({ year: e.year, published: e.days.length > 0, fetchedAt: e.fetchedAt, source: e.source })),
    }
  }

  private needsRefresh(years: number[]): boolean {
    const now = Date.now()
    if (now - this.cache.lastAttemptAt > REFRESH_INTERVAL_MS) return true
    return years.some((y) => {
      const entry = this.cache.years[String(y)]
      if (!entry) return true
      // 已公布但缓存过期也要重拉（官方可能调整）
      return entry.days.length > 0 && now - entry.fetchedAt > REFRESH_INTERVAL_MS
    })
  }

  /** 后台刷新（fire and forget），并发调用只跑一次 */
  ensureFresh(years: number[]): void {
    const targets = [...new Set(years.filter((y) => Number.isFinite(y)))]
    if (targets.length === 0) return
    if (this.running) return
    if (!this.needsRefresh(targets)) return

    this.running = (async () => {
      let changed = false
      for (const year of targets) {
        if (!this.needsRefresh([year])) continue
        const entry = await fetchYear(year)
        if (!entry) continue
        const prev = this.cache.years[String(year)]
        // 空 days（尚未公布）不覆盖已有有效数据
        if (entry.days.length === 0 && prev && prev.days.length > 0) continue
        if (prev && JSON.stringify(prev.days) === JSON.stringify(entry.days)) {
          prev.fetchedAt = entry.fetchedAt
          prev.source = entry.source
          prev.papers = entry.papers
        } else {
          this.cache.years[String(year)] = entry
        }
        changed = true
      }
      this.cache.lastAttemptAt = Date.now()
      this.save()
      if (changed) {
        console.info('[dsh-smart-reminder] holiday data refreshed')
      }
    })().catch((e) => {
      console.warn('[dsh-smart-reminder] holiday refresh error', e)
    }).finally(() => {
      this.running = null
    })
  }
}
