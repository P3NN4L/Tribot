import { useEffect, useState } from 'react'
import { en, zh } from './locales'

interface SaveTokenStats {
  totals?: { avoidedTokens?: number }
  reliefPct?: number
  cacheHitPct?: number
}

async function fetchStats(): Promise<SaveTokenStats | null> {
  try {
    if (typeof fetch === 'undefined') return null
    const res = await fetch('/save-token/api/dashboard', { credentials: 'same-origin' })
    if (!res.ok) return null
    const j = await res.json()
    if (!j || typeof j.reliefPct !== 'number') return null
    return j as SaveTokenStats
  } catch {
    return null
  }
}

function fmtTok(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

interface Role {
  id: string
  canonical: string
  emoji: string
}

const ROLES: readonly Role[] = [
  { id: 'dispatcher', canonical: '总管', emoji: '🧭' },
  { id: 'researcher', canonical: '研究员', emoji: '🔍' },
  { id: 'engineer', canonical: '工程师', emoji: '🛠' },
  { id: 'steward', canonical: '管家', emoji: '⏰' },
  { id: 'reviewer', canonical: '审稿人', emoji: '🧪' },
  { id: 'team', canonical: '团队', emoji: '👥' },
]

const GLOBAL_KEY = 'tribot-role-picker:enabled'

function sessionKey(sessionId?: string): string {
  return sessionId ? `${GLOBAL_KEY}:session:${sessionId}` : GLOBAL_KEY
}

/** Per-session state overrides the global default; new sessions inherit the default (on). */
function readEnabled(sessionId?: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    if (sessionId) {
      const own = localStorage.getItem(sessionKey(sessionId))
      if (own !== null) return own !== '0'
    }
    return localStorage.getItem(GLOBAL_KEY) !== '0'
  } catch {
    return true
  }
}

function writeEnabled(sessionId: string | undefined, value: boolean): void {
  try {
    localStorage.setItem(sessionKey(sessionId), value ? '1' : '0')
  } catch {
    /* 私有模式等场景下持久化失败不致命 */
  }
}

export function isPickerEnabled(sessionId?: string): boolean {
  return readEnabled(sessionId)
}

function applyRole(draft: string, canonical: string): string {
  const rest = draft.replace(/^\/tribot\s+\S+\s*/u, '')
  return `/tribot ${canonical} ${rest}`.trimEnd() + ' '
}

/**
 * Visible role picker in the composer dock. The pill sits on the chatbox's
 * left edge (same clearance/max-width as the composer card), follows the DSH
 * theme tokens and locale, and writes `/tribot <role> ` into the draft.
 * A switch next to the pill turns the picker UI (and the `#` trigger) on/off;
 * the plugin itself stays installed and listed — off only hides the UI and
 * cancels the active role via a draft marker.
 */
export function RoleDock(props: any) {
  const [open, setOpen] = useState(false)
  const sessionId: string | undefined = props?.sessionId
  const [enabled, setEnabled] = useState(() => readEnabled(sessionId))
  // 实时省 token 统计（来自 save-token 插件的官方 dashboard API）
  const [stats, setStats] = useState<SaveTokenStats | null>(null)
  useEffect(() => {
    let stop = false
    const tick = async () => {
      const s = await fetchStats()
      if (!stop && s) setStats(s)
    }
    void tick()
    const timer = setInterval(tick, 5000)
    return () => { stop = true; clearInterval(timer) }
  }, [])
  // 会话切换时重读该会话自己的开关记忆
  useEffect(() => {
    setEnabled(readEnabled(sessionId))
  }, [sessionId])
  const draft: string = props?.input?.draft ?? ''
  const matched = draft.match(/^\/tribot\s+(\S+)/u)
  const active = ROLES.find((role) => role.canonical === matched?.[1])

  const isZh = String(props?.locale ?? (typeof navigator === 'undefined' ? '' : navigator.language))
    .toLowerCase()
    .startsWith('zh')
  const fallback = isZh ? zh : en
  const t = (key: keyof typeof zh): string => props?.t?.(key) ?? fallback[key] ?? String(key)

  const toggleEnabled = () => {
    const next = !enabled
    setEnabled(next)
    writeEnabled(sessionId, next)
    if (!next) {
      setOpen(false)
      // 立即退出角色：往草稿填入停用标记，发送后模型按协议退出。
      // 开关是每会话记忆：只影响当前会话，其他会话互不影响。
      try {
        const draft: string = props?.input?.draft ?? ''
        const marker = '[TriBot 角色已停用，退出当前角色，恢复默认助手模式]'
        if (!draft.includes('[TriBot 角色已停用')) {
          props?.inputActions?.setDraft?.(draft + marker)
        }
      } catch {
        /* 无法写草稿时仅停用 UI */
      }
    }
  }

  const pick = (canonical: string) => {
    props?.inputActions?.setDraft?.(applyRole(draft, canonical))
    setOpen(false)
  }

  const switchButton = (
    <button
      type="button"
      className="tribot-role-switch"
      role="switch"
      aria-checked={enabled}
      aria-label={t('switchAria')}
      title={t('switchAria')}
      onClick={toggleEnabled}
    >
      <span className="tribot-role-track" aria-hidden>
        <span className="tribot-role-knob" />
      </span>
    </button>
  )

  if (!enabled) {
    // 停用态：胶囊和菜单都隐藏，只留开关本身，方便再打开
    return <div className="tribot-role-dock">{switchButton}</div>
  }

  return (
    <div className="tribot-role-dock">
      <button
        type="button"
        className="tribot-role-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('chooseAria')}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{active ? `${active.emoji} ${t(`role.${active.id}` as keyof typeof zh)}` : t('choose')}</span>
        <span className="tribot-role-caret" aria-hidden>▾</span>
      </button>
      {switchButton}
      {stats && (stats.totals?.avoidedTokens ?? 0) > 0 && (
        <span className="tribot-role-stats" title={t('statsTitle')}>
          ⚡ {t('statsSaved')} ≈{fmtTok(stats.totals?.avoidedTokens ?? 0)} tok（{stats.reliefPct}%）· {t('statsCache')} {stats.cacheHitPct}%
        </span>
      )}

      {open && (
        <div className="tribot-role-menu" role="menu" aria-label={t('menuAria')}>
          {ROLES.map((role) => (
            <button
              key={role.id}
              type="button"
              role="menuitemradio"
              aria-checked={active?.id === role.id}
              className="tribot-role-item"
              onClick={() => pick(role.canonical)}
            >
              <span className="tribot-role-emoji" aria-hidden>{role.emoji}</span>
              <span className="tribot-role-copy">
                <span className="tribot-role-name">{t(`role.${role.id}` as keyof typeof zh)}</span>
                <span className="tribot-role-desc">{t(`role.${role.id}.desc` as keyof typeof zh)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
