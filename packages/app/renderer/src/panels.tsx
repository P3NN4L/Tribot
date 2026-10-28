import { useEffect, useState } from 'react';
import type {
  AppSettings, Bot, ModelInfo, PluginCatalog, PluginCategory, Routine, RoutineRun, SkillMeta, ThinkingEffort,
} from '@tribot/shared';
import { SKIN_PRESETS } from '@tribot/shared';
import { BotIcon } from './botIcons.js';
import { api, type KeyInfo, type ProviderPreset } from './api.js';

const THINKING_LABEL: Record<ThinkingEffort, string> = { fast: '快速', standard: '标准', deep: '深度' };

// ===== 管理面板：Bot 团队 / 技能 / 插件市场 / 定时任务 / 设置 =====

function PanelShell({ title, desc, onBack, children }: { title: string; desc?: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <button className="back" onClick={onBack}>← 返回</button>
        <h2>{title}</h2>
        {desc && <p className="panel-desc">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

const ALL_TOOL_NAMES = ['use_skill', 'list_skills', 'list_dir', 'read_file', 'read_document', 'write_file', 'run_command', 'http_fetch', 'web_search', 'mcp_list', 'mcp_call', 'browser', 'desktop', 'assign'];

// ---------- Bot 团队 ----------
export function BotsPanel({ bots, models, onChanged, onBack }: {
  bots: Bot[]; models: ModelInfo[]; onChanged: () => Promise<void>; onBack: () => void;
}) {
  const [editing, setEditing] = useState<Partial<Bot> | null>(null);
  const [msg, setMsg] = useState('');

  const startEdit = (b?: Bot) => setEditing(b ? { ...b } : { name: '', emoji: '🤖', role: '', systemPrompt: '', tools: ['*'] });
  const toggleTool = (t: string) => {
    if (!editing) return;
    let tools: string[];
    if (editing.tools?.includes('*')) {
      tools = ALL_TOOL_NAMES.filter((x) => x !== 'assign');
    } else {
      tools = editing.tools ?? [];
    }
    tools = tools.includes(t) ? tools.filter((x) => x !== t) : [...tools, t];
    if (tools.length === ALL_TOOL_NAMES.filter((x) => x !== 'assign').length) tools = ['*'];
    setEditing({ ...editing, tools });
  };
  const usesStar = editing?.tools?.includes('*') ?? false;

  const save = async () => {
    if (!editing?.name || !editing.systemPrompt) { setMsg('名字和职责提示词必填'); return; }
    try {
      if (editing.id) await api.updateBot(editing.id, editing);
      else await api.createBot(editing);
      setEditing(null);
      setMsg('');
      await onChanged();
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };

  return (
    <PanelShell title="Bot 团队" desc="每个 Bot 有名字、职责、记忆和工具白名单。总管负责分派，专家负责干活。" onBack={onBack}>
      <div className="bot-grid">
        {bots.map((b) => (
          <div key={b.id} className="bot-card">
            <div className="bot-emoji"><BotIcon role={b.role} name={b.name} size={20} /></div>
            <div className="bot-info">
              <b>{b.name}</b>{b.builtin && <span className="tag">内置</span>}
              <p>{b.role}</p>
              <p className="bot-model">
                {b.modelPref ? `锁定 ${b.modelPref}` : '模型自动路由'} · 思考 {b.thinking ? THINKING_LABEL[b.thinking] : '默认'}
              </p>
            </div>
            <div className="bot-actions">
              <button onClick={() => startEdit(b)}>编辑</button>
              {!b.builtin && <button className="danger" onClick={async () => { await api.deleteBot(b.id); await onChanged(); }}>删除</button>}
            </div>
          </div>
        ))}
        <button className="bot-card add" onClick={() => startEdit()}>＋ 新建 Bot</button>
      </div>

      {editing && (
        <div className="modal-mask" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing.id ? '编辑 Bot' : '新建 Bot'}</h3>
            <div className="form-row"><label>名字</label><input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="form-row"><label>Emoji</label><input value={editing.emoji ?? ''} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} /></div>
            <div className="form-row"><label>一句话职责</label><input value={editing.role ?? ''} onChange={(e) => setEditing({ ...editing, role: e.target.value })} /></div>
            <div className="form-row"><label>职责提示词（system prompt）</label>
              <textarea rows={6} value={editing.systemPrompt ?? ''} onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })} />
            </div>
            <div className="form-row"><label>工具白名单</label>
              <div className="tool-checks">
                <label className={usesStar ? 'on' : ''}><input type="checkbox" checked={usesStar} onChange={() => setEditing({ ...editing, tools: usesStar ? [] : ['*'] })} />全部（不含分派）</label>
                {ALL_TOOL_NAMES.map((t) => (
                  <label key={t} className={!usesStar && editing.tools?.includes(t) ? 'on' : ''}>
                    <input type="checkbox" disabled={usesStar} checked={usesStar || (editing.tools?.includes(t) ?? false)} onChange={() => toggleTool(t)} />{t}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row"><label>锁定模型（可选）</label>
              <select value={editing.modelPref ?? ''} onChange={(e) => setEditing({ ...editing, modelPref: e.target.value || undefined })}>
                <option value="">自动路由</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div className="form-row"><label>这个 Bot 的默认思考程度（可选）</label>
              <select value={editing.thinking ?? ''} onChange={(e) => setEditing({ ...editing, thinking: (e.target.value || undefined) as Bot['thinking'] })}>
                <option value="">跟随全局设置</option>
                <option value="fast">快速</option>
                <option value="standard">标准</option>
                <option value="deep">深度</option>
              </select>
            </div>
            {msg && <div className="error-bar">{msg}</div>}
            <div className="a-actions"><button className="approve" onClick={() => void save()}>保存</button><button onClick={() => setEditing(null)}>取消</button></div>
          </div>
        </div>
      )}
    </PanelShell>
  );
}

// ---------- 技能 ----------
export function SkillsPanel({ onChanged, onBack }: { onChanged: () => void; onBack: () => void }) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [dirInput, setDirInput] = useState('');

  const reload = async () => {
    const [s1, s2] = await Promise.all([api.skills(), api.settings()]);
    setSkills(s1.skills);
    setSettings(s2.settings);
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);
  void onChanged;

  return (
    <PanelShell
      title="技能库"
      desc="兼容开放 SKILL.md 格式（ZCode / Claude Code / 社区技能包）：任意「目录 + SKILL.md（frontmatter 写 name/description）」放入技能目录即可被 Bot 使用。"
      onBack={onBack}
    >
      <div className="row-gap">
        <button className="approve" onClick={async () => { const r = await api.scanSkills(); setSkills(r.skills); setMsg(`已扫描：${r.count} 个技能`); }}>重新扫描</button>
        <input placeholder="添加技能目录（绝对路径）" value={dirInput} onChange={(e) => setDirInput(e.target.value)} style={{ flex: 1 }} />
        <button onClick={async () => {
          if (!dirInput.trim() || !settings) return;
          const merged = { ...settings, skillDirs: [...new Set([...settings.skillDirs, dirInput.trim()])] };
          await api.saveSettings(merged);
          setDirInput('');
          await reload();
          const r = await api.scanSkills();
          setSkills(r.skills);
        }}>添加并扫描</button>
      </div>
      {msg && <div className="ok-bar">{msg}</div>}
      {settings && settings.skillDirs.length > 0 && (
        <div className="dir-list">
          自定义目录：{settings.skillDirs.map((d, i) => (
            <span key={d} className="dir-chip">
              {d}
              <a onClick={async () => {
                const merged = { ...settings, skillDirs: settings.skillDirs.filter((_, j) => j !== i) };
                await api.saveSettings(merged);
                await reload();
              }}>✕</a>
            </span>
          ))}
        </div>
      )}
      <div className="skill-list">
        {skills.length === 0 && <p className="muted">还没有技能。把技能包放进 data/skills/ 目录（或上面的自定义目录），然后点「重新扫描」。</p>}
        {skills.map((s) => (
          <div key={s.id} className="skill-card">
            <div className="skill-info">
              <b>{s.name}</b> {s.hasScripts && <span className="tag">带脚本</span>}
              <p title={s.dir}>{s.description}</p>
              <code className="skill-dir">{s.dir}</code>
            </div>
            <label className="switch">
              <input type="checkbox" checked={s.enabled} onChange={async (e) => { await api.toggleSkill(s.id, e.target.checked); await reload(); }} />
              启用
            </label>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- 定时任务 ----------
export function RoutinesPanel({ onOpenSession, onBack }: { onOpenSession: (id: string) => Promise<void>; onBack: () => void }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [bots, setBots] = useState<Array<{ id: string; name: string; emoji: string }>>([]);
  const [form, setForm] = useState({ name: '', schedule: '0 9 * * *', botId: '', prompt: '', offpeakOnly: false });
  const [msg, setMsg] = useState('');

  const reload = async () => {
    const r = await api.routines();
    setRoutines(r.routines);
    setRuns(r.runs);
    setBots(r.bots);
    setForm((f) => ({ ...f, botId: f.botId || r.bots[0]?.id || '' }));
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  return (
    <PanelShell title="定时任务" desc="cron 五段式（本地时区）。到点后台静默执行，结果落会话并推系统通知。" onBack={onBack}>
      <div className="routine-form">
        <input placeholder="名字（如：晨报）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="cron（如 0 9 * * 1-5 = 工作日 9 点）" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
        <select value={form.botId} onChange={(e) => setForm({ ...form, botId: e.target.value })}>
          {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input placeholder="要执行的指令（如：搜索今日 AI 大新闻，出 5 条简报）" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <label className="routine-offpeak">
          <input
            type="checkbox"
            checked={form.offpeakOnly}
            onChange={(e) => setForm({ ...form, offpeakOnly: e.target.checked })}
          />
          只在 DeepSeek 低谷跑（半价）
        </label>
        <button className="approve" onClick={async () => {
          try {
            await api.createRoutine(form);
            setForm({ name: '', schedule: '0 9 * * *', botId: bots[0]?.id ?? '', prompt: '', offpeakOnly: false });
            setMsg('已创建');
            await reload();
          } catch (e: any) { setMsg(String(e?.message ?? e)); }
        }}>创建</button>
      </div>
      {msg && <div className="ok-bar">{msg}</div>}
      <div className="routine-list">
        {routines.length === 0 && <p className="muted">还没有定时任务。</p>}
        {routines.map((r) => (
          <div key={r.id} className="routine-card">
            <div className="r-info">
              <b>{r.name}</b>
              <code>{r.schedule}</code>
              <span>→ {bots.find((b) => b.id === r.botId)?.name ?? r.botId.slice(0, 6)}</span>
              <span className={`r-status ${r.lastStatus ?? ''}`}>{r.enabled ? (r.lastStatus ?? '待运行') : '已停用'}</span>
              {r.offpeakOnly && <span className="r-offpeak">低谷</span>}
              <p>{r.prompt.slice(0, 90)}</p>
            </div>
            <div className="r-actions">
              <button onClick={async () => { setMsg('执行中…'); const res = await api.runRoutine(r.id); setMsg(`${res.status}: ${res.summary.slice(0, 120)}`); await reload(); }}>立即运行</button>
              <button onClick={async () => { await api.updateRoutine(r.id, { enabled: !r.enabled }); await reload(); }}>{r.enabled ? '停用' : '启用'}</button>
              <button onClick={async () => { await api.updateRoutine(r.id, { offpeakOnly: !r.offpeakOnly }); await reload(); }}>{r.offpeakOnly ? '低谷:开' : '低谷:关'}</button>
              <button onClick={() => void onOpenSession(r.sessionId)}>看会话</button>
              <button className="danger" onClick={async () => { await api.deleteRoutine(r.id); await reload(); }}>删除</button>
            </div>
          </div>
        ))}
      </div>
      {runs.length > 0 && (
        <>
          <h3 className="section-title">最近执行</h3>
          <div className="runs">
            {runs.slice(0, 10).map((run) => (
              <div key={run.id} className={`run ${run.status}`}>
                <code>{new Date(run.ts).toLocaleString('zh-CN')}</code>
                <span>{run.summary.slice(0, 100)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  );
}


// ---------- 设置 ----------
const PIE_COLORS = ['#E3B261', '#7FB3A6', '#C98B7A', '#8A9BD3', '#B9A26B', '#8FAE6B', '#C77FA0', '#6FA8C8'];

function fmtN(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function UsagePie({ models }: { models: Array<{ model: string; totalTokens: number }> }) {
  const total = models.reduce((n, m) => n + m.totalTokens, 0);
  if (total <= 0) return <p className="muted">还没有用量记录。</p>;
  let acc = 0;
  const r = 40;
  const C = 2 * Math.PI * r;
  return (
    <div className="usage-chart">
      <svg viewBox="0 0 100 100" className="usage-pie" role="img" aria-label="按模型分部的 token 用量">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="16" />
        {models.map((m, i) => {
          const frac = m.totalTokens / total;
          const dash = frac * C;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle
              key={m.model}
              cx="50" cy="50" r={r} fill="none"
              stroke={PIE_COLORS[i % PIE_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
            >
              <title>{`${m.model}：${m.totalTokens} tokens（${Math.round(frac * 100)}%）`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="usage-legend">
        {models.map((m, i) => (
          <div className="ul-row" key={m.model}>
            <i style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
            <b>{m.model.replace(/^MiniMax[-_ ]?/i, '')}</b>
            <span>{fmtN(m.totalTokens)} tok</span>
            <em>{Math.round((m.totalTokens / total) * 100)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState<KeyInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [credFile, setCredFile] = useState('');
  const [customs, setCustoms] = useState<NonNullable<Awaited<ReturnType<typeof api.credentials>>['customProviders']>>([]);
  const [draft, setDraft] = useState<Record<string, { apiKey?: string; baseURL?: string }>>({});
  const [testing, setTesting] = useState('');
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState('');
  const [addMsg, setAddMsg] = useState('');
  const [form, setForm] = useState({ label: '', id: '', baseURL: '', apiKey: '', models: '' });
  const [tab, setTab] = useState<'general' | 'models' | 'permissions' | 'usage' | 'about'>('general');
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usageStats>> | null>(null);
  useEffect(() => {
    if (tab !== 'usage') return;
    void api.usageStats().then(setUsage).catch(() => setUsage(null));
  }, [tab]);
  const [activeProvider, setActiveProvider] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [modelPick, setModelPick] = useState<{ id: string; ids: string[]; selected: string[] } | null>(null);
  const [pickBusy, setPickBusy] = useState('');
  const [pickMsg, setPickMsg] = useState('');

  const loadCreds = async () => {
    const r = await api.credentials();
    setCreds(r.credentials);
    setCredFile(r.file);
    setCustoms(r.customProviders ?? []);
    setDraft(Object.fromEntries(r.credentials.map((c) => [c.id, { apiKey: '', baseURL: c.baseURL }])));
  };

  useEffect(() => {
    void api.settings().then(({ settings }) => setSettings(settings));
    void loadCreds().catch(() => {});
    void api.providerPresets().then((r) => setPresets(r.presets)).catch(() => {});
    void api.providers().then((r) => setModels(r.models)).catch(() => {});
  }, []);

  useEffect(() => {
    if (creds.length === 0) return;
    // 没有「默认供应商」：只在用户已经选过、或存在已配置项时才自动选中
    if (activeProvider && creds.some((c) => c.id === activeProvider)) return;
    const configured = creds.find((c) => c.hasKey)
      ?? creds.find((c) => (customs ?? []).some((x) => x.id === c.id));
    setActiveProvider(configured?.id ?? '');
  }, [creds, customs, activeProvider]);
  if (!settings) return <div className="panel">加载中…</div>;

  const patchDraft = (id: string, patch: { apiKey?: string; baseURL?: string }) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? {}), ...patch } }));

  const saveCred = async (id: string) => {
    const d = draft[id] ?? {};
    try {
      const r = await api.saveCredential(id, {
        ...(d.apiKey?.trim() ? { apiKey: d.apiKey.trim() } : {}),
        ...(d.baseURL !== undefined ? { baseURL: d.baseURL } : {}),
      });
      setCreds(r.credentials);
      setCredFile(r.file);
      const fresh = r.credentials.find((c) => c.id === id);
      setDraft((prev) => ({ ...prev, [id]: { apiKey: '', baseURL: fresh?.baseURL } }));
      setTestMsg((m) => ({ ...m, [id]: { ok: true, text: '已保存，下一轮对话生效' } }));
      window.dispatchEvent(new Event('tribot:settings-changed'));
    } catch (e: any) {
      setTestMsg((m) => ({ ...m, [id]: { ok: false, text: String(e?.message ?? e) } }));
    }
  };

  const clearCred = async (id: string) => {
    try {
      const r = await api.saveCredential(id, { apiKey: '' });
      setCreds(r.credentials);
      setDraft((prev) => ({ ...prev, [id]: { apiKey: '', baseURL: r.credentials.find((c) => c.id === id)?.baseURL } }));
      setTestMsg((m) => ({ ...m, [id]: { ok: true, text: '已清除（若 .env 里有同名 Key 会退回用它）' } }));
    } catch (e: any) {
      setTestMsg((m) => ({ ...m, [id]: { ok: false, text: String(e?.message ?? e) } }));
    }
  };

  const testCred = async (id: string) => {
    const d = draft[id] ?? {};
    setTesting(id);
    setTestMsg((m) => ({ ...m, [id]: { ok: true, text: '测试中…' } }));
    try {
      const r = await api.testCredential(id, {
        ...(d.apiKey?.trim() ? { apiKey: d.apiKey.trim() } : {}),
        ...(d.baseURL ? { baseURL: d.baseURL } : {}),
      });
      setTestMsg((m) => ({ ...m, [id]: { ok: r.ok, text: r.message } }));
    } catch (e: any) {
      setTestMsg((m) => ({ ...m, [id]: { ok: false, text: String(e?.message ?? e) } }));
    } finally {
      setTesting('');
    }
  };

  const submitProvider = async () => {
    if (!form.label.trim() || !form.baseURL.trim() || !form.models.trim()) {
      setAddMsg('显示名 / Base URL / 模型 都要填');
      return;
    }
    setAddBusy('add');
    setAddMsg('');
    try {
      const res = await api.addProvider({
        id: form.id.trim() || undefined,
        label: form.label.trim(),
        baseURL: form.baseURL.trim(),
        apiKey: form.apiKey.trim() || undefined,
        models: form.models.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).map((id) => ({ id })),
      });
      setAddMsg('已添加，模型已并入路由/对比/手动选择');
      setForm({ label: '', id: '', baseURL: '', apiKey: '', models: '' });
      setAdding(false);
      await loadCreds();
      const created = (res as { provider?: { id?: string } }).provider;
      if (created?.id) setActiveProvider(created.id);
    } catch (e: any) {
      setAddMsg(String(e?.message ?? e));
    } finally {
      setAddBusy('');
    }
  };

  const pullModels = async () => {
    const id = form.id.trim() || form.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
    setAddBusy('pull');
    setAddMsg('');
    try {
      const r = await api.fetchProviderModels(id, {
        baseURL: form.baseURL.trim(),
        apiKey: form.apiKey.trim() || undefined,
      });
      setForm((f) => ({ ...f, models: r.models.join('\n') }));
      setAddMsg(`拉到 ${r.models.length} 个模型，确认后点「添加」`);
    } catch (e: any) {
      setAddMsg(String(e?.message ?? e));
    } finally {
      setAddBusy('');
    }
  };

  const removeProvider = async (id: string) => {
    if (!window.confirm(`删除供应商「${id}」？它下面的模型会从路由里移除。`)) return;
    try {
      await api.deleteProvider(id);
      await loadCreds();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    }
  };

  const grants = settings.grants ?? [];

  // 只显示「已配置 / 自定义」的供应商；没有默认项
  const configured = creds.filter((c) => c.hasKey || (customs ?? []).some((x) => x.id === c.id));
  const activeCred = creds.find((c) => c.id === activeProvider);
  const visibleCreds = activeCred && !configured.some((c) => c.id === activeCred.id)
    ? [...configured, activeCred]
    : configured;

  // 可用模型 = 用户在各供应商「拉取模型」后勾选保存的那些（catalogs）
  const catalogs = settings?.models?.catalogs ?? {};
  const pulledModels: ModelInfo[] = Object.entries(catalogs).flatMap(([pid, ids]) =>
    (ids ?? []).map((id) => models.find((m) => m.provider === pid && m.id === id)
      ?? ({ id, provider: pid, label: id, tier: 'balanced' } as ModelInfo)),
  ).filter((m) => !!creds.find((c) => c.id === m.provider)?.hasKey);
  const enabledModels = settings?.models?.enabled ?? null;
  const isModelOn = (id: string) => !enabledModels || enabledModels.includes(id);
  const allModelIds = pulledModels.map((m) => m.id);
  const toggleModel = (id: string) => {
    if (!settings) return;
    const cur = enabledModels ? enabledModels.slice() : allModelIds.slice();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setSettings({
      ...settings,
      models: { ...settings.models, enabled: next.length === allModelIds.length ? null : next },
    });
  };
  const setAllModels = (on: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, models: { ...settings.models, enabled: on ? null : [] } });
  };
  const modelGroups = pulledModels.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  const choosePreset = (p: ProviderPreset) => {
    setPickerOpen(false);
    if (p.builtin) {
      // 内置供应商：模型已在注册表里，只需填 Key
      setActiveProvider(p.id);
      setDraft((d) => ({ ...d, [p.id]: { ...(d[p.id] ?? {}), baseURL: p.baseURL } }));
      return;
    }
    setForm({
      label: p.label,
      id: p.id,
      baseURL: p.baseURL,
      apiKey: '',
      models: p.models.map((m) => m.id).join('\n'),
    });
    setAdding(true);
  };

  const pullModelsFor = async (id: string) => {
    setPickBusy(id);
    setPickMsg('');
    try {
      // 直接用输入框里的 Key/Base URL，不必先保存
      const d = draft[id] ?? {};
      const r = await api.fetchProviderModels(id, {
        apiKey: d.apiKey?.trim() || undefined,
        baseURL: d.baseURL?.trim() || undefined,
      });
      const saved = settings.models?.catalogs?.[id];
      setModelPick({
        id,
        ids: r.models,
        selected: saved && saved.length > 0 ? saved.filter((x) => r.models.includes(x)) : r.models,
      });
    } catch (e: any) {
      setPickMsg(String(e?.message ?? e));
    } finally {
      setPickBusy(''); // 清空 busy 让按钮恢复
    }
  };

  const togglePick = (id: string) => {
    setModelPick((p) => (p ? {
      ...p,
      selected: p.selected.includes(id) ? p.selected.filter((x) => x !== id) : [...p.selected, id],
    } : p));
  };

  const savePick = async () => {
    if (!modelPick) return;
    const catalogs = { ...(settings.models?.catalogs ?? {}), [modelPick.id]: modelPick.selected };
    const next = { ...settings, models: { ...settings.models, catalogs, enabled: null } };
    setSettings(next);
    const picked = modelPick;
    setModelPick(null);
    try {
      // 立即持久化：不等「保存设置」，可用模型马上刷新
      const r = await api.saveSettings(next);
      setSettings(r.settings);
      const p = await api.providers();
      setModels(p.models);
      setMsg(`已保存 ${picked.selected.length} 个模型，可用模型已更新`);
      window.dispatchEvent(new Event('tribot:settings-changed'));
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    }
  };

  const setLimit = (p: string, field: 'window5hTokens' | 'weeklyTokens', v: string) => {
    const num = v === '' ? undefined : Number(v);
    setSettings({
      ...settings,
      planLimits: { ...settings.planLimits, [p]: { ...settings.planLimits[p], [field]: Number.isFinite(num as number) ? num : undefined } },
    });
  };

  const onSkinUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 6 * 1024 * 1024) {
      setMsg('图片太大（上限 6MB）');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    try {
      const res = await api.uploadSkin(dataUrl);
      setSettings(res.settings);
      window.dispatchEvent(new CustomEvent('tribot:skin', { detail: res.settings.skin }));
      setMsg('皮肤已更新');
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    }
  };

  const removeSkin = async () => {
    try {
      const res = await api.deleteSkin();
      setSettings(res.settings);
      window.dispatchEvent(new CustomEvent('tribot:skin', { detail: res.settings.skin }));
      setMsg('皮肤已移除');
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    }
  };

  const patchSkin = (patch: Partial<AppSettings['skin']>) => {
    if (!settings) return;
    const next = { ...settings.skin, ...patch };
    setSettings({ ...settings, skin: next });
    window.dispatchEvent(new CustomEvent('tribot:skin', { detail: next }));
  };

  const revoke = async (id: string) => {
    const r = await api.deleteGrant(id);
    setSettings({ ...settings, grants: r.grants });
  };

  return (
    <PanelShell title="设置" desc="权限分级、思考程度、套餐限额、命令白名单。权限决定 Bot 能自己走多远，审批决定哪一步要问你。" onBack={onBack}>
      <div className="settings-tabs">
        {([
          ['general', '通用'],
          ['models', '模型与凭证'],
          ['permissions', '权限与工具'],
          ['usage', '用量统计'],
          ['about', '关于'],
        ] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="settings-grid">
        {tab === 'general' && (
          <>
            <section className="wide">
              <h3>外观与思考</h3>
              <div className="perm-grid">
                <div className="perm-field">
                  <label>外观</label>
                  <select
                    value={settings.theme ?? 'auto'}
                    onChange={(e) => {
                      const t = e.target.value as AppSettings['theme'];
                      setSettings({ ...settings, theme: t });
                      document.documentElement.dataset.theme = t === 'auto'
                        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
                        : t;
                      window.dispatchEvent(new CustomEvent('tribot:theme', { detail: t }));
                    }}
                  >
                    <option value="auto">跟随系统</option>
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </select>
                </div>
                <div className="perm-field">
                  <label>默认思考程度</label>
                  <select value={settings.thinking?.default ?? 'standard'} onChange={(e) => setSettings({ ...settings, thinking: { default: e.target.value as ThinkingEffort } })}>
                    <option value="fast">快速 —— 直接给结论</option>
                    <option value="standard">标准 —— 先拆解再执行</option>
                    <option value="deep">深度 —— 多步推理 + 交叉验证</option>
                  </select>
                </div>
              </div>
              <p className="perm-note">
                思考程度会改系统提示、温度（0.2 / 0.5 / 0.65）和工具轮次上限（30 / 100 / 300）；每个 Bot 也可以单独覆盖。
              </p>
            </section>

            <section className="wide">
              <h3>皮肤</h3>
              <div className="skin-presets">
                {SKIN_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`skin-swatch ${settings.skin?.enabled && settings.skin?.preset === p.id ? 'on' : ''}`}
                    style={{ backgroundImage: p.css }}
                    title={p.label}
                    onClick={() => patchSkin({ enabled: true, preset: p.id, file: undefined })}
                  >
                    <span>{p.label}</span>
                  </button>
                ))}
                <button
                  className={`skin-swatch none ${!settings.skin?.enabled ? 'on' : ''}`}
                  onClick={() => patchSkin({ enabled: false, preset: undefined, file: undefined })}
                >
                  <span>无</span>
                </button>
              </div>
              <div className="skin-row">
                {settings.skin?.file ? (
                  <img className="skin-preview" src={api.skinUrl(settings.skin.file)} alt="皮肤预览" />
                ) : (
                  <div className="skin-preview empty">还没有图片</div>
                )}
                <div className="skin-controls">
                  <label className="skin-upload">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => void onSkinUpload(e)}
                    />
                    {settings.skin?.file ? '换一张图' : '上传图片'}
                  </label>
                  <div className="skin-slider">
                    <span>不透明度</span>
                    <input
                      type="range" min={5} max={80}
                      value={Math.round((settings.skin?.opacity ?? 0.32) * 100)}
                      onChange={(e) => patchSkin({ opacity: Number(e.target.value) / 100 })}
                    />
                    <b>{Math.round((settings.skin?.opacity ?? 0.32) * 100)}%</b>
                  </div>
                  <div className="skin-slider">
                    <span>模糊</span>
                    <input
                      type="range" min={0} max={20}
                      value={settings.skin?.blur ?? 0}
                      onChange={(e) => patchSkin({ blur: Number(e.target.value) })}
                    />
                    <b>{settings.skin?.blur ?? 0}px</b>
                  </div>
                  {settings.skin?.file && (
                    <button className="danger" onClick={() => void removeSkin()}>移除皮肤</button>
                  )}
                  <p className="perm-note">
                    图片只存本机 <code>data/skins</code>，支持 PNG / JPEG / WebP，上限 6MB。调完点「保存设置」。
                  </p>
                </div>
              </div>
            </section>

            <section className="wide">
              <h3>数据与凭证</h3>              <div className="settings-paths">
                <div><span>凭证</span><code>{credFile || 'data/credentials.json'}</code></div>
                <div><span>.env</span><code>项目根 .env（优先级低于凭证文件）</code></div>
                <div><span>数据</span><code>data/tribot.db · data/skills · data/tasks · data/tool-outputs</code></div>
              </div>
              <p className="perm-note">全部在本机。界面只回显 Key 尾号，完整 Key 不会进渲染进程。</p>
            </section>
          </>
        )}

        {tab === 'models' && (
          <section className="wide">
            <h3>模型服务</h3>
          {pickerOpen ? (
            <div className="provider-presets">
              <div className="pp-head">
                <b>选择供应商</b>
                <span>{presets.length} 个预设</span>
                <button className="icon-btn" onClick={() => setPickerOpen(false)}>✕</button>
              </div>
              <div className="pp-grid">
                {presets.map((p) => (
                  <button key={p.id} className="pp-item" onClick={() => choosePreset(p)}>
                    <b>{p.label}</b>
                    <span>{p.note ?? p.baseURL.replace(/^https?:\/\//, '')}</span>
                    <em>{p.kind === 'tool' ? '工具' : p.builtin ? '内置' : '预设'}</em>
                  </button>
                ))}
                <button
                  className="pp-item"
                  onClick={() => {
                    setPickerOpen(false);
                    setForm({ label: '', id: '', baseURL: '', apiKey: '', models: '' });
                    setAdding(true);
                  }}
                >
                  <b>自定义 OpenAI 兼容</b>
                  <span>手动填 Base URL 和模型 ID</span>
                  <em>自定义</em>
                </button>
              </div>
            </div>
          ) : visibleCreds.length === 0 && !adding ? (
            <div className="provider-empty">
              <b>还没有配置供应商</b>
              <p>从预设里选一个（DeepSeek / GLM / Kimi / OpenAI / 本地 Ollama…），或自定义 OpenAI 兼容服务。</p>
              <button className="approve" onClick={() => setPickerOpen(true)}>选择供应商</button>
            </div>
          ) : (
            <div className="provider-picker">
              <label>选择供应商</label>
              <select value={activeProvider} onChange={(e) => setActiveProvider(e.target.value)}>
                {visibleCreds.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}{c.hasKey ? '' : '（未配置）'}{c.billing === 'tool' ? '（工具）' : ''}
                  </option>
                ))}
              </select>
              <button className="pp-add" onClick={() => setPickerOpen(true)} title="添加供应商">＋</button>
              <span className="provider-summary">{configured.length} 个已配置</span>
            </div>
          )}
          <div className="provider-list">
            {visibleCreds.filter((c) => c.id === activeProvider).map((c) => {
              const d = draft[c.id] ?? {};
              const tm = testMsg[c.id];
              const isCustom = customs.some((x) => x.id === c.id);
              return (
                <div className="provider-card" key={c.id}>
                  <div className="provider-head">
                    <div className="provider-title">
                      <b>{c.label}</b>
                      {isCustom && <span className="provider-badge custom">自定义</span>}
                      <span className={`provider-badge ${c.billing}`}>
                        {c.billing === 'subscription' ? '订阅制' : c.billing === 'payg' ? '按量付费' : '联网搜索'}
                      </span>
                      {c.models > 0 && <span className="provider-models">{c.models} 个模型</span>}
                    </div>
                    <span
                      className={`provider-state ${c.hasKey ? 'ok' : ''}`}
                      title={c.hasKey ? [c.hint, c.source === 'env' ? '来自 .env' : ''].filter(Boolean).join(' · ') : '未配置 Key'}
                    >
                      {c.hasKey ? '已配置' : '未配置'}
                    </span>
                  </div>

                  <div className="provider-fields">
                    <div className="pf">
                      <label>API Key</label>
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={c.hasKey ? '已保存，输入新 Key 覆盖' : '粘贴 API Key'}
                        value={d.apiKey ?? ''}
                        onChange={(e) => patchDraft(c.id, { apiKey: e.target.value })}
                      />
                    </div>
                    <div className="pf">
                      <label>Base URL</label>
                      <input
                        spellCheck={false}
                        placeholder={c.defaultBaseURL}
                        value={d.baseURL ?? ''}
                        onChange={(e) => patchDraft(c.id, { baseURL: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="provider-actions">
                    <button className="approve" onClick={() => void saveCred(c.id)}>保存</button>
                    <button onClick={() => void testCred(c.id)} disabled={testing === c.id}>
                      {testing === c.id ? '测试中…' : '测试连接'}
                    </button>
                    <button onClick={() => void pullModelsFor(c.id)} disabled={pickBusy === c.id}>
                      {pickBusy === c.id ? '拉取中…' : '拉取模型'}
                    </button>
                    {c.source === 'credentials' && (
                      <button className="danger" onClick={() => void clearCred(c.id)}>清除</button>
                    )}
                    {isCustom && (
                      <button className="danger" onClick={() => void removeProvider(c.id)}>删除</button>
                    )}
                    {tm && <span className={`provider-msg ${tm.ok ? 'ok' : 'err'}`}>{tm.text}</span>}
                  </div>

                  {modelPick?.id === c.id && (
                    <div className="model-pick">
                      <div className="mp-head">
                        <b>选择要显示的模型</b>
                        <span>{modelPick.selected.length}/{modelPick.ids.length}</span>
                      </div>
                      <div className="mp-list">
                        {modelPick.ids.map((id) => (
                          <label key={id} className="mp-item">
                            <input
                              type="checkbox"
                              checked={modelPick.selected.includes(id)}
                              onChange={() => togglePick(id)}
                            />
                            <span>{id}</span>
                          </label>
                        ))}
                        {modelPick.ids.length === 0 && <p className="muted">这家 /models 没有返回模型。</p>}
                      </div>
                      <div className="mp-actions">
                        <button onClick={() => setModelPick({ ...modelPick, selected: modelPick.ids })}>全选</button>
                        <button className="approve" onClick={savePick} disabled={modelPick.selected.length === 0}>保存选择</button>
                        <button onClick={() => { setModelPick(null); setPickMsg(''); }}>取消</button>
                      </div>
                      {pickMsg && <p className="provider-msg err">{pickMsg}</p>}
                    </div>
                  )}
                </div>
              );
            })}

            {adding ? (
              <div className="provider-card add-provider">
                <div className="provider-head">
                  <div className="provider-title"><b>添加供应商</b><span className="provider-badge custom">OpenAI 兼容</span></div>
                  <button className="icon-btn" onClick={() => { setAdding(false); setAddMsg(''); }} title="取消">✕</button>
                </div>
                <div className="provider-fields">
                  <div className="pf">
                    <label>显示名</label>
                    <input value={form.label} placeholder="Kimi" onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </div>
                  <div className="pf">
                    <label>标识（留空自动生成）</label>
                    <input value={form.id} placeholder="kimi" onChange={(e) => setForm({ ...form, id: e.target.value })} />
                  </div>
                </div>
                <div className="provider-fields">
                  <div className="pf">
                    <label>Base URL（OpenAI 兼容）</label>
                    <input value={form.baseURL} placeholder="https://api.moonshot.cn/v1" onChange={(e) => setForm({ ...form, baseURL: e.target.value })} />
                  </div>
                  <div className="pf">
                    <label>API Key</label>
                    <input
                      type="password" autoComplete="off" spellCheck={false}
                      value={form.apiKey} placeholder="sk-…"
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    />
                  </div>
                </div>
                <div className="pf">
                  <label>模型 ID（每行一个，或点「拉取模型」自动填）</label>
                  <textarea
                    rows={3}
                    value={form.models}
                    placeholder={'kimi-k2\nkimi-k2-turbo'}
                    onChange={(e) => setForm({ ...form, models: e.target.value })}
                  />
                </div>
                <div className="provider-actions">
                  <button onClick={() => void pullModels()} disabled={addBusy !== '' || !form.baseURL.trim()}>
                    {addBusy === 'pull' ? '拉取中…' : '拉取模型'}
                  </button>
                  <button className="approve" onClick={() => void submitProvider()} disabled={addBusy !== ''}>
                    {addBusy === 'add' ? '添加中…' : '添加'}
                  </button>
                  {addMsg && <span className="provider-msg">{addMsg}</span>}
                </div>
              </div>
            ) : (
              <button className="add-provider-btn" onClick={() => setPickerOpen(true)}>
                ＋ 添加供应商（Kimi / OpenAI / 本地 Ollama…）
              </button>
            )}
          </div>
        </section>
        )}

        {tab === 'permissions' && (
        <section className="wide">
          <h3>权限与审批</h3>
          <div className="perm-grid">
            <div className="perm-field">
              <label>沙箱分级</label>
              <select value={settings.sandbox} onChange={(e) => setSettings({ ...settings, sandbox: e.target.value as AppSettings['sandbox'] })}>
                <option value="read_only">只读 —— 只能看目录、读文件、搜索</option>
                <option value="workspace">工作区 —— 可写文件，命令/外网逐次审批</option>
                <option value="full">全权 —— 中危操作自动放行，高危仍问</option>
              </select>
            </div>
            <div className="perm-field">
              <label>审批模式</label>
              <select value={settings.approval} onChange={(e) => setSettings({ ...settings, approval: e.target.value as AppSettings['approval'] })}>
                <option value="ask_first">每步询问（Ask first）</option>
                <option value="auto">自动允许（高危仍拒绝）</option>
              </select>
            </div>
          </div>
          <p className="perm-note">
            沙箱是「Bot 能自己走多远」，审批是「哪一步必须回来问你」。已授权工具可以写「本会话」或「永久」，永久授权会出现在下面的列表里，随时撤销。
          </p>
        </section>
        )}

        {tab === 'permissions' && (
        <section>
          <h3>联网搜索</h3>
          <select value={settings.search.provider} onChange={(e) => setSettings({ ...settings, search: { ...settings.search, provider: e.target.value as 'tavily' | 'off' } })}>
            <option value="tavily">Tavily（需 key）</option>
            <option value="off">关闭</option>
          </select>
        </section>
        )}

        {tab === 'general' && (
        <section>
          <h3>思考程度的实际影响</h3>
          <table className="limits">
            <thead><tr><th>档位</th><th>温度</th><th>工具轮次</th></tr></thead>
            <tbody>
              <tr><td>快速</td><td>0.2</td><td>30</td></tr>
              <tr><td>标准</td><td>0.5</td><td>100</td></tr>
              <tr><td>深度</td><td>0.65</td><td>300</td></tr>
            </tbody>
          </table>
        </section>
        )}

        {tab === 'permissions' && (
        <section className="wide">
          <h3>已授权工具（{grants.length}）</h3>
          {grants.length === 0 && <p className="muted">还没有长期授权。审批卡里点「本会话 / 总是允许」会出现在这里。</p>}
          {grants.length > 0 && (
            <div className="grant-list">
              {grants.map((g) => (
                <div className="grant-row" key={g.id}>
                  <code>{g.tool}</code>
                  <span className={`grant-scope ${g.scope}`}>{g.scope === 'always' ? '永久' : '本会话'}</span>
                  <span className="grant-note">{g.scope === 'always' ? '所有会话' : `会话 ${g.sessionId?.slice(0, 8) ?? ''}`}</span>
                  <span className="grant-time">{new Date(g.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <button className="danger" onClick={() => void revoke(g.id)}>撤销</button>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {tab === 'models' && (
          <section className="wide">
            <h3>可用模型</h3>
            <p className="perm-note">只勾你想用的：未勾选的模型不会出现在输入框，也不会被自动路由选中。</p>
            <div className="model-groups">
              {Object.entries(modelGroups).map(([pid, list]) => (
                <div className="model-group" key={pid}>
                  <div className="mg-head">
                    <b>{creds.find((c) => c.id === pid)?.label ?? pid}</b>
                    <span>{list.filter((m) => isModelOn(m.id)).length}/{list.length}</span>
                  </div>
                  {list.map((m) => (
                    <label className="model-check" key={m.id}>
                      <input type="checkbox" checked={isModelOn(m.id)} onChange={() => toggleModel(m.id)} />
                      <span>{m.label}</span>
                      <em>{m.tier}</em>
                    </label>
                  ))}
                </div>
              ))}
              {pulledModels.length === 0 && (
                <p className="muted">还没有可用模型：先填 Key 并保存，再点供应商卡片的「拉取模型」勾选保存，这里才会出现。</p>
              )}
            </div>
            <div className="model-actions">
              <button onClick={() => setAllModels(true)}>全选</button>
              <button onClick={() => setAllModels(false)}>全不选</button>
            </div>
          </section>
        )}

        {tab === 'models' && (
          <section className="wide">
            <h3>我用的模型</h3>
            <p className="perm-note">输入框默认用它；选「跟随自动路由」则按任务难度自动挑。</p>
            <select
              value={settings.models?.default ?? ''}
              onChange={(e) => setSettings({
                ...settings,
                models: { ...settings.models, default: e.target.value || undefined },
              })}
            >
              <option value="">跟随自动路由</option>
              {pulledModels.filter((m) => isModelOn(m.id)).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </section>
        )}

        {tab === 'models' && (
        <section className="wide">
          <h3>套餐限额（选填，供自动路由感知 5h/周窗口）</h3>
          {creds.filter((c) => c.hasKey && c.billing === 'subscription').length === 0 ? (
            <p className="perm-note">还没有可用的订阅制供应商。先在「模型服务」里填一个 Key，限额行会按你配置的供应商自动出现。</p>
          ) : (
            <table className="limits">
              <thead><tr><th>Provider</th><th>5h 窗口 tokens</th><th>每周 tokens</th></tr></thead>
              <tbody>
                {creds.filter((c) => c.hasKey && c.billing === 'subscription').map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td><input type="number" placeholder="不限" value={settings.planLimits[c.id]?.window5hTokens ?? ''} onChange={(e) => setLimit(c.id, 'window5hTokens', e.target.value)} /></td>
                    <td><input type="number" placeholder="不限" value={settings.planLimits[c.id]?.weeklyTokens ?? ''} onChange={(e) => setLimit(c.id, 'weeklyTokens', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        )}

        {tab === 'permissions' && (
        <section className="wide">
          <h3>命令白名单（每行一个程序名）</h3>
          <textarea
            rows={5}
            value={settings.commandWhitelist.join('\n')}
            onChange={(e) => setSettings({ ...settings, commandWhitelist: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
          />
        </section>
        )}

        {tab === 'usage' && (
          <section className="wide">
            <h3>Token 用量</h3>
            <p className="perm-note">统计所有会话的 assistant 用量，按模型分组；缓存命中已包含在输入里，不重复计。</p>
            {!usage ? (
              <p className="muted">加载中…</p>
            ) : usage.models.length === 0 ? (
              <p className="muted">还没有用量记录。</p>
            ) : (
              <>
                <div className="usage-cards">
                  <div><span>总用量</span><b>{fmtN(usage.totalTokens)}</b><em>tokens</em></div>
                  <div><span>输入</span><b>{fmtN(usage.totalInput)}</b></div>
                  <div><span>输出</span><b>{fmtN(usage.totalOutput)}</b></div>
                </div>
                <UsagePie models={usage.models} />
                <table className="limits usage-table">
                  <thead>
                    <tr><th>模型</th><th>调用</th><th>输入</th><th>输出</th><th>合计</th><th>占比</th></tr>
                  </thead>
                  <tbody>
                    {usage.models.map((m) => (
                      <tr key={`${m.provider}:${m.model}`}>
                        <td>{m.model}</td>
                        <td>{m.calls}</td>
                        <td>{fmtN(m.inputTokens)}</td>
                        <td>{fmtN(m.outputTokens)}</td>
                        <td>{fmtN(m.totalTokens)}</td>
                        <td>{usage.totalTokens > 0 ? Math.round((m.totalTokens / usage.totalTokens) * 100) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        )}

        {tab === 'about' && (
          <section className="wide">
            <h3>关于 TriBot</h3>
            <div className="settings-paths">
              <div><span>版本</span><code>0.1.0 · 本地 Bot 团队工作台</code></div>
              <div><span>数据目录</span><code>data/（SQLite + 技能 + 任务文件夹）</code></div>
              <div><span>技能来源</span><code>本机 skills/ · data/skills/ · GitHub 插件市场</code></div>
              <div><span>角色</span><code>总管 / 研究员 / 工程师 / 管家 / 审稿人（各自独立方法论）</code></div>
            </div>
            <p className="perm-note">
              设置参考了 DSH 的分组思路（通用 / 模型与凭证 / 权限与工具 / 关于），凭证管理沿用「文件存储 + 只回显尾号 + 测试连接」。
            </p>
          </section>
        )}
      </div>
      <div className="row-gap">
        <button className="approve" onClick={async () => {
          const r = await api.saveSettings(settings);
          setSettings(r.settings);
          setMsg('已保存');
          window.dispatchEvent(new Event('tribot:settings-changed'));
          void api.providers().then((p) => setModels(p.models)).catch(() => {});
          await loadCreds().catch(() => {});
        }}>保存设置</button>
        {msg && <span className="ok-bar">{msg}</span>}
      </div>
    </PanelShell>
  );
}

// ---------- 插件市场 ----------
export function PluginsPanel({ onBack }: { onBack: () => void }) {
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<PluginCategory | 'all'>('all');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [ghSources, setGhSources] = useState<Array<{ id: string; label: string; url: string }>>([]);
  const [ghUrl, setGhUrl] = useState('');
  const [ghBusy, setGhBusy] = useState('');
  const [ghMsg, setGhMsg] = useState('');
  const [ghScan, setGhScan] = useState<Awaited<ReturnType<typeof api.scanGitHub>> | null>(null);

  const reload = async () => setCatalog(await api.plugins());
  useEffect(() => {
    void reload();
    void api.githubSources().then((r) => setGhSources(r.sources)).catch(() => {});
  }, []);

  const scanRepo = async (url?: string) => {
    const target = (url ?? ghUrl).trim();
    if (!target) {
      setGhMsg('先填一个 GitHub 仓库地址');
      return;
    }
    setGhBusy('scan');
    setGhMsg('');
    setGhScan(null);
    try {
      const r = await api.scanGitHub(target);
      setGhUrl(target);
      setGhScan(r);
      setGhMsg(r.skills.length === 0 ? '仓库里没找到 SKILL.md（技能通常放在 skills/<名字>/SKILL.md）' : '');
    } catch (e: any) {
      setGhMsg(String(e?.message ?? e));
    } finally {
      setGhBusy('');
    }
  };

  const installRepoSkill = async (path: string) => {
    if (!ghScan) return;
    setGhBusy(path);
    setGhMsg('');
    try {
      await api.installGitHubSkill(`https://github.com/${ghScan.owner}/${ghScan.repo}`, path);
      await reload();
      setGhScan((cur) => cur && {
        ...cur,
        skills: cur.skills.map((s) => (s.path === path ? { ...s, installed: true } : s)),
      });
      setGhMsg('已安装到技能库');
    } catch (e: any) {
      setGhMsg(String(e?.message ?? e));
    } finally {
      setGhBusy('');
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setMsg('');
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setBusy('');
    }
  };

  const plugins = catalog?.plugins ?? [];
  const list = plugins.filter((p) => {
    if (cat !== 'all' && p.category !== cat) return false;
    if (!q.trim()) return true;
    const hay = `${p.name} ${p.description} ${p.tags.join(' ')} ${p.author}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <PanelShell
      title="插件市场"
      desc="装的是「技能包」：符合开放 SKILL.md 格式，装完立即出现在技能库，所有 Bot 都能用 use_skill 调用。"
      onBack={onBack}
    >
      <section className="gh-market">
        <div className="gh-head">
          <div>
            <h3>从 GitHub 安装</h3>
            <p>粘贴仓库地址（支持子目录），扫描里面的 SKILL.md，选中就装进本地技能库。</p>
          </div>
          <span className="gh-hint">公开仓库 · 无需登录</span>
        </div>
        <div className="gh-row">
          <input
            value={ghUrl}
            placeholder="https://github.com/anthropics/skills 或 owner/repo"
            spellCheck={false}
            onChange={(e) => setGhUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void scanRepo(); }}
          />
          <button className="approve" disabled={ghBusy !== ''} onClick={() => void scanRepo()}>
            {ghBusy === 'scan' ? '扫描中…' : '扫描'}
          </button>
        </div>
        <div className="gh-presets">
          {ghSources.map((s) => (
            <button key={s.id} onClick={() => { setGhUrl(s.url); void scanRepo(s.url); }} disabled={ghBusy !== ''}>
              {s.label}
            </button>
          ))}
        </div>
        {ghMsg && <p className={`gh-msg ${ghMsg === '已安装到技能库' ? 'ok' : ''}`}>{ghMsg}</p>}
        {ghScan && ghScan.skills.length > 0 && (
          <div className="gh-results">
            <div className="gh-meta">
              {ghScan.owner}/{ghScan.repo} · {ghScan.branch} · {ghScan.skills.length} 个技能
              {ghScan.truncated ? '（仓库太大，只扫了一部分）' : ''}
            </div>
            {ghScan.skills.map((s) => (
              <div className="gh-skill" key={s.path}>
                <div className="gh-skill-main">
                  <b>{s.name}</b>
                  <span>{s.description || s.path}</span>
                </div>
                <button
                  disabled={s.installed || ghBusy !== ''}
                  onClick={() => void installRepoSkill(s.path)}
                >
                  {s.installed ? '已安装' : ghBusy === s.path ? '安装中…' : '安装'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="market-bar">
        <input placeholder="搜索：调研 / 写作 / 代码审查 / 数据…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="market-count">
          {catalog ? `${catalog.installed} / ${catalog.plugins.length} 已安装` : '加载中…'}
        </span>
      </div>

      <div className="market-cats">
        <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>全部</button>
        {(catalog?.categories ?? []).map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
            {c.label} <span>{c.count}</span>
          </button>
        ))}
      </div>

      {msg && <div className="error-bar">{msg}</div>}

      <div className="plugin-grid">
        {list.map((p) => (
          <div className={`plugin-card ${p.installed ? 'installed' : ''}`} key={p.id}>
            <div className="plugin-head">
              <div className="plugin-name">{p.name}</div>
              <span className="plugin-ver">v{p.version}</span>
            </div>
            <div className="plugin-author">{p.author} · {p.installs.toLocaleString('zh-CN')} 次安装</div>
            <p className="plugin-desc">{p.description}</p>
            <ul className="plugin-hl">
              {p.highlights.map((h) => <li key={h}>{h}</li>)}
            </ul>
            <div className="plugin-tags">
              {p.tags.map((t) => <span key={t}>{t}</span>)}
              {p.installed && <span className="plugin-on">{p.enabled ? '已启用' : '已停用'}</span>}
            </div>
            <div className="plugin-foot">
              {p.installed ? (
                <>
                  <button onClick={() => void act(p.id, () => api.togglePlugin(p.id, !p.enabled))}>
                    {p.enabled ? '停用' : '启用'}
                  </button>
                  <button className="danger" onClick={() => void act(p.id, () => api.uninstallPlugin(p.id))}>卸载</button>
                </>
              ) : (
                <button className="approve" disabled={busy === p.id} onClick={() => void act(p.id, () => api.installPlugin(p.id))}>
                  {busy === p.id ? '安装中…' : '安装'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && <p className="muted">没有匹配的插件。</p>}
    </PanelShell>
  );
}
