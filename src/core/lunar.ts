/**
 * 农历算法与法定公历/农历节假日计算（纯轻量算法，无需外部第三方重型库）。
 * 支持计算公历转农历、二十四节气、中国法定节假日（元旦、春节、清明、劳动、端午、中秋、国庆等）。
 * @module dsh-smart-reminder/core/lunar
 */

/** 1900-2100 农历数据压缩编码表 (年份 1900-2100) */
const LUNAR_INFO = [
  0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
  0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
  0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
  0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
  0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
  0x06ca0,0x0b550,0x15355,0x04da0,0x0a5d0,0x14573,0x052d0,0x0a9a8,0x0e950,0x06aa0,
  0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
  0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,
  0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
  0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,
  0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
  0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
  0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
  0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
  0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
  0x14b63
]

const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const LUNAR_DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
]

/** 固定公历节日 (MMDD)，收录与叫法对齐参考万年历 */
const SOLAR_FESTIVALS: Record<string, string> = {
  '0101': '元旦节',
  '0202': '湿地日',
  '0214': '情人节',
  '0308': '妇女节',
  '0312': '植树节',
  '0315': '消费者日',
  '0401': '愚人节',
  '0422': '地球日',
  '0501': '劳动节',
  '0504': '青年节',
  '0508': '微笑日',
  '0512': '护士节',
  '0518': '博物馆日',
  '0531': '无烟日',
  '0601': '儿童节',
  '0623': '奥林匹克',
  '0626': '禁毒日',
  '0701': '建党日',
  '0801': '建军节',
  '0815': '日本投降',
  '0910': '教师节',
  '0918': '九一八',
  '1001': '国庆节',
  '1010': '辛亥革命',
  '1025': '台湾光复',
  '1031': '万圣夜',
  '1101': '万圣节',
  '1111': '光棍节',
  '1201': '艾滋病日',
  '1213': '公祭日',
  '1220': '澳门回归',
  '1224': '平安夜',
  '1225': '圣诞节',
}

/** 固定农历节日 (MMDD)，收录与叫法对齐参考万年历 */
const LUNAR_FESTIVALS: Record<string, string> = {
  '0101': '春节',
  '0115': '元宵节',
  '0202': '龙抬头',
  '0303': '上巳节',
  '0505': '端午节',
  '0707': '七夕节',
  '0715': '中元节',
  '0722': '财神节',
  '0815': '中秋节',
  '0909': '重阳节',
  '1001': '寒衣节',
  '1208': '腊八节',
  '1216': '尾牙',
  '1223': '北方小年',
  '1224': '南方小年',
}

/** 浮动公历节日：某月第 n 个星期几 */
const WEEKDAY_FESTIVALS: Array<{ month: number; weekday: number; nth: number; name: string }> = [
  { month: 5, weekday: 0, nth: 2, name: '母亲节' },
  { month: 6, weekday: 0, nth: 3, name: '父亲节' },
  { month: 11, weekday: 4, nth: 4, name: '感恩节' },
]

/** 二十四节气名（按公历年内顺序，从小寒起） */
const SOLAR_TERM_NAMES = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
]

/** 节气计算有效年份（与农历年表一致） */
const TERM_MIN_YEAR = 1900
const TERM_MAX_YEAR = 2100

/** 太阳视黄经（度），低精度算法，误差约 0.01° */
function sunApparentLongitude(jd: number): number {
  const T = (jd - 2451545.0) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = ((357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI) / 180
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M)
  const omega = ((125.04 - 1934.136 * T) * Math.PI) / 180
  const lon = L0 + C - 0.00569 - 0.00478 * Math.sin(omega)
  return ((lon % 360) + 360) % 360
}

const solarTermCache = new Map<number, Record<string, string>>()

/** 计算某年 24 节气的公历日期（北京时间），返回 { MMDD: 节气名 } */
function computeSolarTerms(year: number): Record<string, string> {
  const cached = solarTermCache.get(year)
  if (cached) return cached
  const map: Record<string, string> = {}
  for (let idx = 0; idx < 24; idx++) {
    // 小寒 285°，此后每个节气黄经 +15°
    const target = (285 + 15 * idx) % 360
    let jd = Date.UTC(year, Math.floor(idx / 2), 6) / 86400000 + 2440587.5
    for (let k = 0; k < 60; k++) {
      const lon = sunApparentLongitude(jd)
      const diff = ((target - lon + 540) % 360) - 180
      jd += diff / 0.9856473
      if (Math.abs(diff) < 1e-7) break
    }
    const bj = new Date((jd - 2440587.5) * 86400000 + 8 * 3600000)
    const key = `${String(bj.getUTCMonth() + 1).padStart(2, '0')}${String(bj.getUTCDate()).padStart(2, '0')}`
    map[key] = SOLAR_TERM_NAMES[idx]
  }
  solarTermCache.set(year, map)
  return map
}

