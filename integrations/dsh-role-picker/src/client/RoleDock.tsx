import { useState } from 'react'
import { en, zh } from './locales'

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

const ENABLE_KEY = 'tribot-role-picker:enabled'

function readEnabled(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(ENABLE_KEY) !== '0'
  } catch {
    return true
  }
}

function writeEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLE_KEY, value ? '1' : '0')
  } catch {
    /* 私有模式等场景下持久化失败不致命 */
  }
}

export function isPickerEnabled(): boolean {
  return readEnabled()
}

function applyRole(draft: string, canonical: string): string {
  const rest = draft.replace(/^\/tribot\s+\S+\s*/u, '')
  return `/tribot ${canonical} ${rest}`.trimEnd() + ' '
}

/**
 * Visible role picker in the composer dock. The pill sits on the chatbox's
 * left edge (same clearance/max-width as the composer card), follows the DSH
 * theme tokens and locale, and writes `/tribot <role> ` into the draft.
 * A switch next to the pill turns the picker (and the `#` trigger) on/off;
 * the choice persists in localStorage.
 */
export function RoleDock(props: any) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(readEnabled)
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
    writeEnabled(next)
    if (!next) setOpen(false)
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
