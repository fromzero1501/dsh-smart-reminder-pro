/**
 * 法定节假日调休标记（休 / 班）
 *
 * 只收录手抄的官方放假安排表，不做推算：调休安排每年由国务院办公厅单独公布，
 * 没有可靠算法。表里没有的年份不显示角标（不猜）。
 */

export type StatutoryMark = 'rest' | 'work'

interface YearHoliday {
  /** 放假日期（含周末与调休出来的休息日） */
  rest: string[]
  /** 调休上班日（周末补班） */
  work: string[]
}

/** 2026 年放假安排（元旦 / 春节 / 清明 / 劳动 / 端午 / 中秋 / 国庆） */
const HOLIDAY_TABLE: Record<number, YearHoliday> = {
  2026: {
    rest: [
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
      '2026-10-06', '2026-10-07',
    ],
    work: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-10-10'],
  },
}

function dateKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** 查某天是休（放假）还是班（调休上班），无标记返回 null */
export function getStatutoryMark(year: number, month: number, day: number): StatutoryMark | null {
  const table = HOLIDAY_TABLE[year]
  if (!table) return null
  const key = dateKey(year, month, day)
  if (table.rest.includes(key)) return 'rest'
  if (table.work.includes(key)) return 'work'
  return null
}

/** 该年是否有放假安排数据（供 UI 决定是否预留角标位置） */
export function hasStatutoryData(year: number): boolean {
  return HOLIDAY_TABLE[year] !== undefined
}
