import { useState } from 'react'

const ROLES = [
  { name: '总管', emoji: '🧭', desc: '拆解、分派、合并、验收' },
  { name: '研究员', emoji: '🔍', desc: '检索、来源分级、交叉验证' },
  { name: '工程师', emoji: '🛠', desc: '读改文件、跑命令、验证' },
  { name: '管家', emoji: '⏰', desc: '巡检、阈值判级、异常简报' },
  { name: '审稿人', emoji: '🧪', desc: '对抗审查：结论/引用/边界' },
  { name: '团队', emoji: '👥', desc: '总管 → 专家 → 审稿人' },
] as const

function applyRole(draft: string, name: string): string {
  const rest = draft.replace(/^\/tribot\s+\S+\s*/u, '')
  return `/tribot ${name} ${rest}`.trimEnd() + ' '
}

/**
 * Visible role picker in the composer dock, above the input. No trigger needed:
 * click the pill, choose a role, and the draft becomes `/tribot <role> `.
 */
export function RoleDock(props: any) {
  const [open, setOpen] = useState(false)
  const draft: string = props?.input?.draft ?? ''
  const active = ROLES.find((role) => draft.startsWith(`/tribot ${role.name}`))
  const label = active ? `${active.emoji} ${active.name}` : '选择 Bot 角色'

  const pick = (name: string) => {
    props?.inputActions?.setDraft?.(applyRole(draft, name))
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
      <span style={{ fontSize: 11, color: 'var(--dsh-color-text-tertiary, #8a8a8a)' }}>TriBot</span>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 26, padding: '0 10px', borderRadius: 13,
          border: '1px solid var(--dsh-color-border, #d8d2c4)',
          background: 'var(--dsh-color-bg-elevated, #fffdf7)',
          color: 'var(--dsh-color-text, #2b2a26)',
          fontSize: 12, cursor: 'pointer',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', bottom: 34, left: 48, zIndex: 50,
            width: 260, padding: 6, borderRadius: 10,
            border: '1px solid var(--dsh-color-border, #d8d2c4)',
            background: 'var(--dsh-color-bg-elevated, #fffdf7)',
            boxShadow: '0 12px 32px rgba(0,0,0,.18)',
          }}
        >
          {ROLES.map((role) => (
            <button
              key={role.name}
              type="button"
              role="menuitem"
              onClick={() => pick(role.name)}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 10,
                padding: '8px 10px', border: 0, borderRadius: 7,
                background: active?.name === role.name ? 'rgba(180,140,60,.12)' : 'transparent',
                color: 'inherit', textAlign: 'left', cursor: 'pointer',
              }}
            >
              <span style={{ width: 18, textAlign: 'center' }}>{role.emoji}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13 }}>{role.name}</span>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{role.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
