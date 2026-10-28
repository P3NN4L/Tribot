/**
 * Host half: register the TriBot skill from the bundled SKILL.md so a single
 * npm install delivers both the `/tribot` skill and the composer role picker.
 */
import skillText from '../../../SKILL.md'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function field(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim()
}

export const inject = ['skills']

export function apply(ctx: any): void {
  const parsed = skillText.match(FRONTMATTER)
  if (!parsed) {
    console.warn('[tribot-role-picker] SKILL.md is missing a frontmatter block')
    return
  }
  const [, frontmatter, body] = parsed
  ctx.skills.register({
    name: field(frontmatter, 'name') ?? 'tribot',
    description: field(frontmatter, 'description') ?? 'TriBot Bot 团队',
    whenToUse: field(frontmatter, 'whenToUse') ?? field(frontmatter, 'when_to_use'),
    invocation: { modelInvocable: true, userInvocable: true },
    content: body,
  })
}
