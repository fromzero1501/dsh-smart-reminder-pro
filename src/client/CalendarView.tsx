/**
 * 现代全屏日历看板与智能提醒管理页面。
 * 深度国际化：通过 useActiveLang() 100% 自动响应式跟随 DSH Web 当前语言，移除生硬的临时下拉框。
 * 布局重构：
 * 1. 弹窗表单中将「消息推送渠道」与「推送目标」分行排列，彻底杜绝文字重叠和样式错乱；
 * 2. 气泡与提示文案全量接入 i18n 多语言字典；
 * 3. 拖拽改期 (Drag & Drop) 提示根据当前语言自动呈现对应文案。
 * @module dsh-smart-reminder/client/CalendarView
 */

import { createElement, Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReminderItem } from '../core/types.ts'
import { getLunarInfo } from '../core/lunar.ts'
import { getStatutoryMark } from '../core/statutory.ts'
import { parseQuickAdd } from '../core/quick-parser.ts'
import type { ReminderApi } from './api.ts'
import { CalendarClockIcon } from './icons.tsx'
import { t, useActiveLang, GLOBAL_SOLAR_FESTIVALS } from './i18n.ts'

const COMMON_TIME_PRESETS = [
  { label: '09:00', time: '09:00' },
  { label: '11:30', time: '11:30' },
  { label: '14:00', time: '14:00' },
  { label: '16:30', time: '16:30' },
  { label: '18:00', time: '18:00' },
  { label: '20:00', time: '20:00' },
]

const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const ANIMATION_STYLES = `
@keyframes dshFadeIn {
  from { opacity: 0; transform: scale(0.97) translateY(6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes dshOverlayFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dshModalPop {
  0% { opacity: 0; transform: scale(0.94) translateY(8px); }
  60% { transform: scale(1.01) translateY(-1px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes dshToastSlide {
  from { opacity: 0; transform: translate(-50%, 12px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes dshDragPulse {
  0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}

.dsh-rem-cell {
  box-sizing: border-box !important;
  transition: transform 0.14s cubic-bezier(0.4, 0, 0.2, 1),
              background-color 0.16s ease,
              border-color 0.16s ease,
              box-shadow 0.16s ease;
}
.dsh-rem-cell:hover {
  background-color: rgba(148, 163, 184, 0.16);
  z-index: 2;
}

.dsh-rem-cell.drag-over {
  border-color: #3b82f6 !important;
  background-color: rgba(59, 130, 246, 0.18) !important;
  transform: scale(1.04);
  animation: dshDragPulse 1.2s infinite;
  z-index: 5;
}

.dsh-rem-card {
  box-sizing: border-box !important;
  cursor: grab;
  transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
}
.dsh-rem-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.06);
}
.dsh-rem-card:active {
  cursor: grabbing;
}
.dsh-rem-card.dragging {
  opacity: 0.4;
  transform: scale(0.96);
}

.dsh-btn-smooth {
  transition: all 0.14s cubic-bezier(0.4, 0, 0.2, 1);
}
.dsh-btn-smooth:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
}
.dsh-btn-smooth:active {
  transform: translateY(1px) scale(0.98);
}
`

let animStyleInjected = false
function ensureAnimStyles(): void {
  if (animStyleInjected) return
  animStyleInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-smart-reminder-animations'
  tag.textContent = ANIMATION_STYLES
  document.head.appendChild(tag)
}

