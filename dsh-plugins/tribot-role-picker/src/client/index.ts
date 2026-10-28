/**
 * Client half: register a `#` input-trigger source in the DSH composer.
 *
 * Typing `#` opens the native floating picker with the six TriBot roles. Picking
 * one lands `/tribot <role> ` in the draft; DSH then loads the `tribot` skill and
 * the role name is visible in the message. No RPC, no host state.
 */
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['inputTriggers']

interface Role {
  id: string
  name: string
  description: string
}

const ROLES: readonly Role[] = [
  { id: 'dispatcher', name: '总管', description: '拆解、分派、合并、验收' },
  { id: 'researcher', name: '研究员', description: '检索、来源分级、交叉验证' },
  { id: 'engineer', name: '工程师', description: '读改文件、跑命令、验证' },
  { id: 'steward', name: '管家', description: '巡检、阈值判级、异常简报' },
  { id: 'reviewer', name: '审稿人', description: '对抗审查：结论/引用/边界' },
  { id: 'team', name: '团队', description: '总管 → 专家 → 审稿人 流水线' },
]

export function apply(ctx: Context): void {
  const inputTriggers = ctx.get('inputTriggers') as
    | { registerSource(source: unknown): () => void }
    | undefined
  if (!inputTriggers?.registerSource) {
    console.warn('[tribot-role-picker] inputTriggers service is unavailable')
    return
  }

  ctx.effect(
    () =>
      inputTriggers.registerSource({
        trigger: '#',
        name: 'tribot-role',
        candidates(_session: unknown, { query }: { query: string }) {
          const q = query.trim().toLowerCase()
          const rows = q
            ? ROLES.filter(
                (role) =>
                  role.id.includes(q) ||
                  role.name.includes(q) ||
                  role.description.includes(q),
              )
            : ROLES
          return rows.map((role) => ({
            name: role.name,
            value: role.id,
            description: role.description,
          }))
        },
        onPick({ candidate }: { candidate: { value?: string } }) {
          const role = ROLES.find((item) => item.id === candidate.value) ?? ROLES[0]
          return { text: `/tribot ${role.name} ` }
        },
      }),
    'tribot-role-picker: # source',
  )
}
