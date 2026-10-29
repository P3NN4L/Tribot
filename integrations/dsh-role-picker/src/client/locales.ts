/** Locale namespace for the TriBot role picker. */
export const NS = 'tribot-role-picker'

/** Simplified Chinese copy (the product copy). */
export const zh = {
  'choose': '选择角色',
  'chooseAria': '选择 TriBot 角色',
  'menuAria': 'TriBot 角色',
  'switchAria': '启用或停用 TriBot 角色选择',
  'role.dispatcher': '总管',
  'role.dispatcher.desc': '拆解、分派、合并、验收',
  'role.researcher': '研究员',
  'role.researcher.desc': '检索、来源分级、交叉验证',
  'role.engineer': '工程师',
  'role.engineer.desc': '读改文件、跑命令、验证',
  'role.steward': '管家',
  'role.steward.desc': '巡检、阈值判级、异常简报',
  'role.reviewer': '审稿人',
  'role.reviewer.desc': '对抗审查：结论 / 引用 / 边界',
  'role.team': '团队',
  'role.team.desc': '总管 → 专家 → 审稿人',
}

/** English copy. */
export const en: typeof zh = {
  'choose': 'Choose role',
  'chooseAria': 'Choose a TriBot role',
  'menuAria': 'TriBot roles',
  'switchAria': 'Enable or disable the TriBot role picker',
  'role.dispatcher': 'Dispatcher',
  'role.dispatcher.desc': 'Split, assign, merge, accept',
  'role.researcher': 'Researcher',
  'role.researcher.desc': 'Search, grade sources, cross-check',
  'role.engineer': 'Engineer',
  'role.engineer.desc': 'Read, edit, run, verify',
  'role.steward': 'Steward',
  'role.steward.desc': 'Inspect, grade, report exceptions',
  'role.reviewer': 'Reviewer',
  'role.reviewer.desc': 'Adversarial review: claims, citations, limits',
  'role.team': 'Team',
  'role.team.desc': 'Dispatcher → specialist → reviewer',
}