function detectDshDarkTheme(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true

  const doc = document.documentElement
  const body = document.body
  const candidates = [
    doc.getAttribute('data-theme'),
    doc.getAttribute('data-ds-dark-theme'),
    body?.getAttribute('data-theme'),
    doc.className,
    body?.className,
  ]

  for (const c of candidates) {
    if (typeof c === 'string') {
      if (c.includes('dark') || c === 'dark') return true
      if (c.includes('light') || c === 'light') return false
    }
  }

  try {
    const bgElem = document.querySelector('[class*="sidebar"], [class*="layout"], body')
    if (bgElem) {
      const bg = window.getComputedStyle(bgElem).backgroundColor
      const rgb = bg.match(/\d+/g)
      if (rgb && rgb.length >= 3) {
        const luma = 0.299 * Number(rgb[0]) + 0.587 * Number(rgb[1]) + 0.114 * Number(rgb[2])
        return luma < 128
      }
    }
  } catch {}

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function CalendarView(props: { api: ReminderApi; onClose: () => void }): React.ReactElement {
  const { api, onClose } = props
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [items, setItems] = useState<ReminderItem[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateKey(new Date()))

  // 100% 跟随 DSH Web 当前语言（实时响应式订阅，永久跟随，不再需要下拉框）
  const lang = useActiveLang()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all')

  const [deletedCache, setDeletedCache] = useState<ReminderItem | null>(null)
  // 法定节假日 / 调休数据（host 侧同步后通过本地接口下发；拉不到时回退内置表）
  const [holidayMarks, setHolidayMarks] = useState<Record<string, 'rest' | 'work'>>({})
  const [holidayInfo, setHolidayInfo] = useState<{
    lastAttemptAt: number
    years: Array<{ year: number; published: boolean; fetchedAt: number; source: string }>
  }>({ lastAttemptAt: 0, years: [] })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)

  const [gatewayInfo, setGatewayInfo] = useState<{ hasGateway: boolean; platforms: string[] }>({ hasGateway: true, platforms: ['wecom-aibot', 'telegram', 'discord', 'email'] })

  ensureAnimStyles()

  const [isDark, setIsDark] = useState(detectDshDarkTheme)

  useEffect(() => {
    const updateTheme = () => setIsDark(detectDshDarkTheme())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', updateTheme)

    const mo = new MutationObserver(() => updateTheme())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

    const interval = setInterval(updateTheme, 1000)

    api.getGatewayStatus().then((info) => {
      if (info.ok) setGatewayInfo(info)
    })

    return () => {
      mq.removeEventListener('change', updateTheme)
      mo.disconnect()
      clearInterval(interval)
    }
  }, [api])

  const [editingItem, setEditingItem] = useState<{
    id?: string
    title: string
    date: string
    time: string
    description: string
    priority: 'high' | 'medium' | 'low'
    repeat: 'none' | 'daily' | 'weekly' | 'monthly'
    pushPlatform: 'none' | 'wecom-aibot' | 'telegram' | 'discord' | 'email'
    pushTarget: string
    notifySystem: boolean
  } | null>(null)

  const [toastMsg, setToastMsg] = useState<{ text: string; showUndo?: boolean } | null>(null)
  const [quickAddText, setQuickAddText] = useState('')
  const [quickAddPending, setQuickAddPending] = useState(false)

  // 实时解析闪电速记输入框中的内容，生成预测预览
  const quickAddParsed = useMemo(() => {
    if (!quickAddText.trim()) return null
    return parseQuickAdd(quickAddText)
  }, [quickAddText])

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickAddText.trim() || quickAddPending) return
    const parsed = parseQuickAdd(quickAddText)
    if (!parsed.title || !parsed.dueTimeStr || !parsed.dueAt) return

    setQuickAddPending(true)
    try {
      await api.save({
        title: parsed.title,
        dueTimeStr: parsed.dueTimeStr,
        dueAt: parsed.dueAt,
        priority: 'medium',
        repeat: 'none',
        notifySystem: true,
      })
      setQuickAddText('')
      showToast(t('quickAdd.success', lang) + `: ${parsed.title} (${parsed.dueTimeStr})`)
      await loadItems()
    } catch (err) {
      showToast('创建失败 / Failed to create')
    } finally {
      setQuickAddPending(false)
    }
  }

  const loadItems = useCallback(async () => {
    const list = await api.getList()
    setItems(list)
  }, [api])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const showToast = (text: string, showUndo = false) => {
    setToastMsg({ text, showUndo })
    setTimeout(() => setToastMsg(null), 4000)
  }

  const prevMonth = useCallback(() => {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }, [])
  const nextMonth = useCallback(() => {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }, [])
  const todayMonth = useCallback(() => {
    const now = new Date()
    setCurrentDate(now)
    setSelectedDate(formatDateKey(now))
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingItem) {
        if (e.key === 'Escape') setEditingItem(null)
        return
      }
      if (e.key === 'Escape') {
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setEditingItem({
          title: '',
          date: selectedDate,
          time: '09:00',
          description: '',
          priority: 'medium',
          repeat: 'none',
          pushPlatform: 'none',
          pushTarget: '',
          notifySystem: true,
        })
      } else if (e.key === 'ArrowLeft' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        prevMonth()
      } else if (e.key === 'ArrowRight' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        nextMonth()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingItem, onClose, prevMonth, nextMonth, selectedDate])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1

  // 节假日数据：跟随当前显示年份，host 侧每天最多真正拉取一次
  useEffect(() => {
    let alive = true
    void api.getHolidayData([year, year + 1]).then((res) => {
      if (!alive) return
      setHolidayMarks(res.marks)
      setHolidayInfo(res.info)
    })
    return () => {
      alive = false
    }
  }, [api, year])

  // 节假日数据版本说明（只显示来源与时间，不做交互）
  const holidayVersionText = (() => {
    const entry = holidayInfo.years.find((y) => y.year === year)
    if (entry && entry.published) {
      const d = new Date(entry.fetchedAt)
      const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return `节假日数据 ${year} · 更新于 ${md}`
    }
    if (holidayInfo.years.length > 0) return `${year} 年安排尚未公布`
    return '节假日数据：内置表'
  })()

  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
  const totalDays = new Date(year, month, 0).getDate()
  const prevMonthDays = new Date(year, month - 1, 0).getDate()

  const calendarCells = []
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const pDay = prevMonthDays - i
    const pMonth = month - 1 === 0 ? 12 : month - 1
    const pYear = month - 1 === 0 ? year - 1 : year
    const pDateKey = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(pDay).padStart(2, '0')}`
    calendarCells.push({ day: pDay, isCurrentMonth: false, dateKey: pDateKey, year: pYear, month: pMonth })
  }
  for (let d = 1; d <= totalDays; d++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    calendarCells.push({ day: d, isCurrentMonth: true, dateKey, year, month })
  }
  const targetTotalCells = calendarCells.length <= 35 ? 35 : 42
  const remaining = targetTotalCells - calendarCells.length
  for (let d = 1; d <= remaining; d++) {
    const nMonth = month + 1 > 12 ? 1 : month + 1
    const nYear = month + 1 > 12 ? year + 1 : year
    const nDateKey = `${nYear}-${String(nMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    calendarCells.push({ day: d, isCurrentMonth: false, dateKey: nDateKey, year: nYear, month: nMonth })
  }

  const selectedDateItems = useMemo(() => {
    return items.filter((i) => {
      if (!i.dueTimeStr.startsWith(selectedDate)) return false
      if (statusFilter === 'pending' && i.status !== 'pending') return false
      if (statusFilter === 'completed' && i.status !== 'completed') return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return i.title.toLowerCase().includes(q) || (i.description && i.description.toLowerCase().includes(q))
      }
      return true
    })
  }, [items, selectedDate, statusFilter, searchQuery])

  const monthStats = useMemo(() => {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
    const mItems = items.filter((i) => i.dueTimeStr.startsWith(monthPrefix) && i.status !== 'canceled')
    const total = mItems.length
    const completed = mItems.filter((i) => i.status === 'completed').length
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, rate }
  }, [items, year, month])

  const formattedMonthTitle = useMemo(() => {
    if (lang === 'en') return `${MONTH_NAMES_EN[month - 1]} ${year}`
    if (lang === 'es') return `${MONTH_NAMES_ES[month - 1]} de ${year}`
    return `${year} 年 ${month} 月`
  }, [year, month, lang])

  const missedItems = items.filter((i) => i.isMissedCatchup && i.status !== 'completed')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem?.title || !editingItem.date || !editingItem.time) {
      showToast('请完整填写标题和时间 / Please fill title and time')
      return
    }

    const dueTimeStr = `${editingItem.date} ${editingItem.time}`
    const dueAt = new Date(dueTimeStr.replace(/-/g, '/')).getTime()
    if (isNaN(dueAt)) {
      showToast('时间格式不正确 / Invalid time format')
      return
    }

    const payload: Partial<ReminderItem> = {
      id: editingItem.id,
      title: editingItem.title,
      description: editingItem.description,
      dueTimeStr,
      dueAt,
      priority: editingItem.priority || 'medium',
      repeat: editingItem.repeat,
      pushPlatform: editingItem.pushPlatform,
      pushTarget: editingItem.pushTarget?.trim() || undefined,
      notifySystem: editingItem.notifySystem,
      // 关键修复：编辑时间如果调整到了未来，重置状态为待提醒 (pending)，重新激活调度器！
      status: dueAt > Date.now() ? 'pending' : undefined,
    }
    const res = await api.save(payload)
    if (res) {
      showToast(t('toast.saved', lang))
      setEditingItem(null)
      void loadItems()
    }
  }

  const handleDropOnDate = async (targetDateKey: string) => {
    if (!draggingId) return
    const targetItem = items.find((i) => i.id === draggingId)
    if (!targetItem) return

    const oldTimePart = targetItem.dueTimeStr.split(' ')[1] || '09:00'
    const newDueTimeStr = `${targetDateKey} ${oldTimePart}`
    const newDueAt = new Date(newDueTimeStr.replace(/-/g, '/')).getTime()

    if (isNaN(newDueAt)) return

    const updated = await api.save({
      ...targetItem,
      dueTimeStr: newDueTimeStr,
      dueAt: newDueAt,
      status: 'pending',
    })

    if (updated) {
      showToast(`🗓️ ${targetItem.title} ➔ ${targetDateKey}`)
      setSelectedDate(targetDateKey)
      void loadItems()
    }

    setDraggingId(null)
    setDragOverDate(null)
  }

  const handleToggleComplete = async (id: string) => {
    const res = await api.toggleComplete(id)
    if (res) {
      showToast(res.status === 'completed' ? '🎉 ' + t('status.completed', lang) : '↩️ ' + t('status.pending', lang))
      void loadItems()
    }
  }

  const handleSnooze = async (id: string, minutes: number, label: string) => {
    const res = await api.snooze(id, minutes)
    if (res) {
      showToast(`${t('toast.snoozed', lang)} ${label}`)
      void loadItems()
    }
  }

  const handleDelete = async (id: string) => {
    const target = items.find((i) => i.id === id)
    if (!target) return
    const ok = await api.delete(id)
    if (ok) {
      setDeletedCache(target)
      showToast(`${t('toast.deleted', lang)} "${target.title}"`, true)
      void loadItems()
    }
  }

  const handleUndo = async () => {
    if (!deletedCache) return
    const res = await api.save(deletedCache)
    if (res) {
      setDeletedCache(null)
      setToastMsg(null)
      showToast('✅ 已撤销删除')
      void loadItems()
    }
  }

  const handleTestNotify = async () => {
    const res = await api.testNotify()
    showToast(res.message || 'Notification triggered')
  }

  const handleExportIcs = () => {
    window.open('/api/reminders/export.ics', '_blank')
    showToast(t('toast.exported', lang))
  }

  const theme = isDark
    ? {
        bgOverlay: 'rgba(15, 23, 42, 0.78)',
        bgModal: '#1e293b',
        headerBg: 'linear-gradient(to right, #1e293b, #0f172a)',
        border: '#334155',
        borderLight: '#1e293b',
        textPrimary: '#f8fafc',
        textSecondary: '#cbd5e1',
        textMuted: '#94a3b8',
        textLunarMuted: '#64748b',
        textLunarSpecial: '#fbbf24',
        textFestival: '#f87171',
        textSolarTerm: '#4ade80',
        textSeasonal: '#cbd5e1',
        textWeekend: '#f87171',
        todayBg: '#c62f2f',
        todayText: '#ffffff',
        restBg: '#ef4444',
        workBg: '#94a3b8',
        btnSecondaryBg: '#334155',
        btnSecondaryBorder: '#475569',
        rightPanelBg: '#0f172a',
        cellBgCurrent: '#0f172a',
        cellBgOther: '#090d16',
        cellSelectedBg: '#3f1113',
        cellSelectedBorder: '#ef4444',
        cardBg: '#1e293b',
        inputBg: '#0f172a',
        presetBg: '#334155',
        presetText: '#cbd5e1',
        missedBannerBg: 'rgba(239, 68, 68, 0.12)',
        missedBannerBorder: 'rgba(239, 68, 68, 0.3)',
      }
    : {
        bgOverlay: 'rgba(71, 85, 105, 0.45)',
        bgModal: '#ffffff',
        headerBg: 'linear-gradient(to right, #ffffff, #f8fafc)',
        border: '#e2e8f0',
        borderLight: '#f1f5f9',
        textPrimary: '#0f172a',
        textSecondary: '#334155',
        textMuted: '#64748b',
        textLunarMuted: '#94a3b8',
        textLunarSpecial: '#d97706',
        textFestival: '#c62f2f',
        textSolarTerm: '#15803d',
        textSeasonal: '#475569',
        textWeekend: '#c62f2f',
        todayBg: '#c62f2f',
        todayText: '#ffffff',
        restBg: '#c62f2f',
        workBg: '#64748b',
        btnSecondaryBg: '#f1f5f9',
        btnSecondaryBorder: '#cbd5e1',
        rightPanelBg: '#f8fafc',
        cellBgCurrent: '#ffffff',
        cellBgOther: '#f8fafc',
        cellSelectedBg: '#eff6ff',
        cellSelectedBorder: '#3b82f6',
        cardBg: '#ffffff',
        inputBg: '#ffffff',
        presetBg: '#f1f5f9',
        presetText: '#475569',
        missedBannerBg: 'rgba(254, 226, 226, 0.7)',
        missedBannerBorder: '#fca5a5',
      }

  const getPriorityColor = (p?: string) => {
    if (p === 'high') return '#ef4444'
    if (p === 'low') return '#10b981'
    return '#3b82f6'
  }

  return createElement(
    'div',
    {
      className: 'dsh-rem-overlay',
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.bgOverlay,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box',
        color: theme.textSecondary,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        animation: 'dshOverlayFade 0.2s ease-out forwards',
      },
    },
    createElement(
      'div',
      {
        className: 'dsh-rem-modal',
        style: {
          width: '980px',
          maxWidth: '94vw',
          height: '660px',
          maxHeight: '90vh',
          backgroundColor: theme.bgModal,
          borderRadius: '16px',
          boxShadow: isDark
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.1)'
            : '0 25px 50px -12px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'dshFadeIn 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        },
      },
      // 头部（移除不可靠的临时语言下拉框，100%跟随 DSH Web 当前语言）
      createElement(
        'div',
        {
          style: {
            padding: '14px 20px',
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: theme.headerBg,
            flex: 'none',
            gap: '12px',
          },
        },
        createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 } },
          createElement('span', { style: { display: 'flex', alignItems: 'center', color: 'inherit', flex: 'none' } }, createElement(CalendarClockIcon, { size: 18 })),
          createElement('h3', { style: { margin: 0, fontSize: '15px', fontWeight: 600, color: theme.textPrimary, whiteSpace: 'nowrap' } }, t('app.title', lang)),
          createElement(
            'span',
            {
              style: {
                fontSize: '11px',
                padding: '3px 10px',
                borderRadius: '12px',
                backgroundColor: isDark ? '#334155' : '#e2e8f0',
                color: theme.textMuted,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '260px',
              },
            },
            t('stats.summary', lang, { total: monthStats.total, rate: monthStats.rate }),
          ),
        ),
        createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } },
          createElement(
            'button',
            {
              className: 'dsh-btn-smooth',
              onClick: handleExportIcs,
              title: '导出为标准 .ics 日历文件，支持同步至 Apple 日历 / Outlook / Google 日历',
              style: {
                padding: '5px 12px',
                fontSize: '12px',
                borderRadius: '6px',
                border: `1px solid ${theme.btnSecondaryBorder}`,
                backgroundColor: theme.btnSecondaryBg,
                color: theme.textSecondary,
                cursor: 'pointer',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              },
            },
            t('btn.exportIcs', lang),
          ),
          createElement(
            'button',
            {
              className: 'dsh-btn-smooth',
              onClick: handleTestNotify,
              style: {
                padding: '5px 12px',
                fontSize: '12px',
                borderRadius: '6px',
                border: `1px solid ${theme.btnSecondaryBorder}`,
                backgroundColor: theme.btnSecondaryBg,
                color: theme.textSecondary,
                cursor: 'pointer',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              },
            },
            t('btn.testNotify', lang),
          ),
          createElement(
            'button',
            {
              className: 'dsh-btn-smooth',
              onClick: onClose,
              style: {
                padding: '5px 14px',
                fontSize: '12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#ef4444',
                color: '#ffffff',
                cursor: 'pointer',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              },
            },
            t('btn.close', lang),
          ),
        ),
      ),

      // 顶部常驻：闪电速记栏 (Quick Add Bar)
      createElement(
        'form',
        {
          onSubmit: handleQuickAddSubmit,
          style: {
            padding: '10px 20px',
            backgroundColor: isDark ? 'rgba(30, 41, 59, 0.7)' : 'rgba(241, 245, 249, 0.85)',
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: 'none',
            position: 'relative',
          },
        },
        createElement(
          'span',
          {
            style: {
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '4px',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              fontWeight: 600,
              letterSpacing: '0.4px',
              whiteSpace: 'nowrap',
              flex: 'none',
            },
          },
          t('quickAdd.badge', lang),
        ),
        createElement('input', {
          type: 'text',
          value: quickAddText,
          onChange: (e: any) => setQuickAddText(e.target.value),
          placeholder: t('quickAdd.placeholder', lang),
          style: {
            flex: 1,
            padding: '7px 12px',
            fontSize: '13px',
            borderRadius: '6px',
            border: `1px solid ${theme.border}`,
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            color: theme.textPrimary,
            outline: 'none',
            transition: 'border-color 0.15s ease',
          },
        }),
        quickAddParsed && quickAddParsed.title
          ? createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: isDark ? '#93c5fd' : '#2563eb',
                  backgroundColor: isDark ? 'rgba(37, 99, 235, 0.2)' : 'rgba(219, 234, 254, 0.8)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  whiteSpace: 'nowrap',
                  flex: 'none',
                },
              },
              createElement('span', null, `📌 ${quickAddParsed.title}`),
              createElement('span', { style: { fontWeight: 600 } }, `⏰ ${quickAddParsed.dueTimeStr}`),
            )
          : null,
        createElement(
          'button',
          {
            type: 'submit',
            className: 'dsh-btn-smooth',
            disabled: !quickAddText.trim() || quickAddPending,
            style: {
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: !quickAddText.trim() ? (isDark ? '#475569' : '#cbd5e1') : '#3b82f6',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: !quickAddText.trim() ? 'not-allowed' : 'pointer',
              flex: 'none',
            },
          },
          'Enter ↵',
        ),
      ),

      // 离线漏发横幅提醒
      missedItems.length > 0
        ? createElement(
            'div',
            {
              style: {
                padding: '8px 20px',
                backgroundColor: theme.missedBannerBg,
                borderBottom: `1px solid ${theme.missedBannerBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: isDark ? '#fca5a5' : '#b91c1c',
                flex: 'none',
              },
            },
            createElement('span', null, t('banner.missed', lang, { n: missedItems.length }) + `: ${missedItems.map((m) => m.title).slice(0, 3).join('、')}${missedItems.length > 3 ? '...' : ''}`),
            createElement(
              'button',
              {
                className: 'dsh-btn-smooth',
                onClick: () => {
                  missedItems.forEach((m) => api.toggleComplete(m.id))
                  setTimeout(() => void loadItems(), 100)
                },
                style: {
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                },
              },
              t('btn.completeAll', lang),
            ),
          )
        : null,

      // 主体两栏布局
      createElement(
        'div',
        { style: { flex: 1, display: 'flex', overflow: 'hidden' } },
        // 左侧日历栏
        createElement(
          'div',
          { style: { flex: 58, borderRight: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto', overflowX: 'hidden' } },
          // 日历月份切换控制器
          createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' } },
            createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: 600, color: theme.textPrimary } }, formattedMonthTitle),
              createElement(
                'button',
                {
                  className: 'dsh-btn-smooth',
                  onClick: todayMonth,
                  style: { padding: '2px 8px', fontSize: '11px', borderRadius: '5px', border: '1px solid #3b82f6', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer', fontWeight: 600 },
                },
                t('btn.today', lang),
              ),
            ),
            createElement(
              'div',
              { style: { display: 'flex', gap: '6px' } },
              createElement('button', { className: 'dsh-btn-smooth', onClick: prevMonth, style: { padding: '5px 12px', borderRadius: '6px', border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.textSecondary, cursor: 'pointer', fontSize: '12px' } }, t('btn.prevMonth', lang)),
              createElement('button', { className: 'dsh-btn-smooth', onClick: nextMonth, style: { padding: '5px 12px', borderRadius: '6px', border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.textSecondary, cursor: 'pointer', fontSize: '12px' } }, t('btn.nextMonth', lang)),
            ),
          ),

          // 星期表头
          createElement(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '6px', textAlign: 'center' } },
            [0, 1, 2, 3, 4, 5, 6].map((w) =>
              createElement('div', { key: w, style: { fontSize: '12px', fontWeight: 600, color: w === 0 || w === 6 ? '#ef4444' : theme.textMuted, padding: '2px 0' } }, t(`week.${w}`, lang)),
            ),
          ),

          // 日历网格
          createElement(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: '6px', flex: 1, minHeight: 0 } },
            calendarCells.map((cell) => {
              const mm = String(cell.month).padStart(2, '0')
              const dd = String(cell.day).padStart(2, '0')
              const solarKey = `${mm}${dd}`

              let subtitle = ''
              let isSpecial = false
              let labelKind: 'festival' | 'term' | 'seasonal' | 'lunarDay' = 'lunarDay'
              let extraSubtitle: { text: string; kind: 'festival' | 'term' | 'seasonal' | 'lunarDay' } | undefined

              if (lang === 'zh') {
                const lunar = getLunarInfo(cell.year, cell.month, cell.day)
                subtitle = lunar.festivalOrDay
                isSpecial = lunar.isSpecial
                labelKind = lunar.kind
                extraSubtitle = lunar.extra
              } else {
                const globalFest = GLOBAL_SOLAR_FESTIVALS[solarKey]
                if (globalFest) {
                  subtitle = globalFest[lang] || globalFest.en
                  isSpecial = true
                  labelKind = 'festival'
                }
              }

              const weekday = new Date(cell.year, cell.month - 1, cell.day).getDay()
              const isWeekend = weekday === 0 || weekday === 6

              const isSelected = selectedDate === cell.dateKey
              const isToday = formatDateKey(new Date()) === cell.dateKey
              const isDragOver = dragOverDate === cell.dateKey
              const statutory = holidayMarks[cell.dateKey] ?? getStatutoryMark(cell.year, cell.month, cell.day)
              const colorFor = (k: 'festival' | 'term' | 'seasonal' | 'lunarDay') =>
                isToday
                  ? theme.todayText
                  : k === 'festival'
                    ? theme.textFestival
                    : k === 'term'
                      ? theme.textSolarTerm
                      : k === 'seasonal'
                        ? theme.textSeasonal
                        : theme.textLunarMuted
              const pendingCount = items.filter((i) => i.dueTimeStr.startsWith(cell.dateKey) && i.status === 'pending').length
              const hasCompleted = items.some((i) => i.dueTimeStr.startsWith(cell.dateKey) && i.status === 'completed')

              return createElement(
                'div',
                {
                  key: cell.dateKey,
                  className: `dsh-rem-cell ${isDragOver ? 'drag-over' : ''}`,
                  onClick: () => setSelectedDate(cell.dateKey),
                  onDragOver: (e: any) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOverDate !== cell.dateKey) setDragOverDate(cell.dateKey)
                  },
                  onDragLeave: () => {
                    if (dragOverDate === cell.dateKey) setDragOverDate(null)
                  },
                  onDrop: (e: any) => {
                    e.preventDefault()
                    void handleDropOnDate(cell.dateKey)
                  },
                  style: {
                    padding: '2px',
                    borderRadius: '12px',
                    // 今天整格红底（含边框位置）；手动选中只给红框 + 淡红底
                    backgroundColor: isToday ? theme.todayBg : isSelected ? theme.cellSelectedBg : 'transparent',
                    borderWidth: '2px',
                    borderStyle: 'solid',
                    borderColor: isSelected
                      ? isToday
                        ? theme.todayText
                        : theme.cellSelectedBorder
                      : isDragOver
                        ? '#3b82f6'
                        : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    minHeight: 0,
                    minWidth: 0,
                    boxSizing: 'border-box',
                    position: 'relative',
                    opacity: cell.isCurrentMonth ? 1 : 0.35,
                  },
                },
                // 法定节假日角标：左上角 休 / 班
                statutory
                  ? createElement(
                      'span',
                      {
                        style: {
                          position: 'absolute',
                          top: '1px',
                          left: '1px',
                          fontSize: '10px',
                          lineHeight: '14px',
                          padding: '0 3px',
                          borderRadius: '5px',
                          backgroundColor: statutory === 'rest' ? theme.restBg : theme.workBg,
                          color: '#fff',
                          fontWeight: 700,
                          transform: 'scale(0.92)',
                          transformOrigin: 'top left',
                          pointerEvents: 'none',
                        },
                      },
                      statutory === 'rest' ? '休' : '班',
                    )
                  : null,
                // 待办角标 / 已完成标记：绝对定位在右上角
                pendingCount > 0
                  ? createElement(
                      'span',
                      {
                        style: {
                          position: 'absolute',
                          top: '0px',
                          right: '-2px',
                          fontSize: '10px',
                          backgroundColor: isToday ? 'rgba(255,255,255,0.92)' : '#ef4444',
                          color: isToday ? theme.todayBg : '#fff',
                          borderRadius: '10px',
                          padding: '0 5px',
                          fontWeight: 700,
                          boxShadow: '0 2px 4px rgba(239,68,68,0.3)',
                        },
                      },
                      pendingCount,
                    )
                  : hasCompleted
                    ? createElement(
                        'span',
                        {
                          style: {
                            position: 'absolute',
                            top: '0px',
                            right: '0px',
                            fontSize: '10px',
                            color: isToday ? theme.todayText : '#10b981',
                            fontWeight: 700,
                          },
                        },
                        '✓',
                      )
                    : null,
                // 数字 + 副标题（今天整格红底白字；节日与节气撞车时显示两行）
                createElement(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0px',
                      padding: '2px 2px',
                      maxWidth: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                    },
                  },
                  createElement(
                    'span',
                    {
                      style: {
                        fontSize: '27px',
                        lineHeight: '1.05',
                        fontWeight: isToday ? 600 : 500,
                        color: isToday ? theme.todayText : isWeekend ? theme.textWeekend : theme.textPrimary,
                      },
                    },
                    cell.day,
                  ),
                  subtitle
                    ? createElement(
                        'span',
                        {
                          style: {
                            fontSize: '12px',
                            lineHeight: '1.3',
                            color: colorFor(labelKind),
                            fontWeight: labelKind === 'festival' || labelKind === 'term' ? 600 : 400,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                          },
                        },
                        subtitle,
                      )
                    : createElement('span', { style: { height: '16px' } }),
                  extraSubtitle
                    ? createElement(
                        'span',
                        {
                          style: {
                            fontSize: '11px',
                            lineHeight: '1.2',
                            color: colorFor(extraSubtitle.kind),
                            opacity: isToday ? 0.92 : 1,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                          },
                        },
                        extraSubtitle.text,
                      )
                    : null,
                ),
              )
            }),
          ),
          // 节假日数据版本（仅中文界面，一行灰字，不可点）
          lang === 'zh'
            ? createElement(
                'div',
                {
                  style: {
                    marginTop: '8px',
                    fontSize: '11px',
                    lineHeight: '1.4',
                    color: theme.textMuted,
                    textAlign: 'center',
                    userSelect: 'none',
                  },
                },
                holidayVersionText,
              )
            : null,
        ),

        // 右侧事项详情与操作栏
        createElement(
          'div',
          { style: { flex: 42, display: 'flex', flexDirection: 'column', padding: '16px', backgroundColor: theme.rightPanelBg, overflowY: 'auto', overflowX: 'hidden' } },
          // 顶部：日期标题与新建按钮
          createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
            createElement('h4', { style: { margin: 0, fontSize: '14px', color: theme.textPrimary } }, `📌 ${selectedDate}`),
            createElement(
              'button',
              {
                className: 'dsh-btn-smooth',
                onClick: () =>
                  setEditingItem({
                    title: '',
                    date: selectedDate,
                    time: '09:00',
                    description: '',
                    priority: 'medium',
                    repeat: 'none',
                    pushPlatform: 'none',
                    pushTarget: '',
                    notifySystem: true,
                  }),
                style: {
                  padding: '5px 12px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 5px rgba(37,99,235,0.25)',
                  whiteSpace: 'nowrap',
                },
              },
              t('btn.newReminder', lang),
            ),
          ),

          // 搜索框
          createElement('input', {
            type: 'text',
            placeholder: t('search.placeholder', lang),
            value: searchQuery,
            onChange: (e: any) => setSearchQuery(e.target.value),
            style: {
              padding: '6px 10px',
              fontSize: '12px',
              borderRadius: '6px',
              border: `1px solid ${theme.border}`,
              backgroundColor: theme.inputBg,
              color: theme.textPrimary,
              outline: 'none',
              marginBottom: '8px',
            },
          }),

          // 状态筛选胶囊
          createElement(
            'div',
            { style: { display: 'flex', gap: '4px', marginBottom: '12px' } },
            (['all', 'pending', 'completed'] as const).map((st) =>
              createElement(
                'button',
                {
                  key: st,
                  className: 'dsh-btn-smooth',
                  onClick: () => setStatusFilter(st),
                  style: {
                    flex: 1,
                    fontSize: '11px',
                    padding: '3px 0',
                    borderRadius: '4px',
                    border: statusFilter === st ? '1px solid #3b82f6' : `1px solid ${theme.border}`,
                    backgroundColor: statusFilter === st ? (isDark ? '#1e3a8a' : '#eff6ff') : theme.presetBg,
                    color: statusFilter === st ? '#3b82f6' : theme.presetText,
                    cursor: 'pointer',
                    fontWeight: statusFilter === st ? 600 : 400,
                    whiteSpace: 'nowrap',
                  },
                },
                t(`filter.${st}`, lang),
              ),
            ),
          ),

          // 列表项
          selectedDateItems.length === 0
            ? createElement(
                'div',
                {
                  style: {
                    textAlign: 'center',
                    padding: '48px 12px',
                    color: theme.textMuted,
                    fontSize: '12px',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                    borderRadius: '8px',
                    border: `1px dashed ${theme.border}`,
                  },
                },
                searchQuery ? t('empty.searchNoItems', lang) : t('empty.noItems', lang),
              )
            : createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', overflowX: 'hidden' } },
                selectedDateItems.map((item) => {
                  const isCompleted = item.status === 'completed'
                  const isDone = item.status === 'done'
                  const isDraggingThis = draggingId === item.id
                  const pColor = getPriorityColor(item.priority)

                  return createElement(
                    'div',
                    {
                      key: item.id,
                      draggable: !isCompleted,
                      onDragStart: (e: any) => {
                        e.dataTransfer.setData('text/plain', item.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDraggingId(item.id)
                      },
                      onDragEnd: () => {
                        setDraggingId(null)
                        setDragOverDate(null)
                      },
                      className: `dsh-rem-card ${isDraggingThis ? 'dragging' : ''}`,
                      title: t('drag.hint', lang),
                      style: {
                        padding: '10px 12px',
                        backgroundColor: theme.cardBg,
                        borderRadius: '8px',
                        border: `1px solid ${theme.border}`,
                        borderLeft: `4px solid ${isCompleted ? '#94a3b8' : pColor}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        boxShadow: !isDark ? '0 1px 3px rgba(0,0,0,0.03)' : 'none',
                        opacity: isCompleted ? 0.6 : 1,
                        boxSizing: 'border-box',
                        width: '100%',
                      },
                    },
                    createElement(
                      'div',
                      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                      createElement(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 } },
                        createElement('input', {
                          type: 'checkbox',
                          checked: isCompleted,
                          onChange: () => handleToggleComplete(item.id),
                          style: { cursor: 'pointer', width: '14px', height: '14px', accentColor: '#10b981', flex: 'none' },
                        }),
                        createElement(
                          'span',
                          {
                            style: {
                              fontSize: '12px',
                              fontWeight: 600,
                              color: isCompleted ? theme.textMuted : theme.textPrimary,
                              textDecoration: isCompleted ? 'line-through' : 'none',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          },
                          item.title,
                        ),
                      ),
                      createElement(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: '4px', flex: 'none' } },
                        createElement(
                          'button',
                          {
                            onClick: (e: any) => {
                              e.stopPropagation()
                              const [dPart, tPart] = item.dueTimeStr.split(' ')
                              setEditingItem({
                                id: item.id,
                                title: item.title,
                                date: dPart || selectedDate,
                                time: tPart || '09:00',
                                description: item.description || '',
                                priority: item.priority || 'medium',
                                repeat: item.repeat || 'none',
                                pushPlatform: item.pushPlatform || 'none',
                                pushTarget: item.pushTarget || '',
                                notifySystem: item.notifySystem !== false,
                              })
                            },
                            style: { border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: '12px', padding: '0 3px' },
                          },
                          '✏️',
                        ),
                        createElement(
                          'button',
                          {
                            onClick: (e: any) => {
                              e.stopPropagation()
                              handleDelete(item.id)
                            },
                            style: { border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: '12px', padding: '0 3px' },
                          },
                          '✕',
                        ),
                      ),
                    ),
                    createElement(
                      'div',
                      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: theme.textMuted, marginTop: '2px' } },
                      createElement('span', null, `⏰ ${item.dueTimeStr.split(' ')[1] || item.dueTimeStr}${item.pushPlatform && item.pushPlatform !== 'none' ? ` · ${item.pushPlatform}` : ''}${item.repeat && item.repeat !== 'none' ? ` (${t(`repeat.${item.repeat}`, lang)})` : ''}`),
                      createElement(
                        'div',
                        { style: { display: 'flex', gap: '3px', alignItems: 'center' } },
                        !isCompleted ? (
                          createElement(
                            'div',
                            { style: { display: 'flex', gap: '2px' } },
                            createElement(
                              'button',
                              {
                                className: 'dsh-btn-smooth',
                                onClick: () => handleSnooze(item.id, 15, '15m'),
                                title: 'Snooze 15m',
                                style: { fontSize: '9px', padding: '1px 4px', borderRadius: '3px', border: `1px solid ${theme.border}`, background: theme.presetBg, color: theme.textSecondary, cursor: 'pointer' },
                              },
                              '+15m',
                            ),
                            createElement(
                              'button',
                              {
                                className: 'dsh-btn-smooth',
                                onClick: () => handleSnooze(item.id, 60, '1h'),
                                title: 'Snooze 1h',
                                style: { fontSize: '9px', padding: '1px 4px', borderRadius: '3px', border: `1px solid ${theme.border}`, background: theme.presetBg, color: theme.textSecondary, cursor: 'pointer' },
                              },
                              '+1h',
                            ),
                          )
                        ) : null,
                        createElement(
                          'span',
                          { style: { color: isCompleted ? '#10b981' : isDone ? '#94a3b8' : pColor, fontWeight: 600, marginLeft: '3px' } },
                          isCompleted ? t('status.completed', lang) : isDone ? t('status.done', lang) : t('status.pending', lang),
                        ),
                      ),
                    ),
                    item.description ? createElement('p', { style: { margin: '2px 0 0', fontSize: '10px', color: theme.textMuted } }, item.description) : null,
                  )
                }),
              ),
        ),
      ),

      // 新增/编辑弹窗 (Modal - 重新梳理单列与网格比例，彻底杜绝文字挤压与溢出)
      editingItem
        ? createElement(
            'div',
            {
              style: {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                backdropFilter: 'blur(6px)',
                animation: 'dshOverlayFade 0.18s ease-out forwards',
              },
            },
            createElement(
              'form',
              {
                onSubmit: handleSave,
                style: {
                  width: '460px',
                  maxWidth: '92vw',
                  backgroundColor: theme.bgModal,
                  borderRadius: '16px',
                  padding: '24px',
                  border: `1px solid ${theme.border}`,
                  boxShadow: '0 25px 35px -5px rgba(0,0,0,0.4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  animation: 'dshModalPop 0.24s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
                  maxHeight: '92vh',
                  overflowY: 'auto',
                },
              },
              createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                createElement('span', { style: { color: 'inherit', display: 'flex', alignItems: 'center' } }, createElement(CalendarClockIcon, { size: 16 })),
                createElement('h4', { style: { margin: 0, fontSize: '15px', color: theme.textPrimary, fontWeight: 600 } }, editingItem.id ? t('form.editTitle', lang) : t('form.title', lang)),
              ),
              // 事项标题
              createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('form.contentLabel', lang)),
                createElement('input', {
                  type: 'text',
                  placeholder: t('form.contentPlaceholder', lang),
                  value: editingItem.title || '',
                  onChange: (e: any) => setEditingItem({ ...editingItem, title: e.target.value }),
                  required: true,
                  autoFocus: true,
                  style: {
                    padding: '8px 12px',
                    backgroundColor: theme.inputBg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '8px',
                    color: theme.textPrimary,
                    fontSize: '13px',
                    outline: 'none',
                  },
                }),
              ),

              // 日期与时间选择器
              createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('form.timeLabel', lang)),
                createElement(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px' } },
                  createElement('input', {
                    type: 'date',
                    value: editingItem.date,
                    onChange: (e: any) => setEditingItem({ ...editingItem, date: e.target.value }),
                    required: true,
                    style: {
                      padding: '7px 10px',
                      backgroundColor: theme.inputBg,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '8px',
                      color: theme.textPrimary,
                      fontSize: '13px',
                      outline: 'none',
                    },
                  }),
                  createElement('input', {
                    type: 'time',
                    value: editingItem.time,
                    onChange: (e: any) => setEditingItem({ ...editingItem, time: e.target.value }),
                    required: true,
                    style: {
                      padding: '7px 10px',
                      backgroundColor: theme.inputBg,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '8px',
                      color: theme.textPrimary,
                      fontSize: '13px',
                      outline: 'none',
                    },
                  }),
                ),
                createElement(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '2px' } },
                  COMMON_TIME_PRESETS.map((preset) =>
                    createElement(
                      'button',
                      {
                        key: preset.time,
                        type: 'button',
                        className: 'dsh-btn-smooth',
                        onClick: () => setEditingItem({ ...editingItem, time: preset.time }),
                        style: {
                          fontSize: '11px',
                          padding: '2px 7px',
                          borderRadius: '5px',
                          border: editingItem.time === preset.time ? '1px solid #3b82f6' : `1px solid ${theme.border}`,
                          backgroundColor: editingItem.time === preset.time ? (isDark ? '#1e3a8a' : '#eff6ff') : theme.presetBg,
                          color: editingItem.time === preset.time ? '#3b82f6' : theme.presetText,
                          cursor: 'pointer',
                          fontWeight: editingItem.time === preset.time ? 600 : 400,
                        },
                      },
                      preset.label,
                    ),
                  ),
                ),
              ),

              // 消息推送渠道
              createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' } },
                createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('push.label', lang)),
                createElement(
                  'select',
                  {
                    value: editingItem.pushPlatform,
                    onChange: (e: any) => setEditingItem({ ...editingItem, pushPlatform: e.target.value }),
                    style: {
                      padding: '8px 10px',
                      backgroundColor: theme.inputBg,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '8px',
                      color: theme.textPrimary,
                      fontSize: '12px',
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                    },
                  },
                  createElement('option', { value: 'none' }, t('push.none', lang)),
                  createElement('option', { value: 'wecom-aibot' }, t('push.wecom', lang)),
                  createElement('option', { value: 'telegram' }, t('push.telegram', lang)),
                  createElement('option', { value: 'discord' }, t('push.discord', lang)),
                  createElement('option', { value: 'email' }, t('push.email', lang)),
                ),
              ),

              // 推送目标 (仅当选择了外部渠道时显示)
              editingItem.pushPlatform !== 'none'
                ? createElement(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' } },
                    createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('push.targetLabel', lang)),
                    createElement('input', {
                      type: 'text',
                      placeholder: t('push.targetPlaceholder', lang),
                      value: editingItem.pushTarget || '',
                      onChange: (e: any) => setEditingItem({ ...editingItem, pushTarget: e.target.value }),
                      style: {
                        padding: '8px 10px',
                        backgroundColor: theme.inputBg,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '8px',
                        color: theme.textPrimary,
                        fontSize: '12px',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                      },
                    }),
                  )
                : null,

              // 优先级与循环并排
              createElement(
                'div',
                { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
                createElement(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('priority.label', lang)),
                  createElement(
                    'select',
                    {
                      value: editingItem.priority,
                      onChange: (e: any) => setEditingItem({ ...editingItem, priority: e.target.value }),
                      style: {
                        padding: '7px 10px',
                        backgroundColor: theme.inputBg,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '8px',
                        color: theme.textPrimary,
                        fontSize: '12px',
                        outline: 'none',
                      },
                    },
                    createElement('option', { value: 'high' }, t('priority.high', lang)),
                    createElement('option', { value: 'medium' }, t('priority.medium', lang)),
                    createElement('option', { value: 'low' }, t('priority.low', lang)),
                  ),
                ),
                createElement(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('repeat.label', lang)),
                  createElement(
                    'select',
                    {
                      value: editingItem.repeat,
                      onChange: (e: any) => setEditingItem({ ...editingItem, repeat: e.target.value }),
                      style: {
                        padding: '7px 10px',
                        backgroundColor: theme.inputBg,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '8px',
                        color: theme.textPrimary,
                        fontSize: '12px',
                        outline: 'none',
                      },
                    },
                    createElement('option', { value: 'none' }, t('repeat.none', lang)),
                    createElement('option', { value: 'daily' }, t('repeat.daily', lang)),
                    createElement('option', { value: 'weekly' }, t('repeat.weekly', lang)),
                    createElement('option', { value: 'monthly' }, t('repeat.monthly', lang)),
                  ),
                ),
              ),

              // 详细备注
              createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                createElement('label', { style: { fontSize: '12px', fontWeight: 600, color: theme.textSecondary } }, t('form.descLabel', lang)),
                createElement('textarea', {
                  placeholder: t('form.descPlaceholder', lang),
                  value: editingItem.description || '',
                  onChange: (e: any) => setEditingItem({ ...editingItem, description: e.target.value }),
                  rows: 2,
                  style: {
                    padding: '7px 12px',
                    backgroundColor: theme.inputBg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '8px',
                    color: theme.textPrimary,
                    fontSize: '12px',
                    resize: 'none',
                    outline: 'none',
                  },
                }),
              ),

              // 底部按钮
              createElement(
                'div',
                { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' } },
                createElement('button', { type: 'button', className: 'dsh-btn-smooth', onClick: () => setEditingItem(null), style: { padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.textSecondary, cursor: 'pointer', fontSize: '12px', fontWeight: 500 } }, t('btn.cancel', lang)),
                createElement('button', { type: 'submit', className: 'dsh-btn-smooth', style: { padding: '6px 18px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '12px', boxShadow: '0 2px 6px rgba(37,99,235,0.35)' } }, t('btn.save', lang)),
              ),
            ),
          )
        : null,

      // Toast 提示
      toastMsg
        ? createElement(
            'div',
            {
              style: {
                position: 'absolute',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                padding: '8px 18px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.35)',
                zIndex: 10001,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                animation: 'dshToastSlide 0.22s ease-out forwards',
              },
            },
            createElement('span', null, toastMsg.text),
            toastMsg.showUndo ? (
              createElement(
                'button',
                {
                  onClick: handleUndo,
                  style: {
                    border: 'none',
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  },
                },
                t('btn.undo', lang),
              )
            ) : null,
          )
        : null,
    ),
  )
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