/** 查某天是否是节气，是则返回节气名（1900–2100 之外返回 null） */
export function getSolarTerm(year: number, month: number, day: number): string | null {
  if (year < TERM_MIN_YEAR || year > TERM_MAX_YEAR) return null
  const key = `${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
  return computeSolarTerms(year)[key] ?? null
}

/** 查某天是否命中"第 n 个星期几"类节日 */
function getWeekdayFestival(year: number, month: number, day: number): string | null {
  const dow = new Date(year, month - 1, day).getDay()
  const nth = Math.floor((day - 1) / 7) + 1
  for (const f of WEEKDAY_FESTIVALS) {
    if (f.month === month && f.weekday === dow && f.nth === nth) return f.name
  }
  return null
}

/* ---------------- 干支 / 数九 / 三伏 / 节气锚定节日 ---------------- */

/** 某日的六十甲子序号（0 = 甲子）。以 2026-11-02 为庚辰（16）校准 */
export function getGanZhiIndex(year: number, month: number, day: number): number {
  const days = Math.floor(Date.UTC(year, month - 1, day) / 86400000)
  return (((days + 17) % 60) + 60) % 60
}

/** 干支序号是否落在某个天干上（0=甲 … 4=戊 … 6=庚） */
function isGanDay(date: Date, ganIndex: number): boolean {
  return getGanZhiIndex(date.getFullYear(), date.getMonth() + 1, date.getDate()) % 10 === ganIndex
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** 取某年某个节气的公历日期 */
function termDate(year: number, name: string): Date | null {
  if (year < TERM_MIN_YEAR || year > TERM_MAX_YEAR) return null
  const terms = computeSolarTerms(year)
  for (const key of Object.keys(terms)) {
    if (terms[key] === name) {
      return new Date(year, Number(key.slice(0, 2)) - 1, Number(key.slice(2)))
    }
  }
  return null
}

/** 数九：冬至起每九天一个九（一九…九九），共 81 天 */
export function getNinthLabel(year: number, month: number, day: number): string | null {
  const NINE = ['一九', '二九', '三九', '四九', '五九', '六九', '七九', '八九', '九九']
  const date = new Date(year, month - 1, day)
  let base = termDate(year, '冬至')
  if (base && date < base) base = termDate(year - 1, '冬至')
  else if (!base) base = termDate(year - 1, '冬至')
  if (!base) return null
  const offset = Math.round((date.getTime() - base.getTime()) / 86400000)
  if (offset < 0 || offset >= 81) return null
  return NINE[Math.floor(offset / 9)] ?? null
}

/** 三伏：初伏 = 夏至后第 3 个庚日，末伏 = 立秋后第 1 个庚日，出伏 = 末伏后第 10 天 */
export function getDogDayLabel(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day)
  const summerSolstice = termDate(year, '夏至')
  const autumnStart = termDate(year, '立秋')
  if (!summerSolstice || !autumnStart) return null

  // 夏至当天起数庚日（当天是庚日则计为第 1 个）
  const gengs: Date[] = []
  for (let k = 0; k < 40 && gengs.length < 4; k++) {
    const d = addDays(summerSolstice, k)
    if (isGanDay(d, 6)) gengs.push(d)
  }
  if (gengs.length < 4) return null
  const first = gengs[2] // 初伏
  const middle = gengs[3] // 中伏起

  let last: Date | null = null
  for (let k = 0; k < 20; k++) {
    const d = addDays(autumnStart, k)
    if (isGanDay(d, 6)) { last = d; break }
  }
  if (!last) return null
  const outOfDogDays = addDays(last, 10)

  if (sameDay(date, outOfDogDays)) return '出伏'
  if (date >= first && date < middle) return '初伏'
  if (date >= middle && date < last) return '中伏'
  if (date >= last && date < outOfDogDays) return '末伏'
  return null
}

/** 挂在节气上的节日：丰收节（秋分当天）、春社日（立春后第 5 个戊日） */
function getTermAnchoredFestival(year: number, month: number, day: number, solarTerm: string | null): string | null {
  if (solarTerm === '秋分') return '丰收节'
  const lichun = termDate(year, '立春')
  if (!lichun) return null
  const date = new Date(year, month - 1, day)
  if (date < lichun) return null
  let count = 0
  for (let k = 0; k < 60; k++) {
    const d = addDays(lichun, k)
    if (!isGanDay(d, 4)) continue
    count++
    if (count === 5) return sameDay(d, date) ? '春社日' : null
  }
  return null
}

/** 农历年天数 */
function lYearDays(y: number): number {
  let sum = 348
  const info = LUNAR_INFO[y - 1900]
  if (info === undefined) return 354
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (info & i) ? 1 : 0
  }
  return sum + leapDays(y)
}

/** 农历闰月天数 */
function leapDays(y: number): number {
  if (leapMonth(y)) {
    return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29
  }
  return 0
}

/** 农历闰哪个月（0 表示无闰月） */
function leapMonth(y: number): number {
  const info = LUNAR_INFO[y - 1900]
  return info ? (info & 0xf) : 0
}

/** 农历某月天数 */
function monthDays(y: number, m: number): number {
  const info = LUNAR_INFO[y - 1900]
  if (!info) return 30
  return (info & (0x10000 >> m)) ? 30 : 29
}

/** 副标题类型：节日 / 节气 / 数九三伏 / 农历日 */
export type DayLabelKind = 'festival' | 'term' | 'seasonal' | 'lunarDay'

export interface LunarDateResult {
  lunarYear: number
  lunarMonth: number
  lunarDay: number
  isLeap: boolean
  lunarMonthStr: string
  lunarDayStr: string
  /** 节日或节气显示名（如：春节 / 国庆节 / 初一 / 廿五） */
  festivalOrDay: string
  /** 是否是节日或初一（突出显示） */
  isSpecial: boolean
  /** 副标题类型，供 UI 分别着色 */
  kind: DayLabelKind
  /** 第二行副标题（节日与节气撞同一天时，节气显示在第二行） */
  extra?: { text: string; kind: DayLabelKind }
}

/** 公历日期转农历信息 */
export function getLunarInfo(year: number, month: number, day: number): LunarDateResult {
  const baseDate = new Date(1900, 0, 31)
  const objDate = new Date(year, month - 1, day)
  let offset = Math.floor((objDate.getTime() - baseDate.getTime()) / 86400000)

  let i = 1900
  let temp = 0
  for (i = 1900; i < 2050 && offset > 0; i++) {
    temp = lYearDays(i)
    offset -= temp
  }
  if (offset < 0) {
    offset += temp
    i--
  }

  const lunarYear = i
  const leap = leapMonth(i)
  let isLeap = false
  let m = 1

  for (m = 1; m < 13 && offset > 0; m++) {
    if (leap > 0 && m === (leap + 1) && !isLeap) {
      --m
      isLeap = true
      temp = leapDays(lunarYear)
    } else {
      temp = monthDays(lunarYear, m)
    }
    if (isLeap && m === (leap + 1)) isLeap = false
    offset -= temp
  }

  if (offset === 0 && leap > 0 && m === leap + 1) {
    if (isLeap) isLeap = false
    else { isLeap = true; --m }
  }
  if (offset < 0) {
    offset += temp
    --m
  }

  const lunarMonth = m
  const lunarDay = offset + 1

  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  const solarKey = `${mm}${dd}`
  const lmm = String(lunarMonth).padStart(2, '0')
  const ldd = String(lunarDay).padStart(2, '0')
  const lunarKey = `${lmm}${ldd}`

  // 优先级：节日（浮动 / 节气锚定 / 公历 / 农历 / 除夕）> 节气 > 月首 > 数九三伏 > 农历日
  const weekdayFestival = getWeekdayFestival(year, month, day)
  const solarFestival = SOLAR_FESTIVALS[solarKey]
  const lunarFestival = LUNAR_FESTIVALS[lunarKey]
  const isLunarEve = !isLeap && lunarMonth === 12 && lunarDay === monthDays(lunarYear, 12)
  const solarTerm = getSolarTerm(year, month, day)
  const termFestival = getTermAnchoredFestival(year, month, day, solarTerm)
  const festival =
    weekdayFestival ||
    termFestival ||
    solarFestival ||
    lunarFestival ||
    (isLunarEve ? '除夕' : null)

  let festivalOrDay = ''
  let isSpecial = false
  let kind: DayLabelKind = 'lunarDay'
  let extra: { text: string; kind: DayLabelKind } | undefined

  if (festival) {
    festivalOrDay = festival
    isSpecial = true
    kind = 'festival'
    // 节日与节气撞同一天：节气走第二行
    if (solarTerm && solarTerm !== festival) extra = { text: solarTerm, kind: 'term' }
  } else if (solarTerm) {
    festivalOrDay = solarTerm
    isSpecial = true
    kind = 'term'
  } else if (lunarDay === 1) {
    festivalOrDay = `${LUNAR_MONTH_NAMES[lunarMonth - 1]}月`
    isSpecial = true
    kind = 'lunarDay'
  } else {
    const seasonal = getNinthLabel(year, month, day) ?? getDogDayLabel(year, month, day)
    if (seasonal) {
      festivalOrDay = seasonal
      kind = 'seasonal'
    } else {
      festivalOrDay = LUNAR_DAY_NAMES[lunarDay - 1] ?? `${lunarDay}日`
      kind = 'lunarDay'
    }
  }

  return {
    lunarYear,
    lunarMonth,
    lunarDay,
    isLeap,
    lunarMonthStr: (isLeap ? '闰' : '') + (LUNAR_MONTH_NAMES[lunarMonth - 1] ?? '') + '月',
    lunarDayStr: LUNAR_DAY_NAMES[lunarDay - 1] ?? '',
    festivalOrDay,
    isSpecial,
    kind,
    extra,
  }
}
