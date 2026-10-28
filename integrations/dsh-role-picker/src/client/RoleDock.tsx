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

function applyRole(draft: string, canonical: string): string {
  const rest = draft.replace(/^\/tribot\s+\S+\s*/u, '')
  return `/tribot ${canonical} ${rest}`.trimEnd() + ' '
}

/**
 * Visible role picker in the composer dock. The pill sits on the chatbox's
 * left edge (same clearance/max-width as the composer card), follows the DSH
 * theme tokens and locale, and writes `/tribot <role> ` into the draft.
 */
export function RoleDock(props: any) {
  const [open, setOpen] = useState(false)
  const draft: string = props?.input?.draft ?? ''
  const matched = draft.match(/^\/tribot\s+(\S+)/u)
  const active = ROLES.find((role) => role.canonical === matched?.[1])

  const isZh = String(props?.locale ?? (typeof navigator === 'undefined' ? '' : navigator.language))
    .toLowerCase()
    .startsWith('zh')
  const fallback = isZh ? zh : en
  const t = (key: keyof typeof zh): string => props?.t?.(key) ?? fallback[key] ?? String(key)

  const pick = (canonical: string) => {
    props?.inputActions?.setDraft?.(applyRole(draft, canonical))
    setOpen(false)
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
