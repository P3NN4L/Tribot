/**
 * Host half: register the TriBot skill from the bundled SKILL.md so a single
 * npm install delivers both the `/tribot` skill and the composer role picker.
 *
 * Deliberately fail-safe: the skill registry is optional. If it is not
 * reachable, this plugin must still mount (the composer picker does not
 * depend on it) instead of failing the whole bundle.
 */
import skillText from '../../../SKILL.md'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function field(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim()
}

export function apply(ctx: any): void {
  try {
    const skills = ctx?.skills ?? ctx?.get?.('skills')
    if (!skills?.register) {
      console.warn('[tribot-role-picker] skills service unavailable; skill not embedded')
      return
    }
    const parsed = skillText.match(FRONTMATTER)
    if (!parsed) {
      console.warn('[tribot-role-picker] SKILL.md is missing a frontmatter block')
      return
    }
    const [, frontmatter, body] = parsed
    skills.register({
      name: field(frontmatter, 'name') ?? 'tribot',
      description: field(frontmatter, 'description') ?? 'TriBot Bot 团队',
      whenToUse: field(frontmatter, 'whenToUse') ?? field(frontmatter, 'when_to_use'),
      invocation: { modelInvocable: true, userInvocable: true },
      content: body,
    })
  } catch (error: any) {
    console.warn('[tribot-role-picker] skill registration skipped:', error?.message ?? error)
  }
}
