import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Approval, ApprovalScope, AppSettings, Bot, ChatMessage, ContextInsight, ModelInfo, ProviderInfo, QuotaSnapshot, RoutingMode,
  SandboxMode, Session, StreamEvent, TaskCard, ThinkingEffort, TodoItem, CheckpointInfo,
} from '@tribot/shared';
import { detectThinkingTrigger, raiseThinkingEffort, SKIN_PRESETS } from '@tribot/shared';
import { api, checkHealth, getPort, setPort, streamChat, type SessionStats } from './api.js';
import { BotIcon } from './botIcons.js';
import { FilePreview, FileTree } from './files.js';
import { BotsPanel, PluginsPanel, RoutinesPanel, SettingsPanel, SkillsPanel } from './panels.js';

type View = 'chat' | 'bots' | 'skills' | 'plugins' | 'routines' | 'settings';

interface StreamSegment {
  channel: 'reasoning' | 'answer';
  text: string;
}

interface StreamingState {
  active: boolean;
  botName?: string;
  reasoning: string;
  answer: string;
  /** 按到达顺序交错保存 reasoning / answer，用于把「思考」放在发生的位置 */
  segments: StreamSegment[];
  route?: { model: string; reason: string; degraded?: boolean };
  notes: string[];
  startedAt?: number;
  firstTokenAt?: number;
}

const EMPTY_STREAM: StreamingState = {
  active: false, reasoning: '', answer: '', segments: [], notes: [], startedAt: 0, firstTokenAt: 0,
};

const BOT_TAG: Record<string, string> = {
  总管: '调度', 研究员: '调研', 工程师: '工程', 管家: '巡检', 审稿人: '审查',
};

interface SessionPrefs {
  botId?: string;
  mode?: RoutingMode;
  manualModel?: string;
  thinking?: ThinkingEffort;
  compareModels?: string[];
}

function loadSessionPrefs(id: string): SessionPrefs {
  try { return JSON.parse(localStorage.getItem(`tribot.sessionPrefs.${id}`) || '{}'); } catch { return {}; }
}
function saveSessionPrefs(id: string, p: SessionPrefs): void {
  try { localStorage.setItem(`tribot.sessionPrefs.${id}`, JSON.stringify(p)); } catch { /* ignore */ }
}
function defaultBotOf(bots: Bot[]): Bot | undefined {
  return bots.find((b) => b.name === '总管') ?? bots[0];
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** 会话/工作区显示名：默认任务目录是 UUID，显示成「任务目录」而不是一串 id */
function workspaceLabel(p?: string, fallback = '默认'): string {
  if (!p) return fallback;
  const base = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return /^[0-9a-f]{8}(-[0-9a-f]{4})?/i.test(base) ? '任务目录' : base;
}

/** 任务目录是 uuid，全部归到一个「任务目录」文件夹，避免侧栏出现十几个同名分组 */
function workspaceGroupKey(p?: string): string {
  if (!p) return '';
  const base = p.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return /^[0-9a-f]{8}(-[0-9a-f]{4})?/i.test(base) ? '__tasks__' : p;
}

function fmtSessionTime(iso: string): string {  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const yesterday = new Date(now.getTime() - 86400_000);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

type IconName = 'bots' | 'skills' | 'clock' | 'settings' | 'card' | 'plus' | 'bolt' | 'arrowUp'
  | 'market' | 'context' | 'spark' | 'close' | 'refresh' | 'shield' | 'plan' | 'chevron' | 'check'
  | 'winMin' | 'winMax' | 'winRestore' | 'folder' | 'sun' | 'moon' | 'monitor';

const SANDBOX_ORDER: SandboxMode[] = ['read_only', 'workspace', 'full'];
const SANDBOX_LABEL: Record<SandboxMode, string> = { read_only: '只读', workspace: '工作区', full: '全权' };
const THINKING_LABEL: Record<ThinkingEffort, string> = { fast: '快速', standard: '标准', deep: '深度' };
const SANDBOX_HINT: Record<SandboxMode, string> = {
  read_only: '只能看目录、读文件、搜索；不能写文件或执行命令',
  workspace: '可以写文件；命令和外网请求逐次审批',
  full: '中危操作自动放行；高危（白名单外命令、管道、eval）仍要审批',
};

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  bots: (
    <>
      <rect x="3.5" y="7.5" width="17" height="11.5" rx="3" />
      <path d="M12 3.5v4" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
    </>
  ),
  skills: <path d="M12 3.2l1.8 4.6 4.6 1.8-4.6 1.8L12 16l-1.8-4.6L5.6 9.6l4.6-1.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6v4.8l3 1.8" />
    </>
  ),
  settings: (
    <>
      <path d="M4 8h8.2" /><path d="M17 8h3" />
      <path d="M4 16h3" /><path d="M11.8 16H20" />
      <circle cx="15" cy="8" r="2.2" />
      <circle cx="9" cy="16" r="2.2" />
    </>
  ),
  card: (
    <>
      <rect x="3.2" y="5.5" width="17.6" height="13" rx="2.6" />
      <path d="M3.2 10h17.6" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  bolt: <path d="M13.2 2.6L4.8 13.4h5.6l-1 8 8.8-11.2h-6z" />,
  arrowUp: (
    <>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  market: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <path d="M14 17h6M17 14v6" />
    </>
  ),
  context: (
    <>
      <path d="M12 3.4l8 4.1-8 4.1-8-4.1z" />
      <path d="M4 12.4l8 4.1 8-4.1" />
      <path d="M4 16.3l8 4.1 8-4.1" />
    </>
  ),
  spark: <path d="M12 4.6l1.7 4.7 4.7 1.7-4.7 1.7L12 17.4l-1.7-4.7L5.6 11l4.7-1.7z" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" />
      <path d="M19.5 4.5v4.2h-4.2" />
    </>
  ),
  shield: <path d="M12 3.5l7 2.6v5.3c0 4.2-3 7.2-7 8.9-4-1.7-7-4.7-7-8.9V6.1z" />,
  plan: (
    <>
      <path d="M9 6h10M9 12h10M9 18h10" />
      <path d="M4.2 6.2l1 1 1.8-2.2" />
      <path d="M4.2 12.2l1 1 1.8-2.2" />
      <circle cx="5.2" cy="18" r="0.9" />
    </>
  ),
  chevron: <path d="M7 10l5 5 5-5" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  winMin: <path d="M5 12h14" />,
  winMax: <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />,
  winRestore: (
    <>
      <rect x="4.5" y="7.5" width="11" height="11" rx="1.5" />
      <path d="M8.5 5.5h9a1.5 1.5 0 0 1 1.5 1.5v9" />
    </>
  ),
  folder: <path d="M3.5 7.6a2 2 0 0 1 2-2h3.9l2 2.2h7.1a2 2 0 0 1 2 2v8.1a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
    </>
  ),
  moon: <path d="M20 14.4A8.4 8.4 0 1 1 9.6 4 6.6 6.6 0 0 0 20 14.4z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6" />
    </>
  ),
};

// ---------- 首次启动引导：三步，做完直接能干活 ----------
function Onboarding({ onDone, onOpenSettings, onFinishFolder }: {
  onDone: () => void;
  onOpenSettings: () => void;
  onFinishFolder: (folder: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [folder, setFolder] = useState('');

  const finish = () => {
    try { localStorage.setItem('tribot_onboarded_v1', '1'); } catch { /* ignore */ }
    onFinishFolder(folder.trim());
    onDone();
  };

  return (
    <div className="onboard-mask">
      <div className="onboard">
        <div className="onboard-dots">
          {[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}
        </div>

        {step === 0 && (
          <>
            <div className="empty-brand onboard-brand">
              <span className="empty-wordmark">TriBot</span><span className="empty-dot">.</span>
            </div>
            <h2>本地 Bot 团队工作台</h2>
            <p>总管拆任务、专家干活，全部在你的电脑上跑，数据不出本机。</p>
            <ul className="onboard-list">
              <li>多家模型可以任意混用，也能自己加供应商（Kimi / OpenAI / 本地）</li>
              <li>写文件、跑命令都要你点头，授权可撤销</li>
              <li>每个任务有自己的文件夹，产出直接落盘</li>
            </ul>
          </>
        )}

        {step === 1 && (
          <>
            <h2>先配一个模型</h2>
            <p>至少配一家就能开始，其余随时加。</p>
            <ul className="onboard-list">
              <li>订阅制（GLM / MiniMax）：额度内边际成本几乎为 0</li>
              <li>按量（DeepSeek）：低谷时段半价，路由会自动挑</li>
              <li>自定义供应商：Kimi / OpenAI / 本地 Ollama 都走 OpenAI 兼容</li>
            </ul>
          </>
        )}

        {step === 2 && (
          <>
            <h2>选一个任务文件夹</h2>
            <p>Bot 的读写和命令都在这个目录里执行。留空就用默认目录，之后也能改。</p>
            <div className="folder-row">
              <input
                value={folder}
                placeholder="C:\path\to\project"
                spellCheck={false}
                onChange={(e) => setFolder(e.target.value)}
              />
              {window.tribot?.chooseFolder && (
                <button onClick={async () => { const p = await window.tribot!.chooseFolder!(); if (p) setFolder(p); }}>
                  选择…
                </button>
              )}
            </div>
          </>
        )}

        <div className="onboard-actions">
          {step === 1 && (
            <button onClick={() => { onOpenSettings(); finish(); }}>去设置填 Key</button>
          )}
          {step > 0 && <button onClick={() => setStep(step - 1)}>上一步</button>}
          <button className="approve" onClick={() => (step === 2 ? finish() : setStep(step + 1))}>
            {step === 2 ? '开始使用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 无边框窗口的自绘窗口按钮（Windows 白边的根治办法）----------
function WindowControls({ inline = false }: { inline?: boolean }) {
  const wc = window.tribot?.windowControls;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!wc) return;
    void wc.getState().then((s) => setMaximized(s.maximized)).catch(() => {});
    return wc.onStateChange((s) => setMaximized(s.maximized));
  }, [wc]);

  if (!wc) return null;
  return (
    <div className={`win-controls ${inline ? 'inline' : ''}`}>
      <button className="win-btn" aria-label="最小化" title="最小化" onClick={() => wc.minimize()}>
        <Icon name="winMin" size={15} />
      </button>
      <button className="win-btn" aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} onClick={() => wc.toggleMaximize()}>
        <Icon name={maximized ? 'winRestore' : 'winMax'} size={15} />
      </button>
      <button className="win-btn close" aria-label="关闭并退出" title="关闭并退出 TriBot" onClick={() => wc.close()}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

// ---------- 自绘下拉（替代原生 select：原生弹层是系统样式，和整页不搭）----------
interface MenuOption<T extends string> {
  value: T;
  name: string;
  hint?: string;
  disabled?: boolean;
}

function Menu<T extends string>({ label, value, options, onChange, title, align = 'right', tone }: {
  label?: string;
  value: T;
  options: Array<MenuOption<T>>;
  onChange: (v: T) => void;
  title?: string;
  align?: 'left' | 'right';
  tone?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`menu-trigger ${open ? 'open' : ''} ${tone ? `tone-${tone}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {label && <span className="menu-label">{label}</span>}
        <span className="menu-value">{current?.name}</span>
        <span className={`menu-caret ${open ? 'up' : ''}`}><Icon name="chevron" size={11} /></span>
      </button>
      {open && (
        <div className={`menu-pop ${align}`} role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              title={o.disabled ? '该供应商还没配 Key' : undefined}
              className={`menu-item ${o.value === value ? 'on' : ''} ${o.disabled ? 'off' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="menu-item-main">
                <span className="menu-item-name">{o.name}</span>
                {o.hint && <span className="menu-item-hint">{o.hint}</span>}
              </span>
              {o.value === value && <Icon name="check" size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === 'bolt';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function TodoDock({
  todos, checkpoints, onToggle, onDelete, onAdd, onReplace, onRestoreCheckpoint, onClose,
}: {
  todos: TodoItem[];
  checkpoints: CheckpointInfo[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string) => void;
  onReplace: (items: Array<{ text: string; done: boolean }>) => void;
  onRestoreCheckpoint: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const done = todos.filter((t) => t.done).length;
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0;
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };
  const parseImport = () => {
    const items: Array<{ text: string; done: boolean }> = [];
    for (const line of importText.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s*(?:\[([ xX])\])?\s*(.+)$/);
      if (m && m[2].trim()) items.push({ text: m[2].trim(), done: (m[1] ?? '').toLowerCase() === 'x' });
    }
    if (items.length) onReplace(items);
    setImportOpen(false);
    setImportText('');
  };
  return (
    <aside className="todo-dock" aria-label="任务清单">
      <div className="todo-head">
        <Icon name="check" size={15} />
        <b>状态</b>
        <span className="todo-count">{done}/{todos.length}</span>
        <button className="todo-close" onClick={onClose} title="收起清单">×</button>
      </div>
      <div className="todo-progress"><i style={{ width: `${pct}%` }} /></div>
      <div className="todo-list">
        {todos.length === 0 && (
          <p className="todo-empty">还没有清单。让 Bot 用 <code>todo_write</code> 建一个，或手动添加 / 导入 Markdown。</p>
        )}
        {todos.map((t) => (
          <label key={t.id} className={`todo-row ${t.done ? 'done' : ''}`}>
            <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
            <span className="todo-text">{t.text}</span>
            <button className="todo-del" title="删除" onClick={(e) => { e.preventDefault(); onDelete(t.id); }}>×</button>
          </label>
        ))}
      </div>
      <div className="todo-add">
        <input
          value={draft}
          placeholder="添加一项，回车"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button onClick={add} title="添加">+</button>
      </div>
      <div className="todo-foot">
        <button onClick={() => setImportOpen((v) => !v)}>{importOpen ? '取消导入' : '导入 Markdown'}</button>
      </div>
      {importOpen && (
        <div className="todo-import">
          <textarea
            value={importText}
            placeholder={'- [ ] 检查格式模板\n- [x] 泄漏扫描\n- [ ] Reproducibility Statement'}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button onClick={parseImport}>解析并替换清单</button>
        </div>
      )}
      <div className="cp-section">
        <div className="cp-head">
          <span>本轮改动</span>
          <em>{checkpoints.length}</em>
        </div>
        {checkpoints.length === 0 ? (
          <p className="todo-empty">还没有文件改动。Bot 写文件前会自动存检查点。</p>
        ) : (
          checkpoints.map((cp) => (
            <div className="cp-row" key={cp.id}>
              <span className="cp-name" title={cp.path}>{cp.path.split(/[\\/]/).pop()}</span>
              <span className="cp-time">{new Date(cp.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              <button className="cp-restore" onClick={() => onRestoreCheckpoint(cp.id)} title="恢复到这个文件改动之前">回滚</button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export default function App() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [healthMsg, setHealthMsg] = useState('');
  const [portInput, setPortInput] = useState(getPort());

  const [view, setView] = useState<View>('chat');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoOpen, setTodoOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'sessions' | 'files'>('sessions');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('tribot.openTabs');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
  });
  const [wsCollapsed, setWsCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('tribot.wsCollapsed');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('tribot.wsCollapsed', JSON.stringify(wsCollapsed)); } catch { /* ignore */ }
  }, [wsCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('tribot.openTabs', JSON.stringify(openTabs)); } catch { /* ignore */ }
  }, [openTabs]);
  const addTab = useCallback((id: string) => {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  useEffect(() => {
    if (!activeId) { setTodos([]); return; }
    try {
      const raw = localStorage.getItem(`tribot.todos.${activeId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      setTodos(Array.isArray(parsed) ? parsed : []);
    } catch {
      setTodos([]);
    }
  }, [activeId]);
  useEffect(() => { setPreviewPath(null); }, [activeId]);
  const saveTodos = useCallback((next: TodoItem[], sid?: string | null) => {
    setTodos(next);
    const id = sid ?? activeId;
    if (!id) return;
    try { localStorage.setItem(`tribot.todos.${id}`, JSON.stringify(next)); } catch { /* ignore */ }
  }, [activeId]);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const loadCheckpoints = useCallback(async (sid: string | null) => {
    if (!sid) { setCheckpoints([]); return; }
    try {
      const r = await api.checkpoints(sid);
      setCheckpoints(r.checkpoints);
    } catch {
      setCheckpoints([]);
    }
  }, []);
  useEffect(() => { void loadCheckpoints(activeId); }, [activeId, loadCheckpoints]);
  const restoreCp = useCallback(async (id: string) => {
    try {
      const r = await api.restoreCheckpoint(id);
      if (activeId) await loadCheckpoints(activeId);
      if (!r.ok) setErrorMsg(r.message);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    }
  }, [activeId, loadCheckpoints]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const botsRef = useRef<Bot[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [quota, setQuota] = useState<QuotaSnapshot[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [streams, setStreams] = useState<Record<string, StreamingState>>({});
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  const botMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!botMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!botMenuRef.current?.contains(e.target as Node)) setBotMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [botMenuOpen]);
  type QueuedMessage = { id: string; text: string; plan: boolean };
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>({});
  const drainingRef = useRef(false);
  const sendingRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const stream = streams[activeId ?? ''] ?? EMPTY_STREAM;
  const queue: QueuedMessage[] = queues[activeId ?? ''] ?? [];
  const patchStream = useCallback((sid: string, fn: (s: StreamingState) => StreamingState) => {
    setStreams((prev) => ({ ...prev, [sid]: fn(prev[sid] ?? EMPTY_STREAM) }));
  }, []);
  const updateQueue = useCallback((fn: (q: QueuedMessage[]) => QueuedMessage[]) => {
    const sid = activeId;
    if (!sid) return;
    setQueues((prev) => ({ ...prev, [sid]: fn(prev[sid] ?? []) }));
  }, [activeId]);
  const [errorMsg, setErrorMsg] = useState('');

  const [input, setInput] = useState('');
  const [mode, setMode] = useState<RoutingMode>('auto');
  const [manualModel, setManualModel] = useState('');
  const [enabledModels, setEnabledModels] = useState<string[] | null>(null);
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, string[]>>({});
  const catalogIds = Object.values(modelCatalogs).flat();
  // 只列「拉取模型」里勾选保存过、且该供应商已保存 Key 的；否则为空
  const pulledModels = catalogIds.length > 0
    ? models.filter((m) => catalogIds.includes(m.id) && !!providers.find((p) => p.id === m.provider)?.hasKey)
    : [];
  const availableModels = enabledModels ? pulledModels.filter((m) => enabledModels.includes(m.id)) : pulledModels;
  // 左侧 Bot 定位条：本会话出现过的 Bot，点击跳到它最后一条回复
  const sessionBots = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages) if (m.role === 'assistant' && m.botId) ids.add(m.botId);
    if (stream.active && selectedBotId) ids.add(selectedBotId);
    return bots.filter((b) => ids.has(b.id));
  }, [messages, stream.active, selectedBotId, bots]);
  const jumpToBot = useCallback((botId: string) => {
    const nodes = document.querySelectorAll(`[data-bot-id="${botId}"]`);
    nodes[nodes.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);
  const selectedBot = bots.find((b) => b.id === selectedBotId);
  // 输入框里空间有限：MiniMax-M3.1-Flash → M3.1 F，flashx → FX（避免和 Flash 撞名）
  const shortModelName = (label: string) => {
    const cleaned = label
      .replace(/^MiniMax[-_ ]?/i, '')
      .replace(/^GLM[-_ ]?/i, 'GLM ')
      .replace(/[-_]/g, ' ')
      .trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return cleaned.length > 14 ? `${cleaned.slice(0, 13)}…` : cleaned;
    const suffix: Record<string, string> = {
      flash: 'F', flashx: 'FX', flashlite: 'FL', fast: 'FA', air: 'A', pro: 'P',
      turbo: 'T', lite: 'L', max: 'MAX', mini: 'MINI', reasoning: 'R', chat: 'C', vision: 'V',
    };
    const tail = parts.slice(1).map((p) => {
      const mapped = suffix[p.toLowerCase()];
      if (mapped) return mapped;
      return p.length > 3 ? p[0].toUpperCase() : p;
    });
    return [parts[0], ...tail].join(' ');
  };
  const [defaultModel, setDefaultModel] = useState('');
  const [compareModels, setCompareModels] = useState<string[]>([]);
  const [cardOpen, setCardOpen] = useState(false);
  const [card, setCard] = useState<TaskCard>({ goal: '' });
  const [thinking, setThinking] = useState<ThinkingEffort>('standard');
  const [sandbox, setSandbox] = useState<SandboxMode>('workspace');
  const [contextOpen, setContextOpen] = useState(false);
  const [insight, setInsight] = useState<ContextInsight | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [planCard, setPlanCard] = useState<string | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderList, setFolderList] = useState<string[]>([]);
  const [folderInput, setFolderInput] = useState('');
  const [onboard, setOnboard] = useState(() => {
    try { return !localStorage.getItem('tribot_onboarded_v1'); } catch { return false; }
  });
  const [ctxMenu, setCtxMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameText, setRenameText] = useState('');
  const [delTarget, setDelTarget] = useState<{ id: string; title: string; workspace?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [theme, setTheme] = useState<'auto' | 'dark' | 'light'>('auto');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQ, setPaletteQ] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [skin, setSkin] = useState<AppSettings['skin'] | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const activeSession = sessions.find((s) => s.id === activeId);
  const lastTurnTokens = (() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.usage);
    return last?.usage ? last.usage.inputTokens + last.usage.outputTokens : 0;
  })();
  const sessionGroups = useMemo(() => {
    const map = new Map<string, { key: string; sessions: Session[]; latest: string }>();
    for (const s of sessions) {
      const key = workspaceGroupKey(s.meta?.workspaces?.[0] ?? s.meta?.workspace);
      const g = map.get(key) ?? { key, sessions: [], latest: '' };
      g.sessions.push(s);
      if (s.updatedAt > g.latest) g.latest = s.updatedAt;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest));
  }, [sessions]);
  const activeWorkspaces = (() => {
    const meta = activeSession?.meta as { workspace?: string; workspaces?: string[] } | undefined;
    if (Array.isArray(meta?.workspaces) && meta.workspaces.length > 0) return meta.workspaces;
    return meta?.workspace ? [meta.workspace] : [];
  })();
  const activeWorkspace = activeWorkspaces[0] ?? '';
  const workspaceName = workspaceLabel(activeWorkspace, '');
  // 输入里带「深入思考 / think hard / ultrathink」就提示会自动升档
  const pendingTrigger = useMemo(() => detectThinkingTrigger(input), [input]);
  const effectiveThinking = pendingTrigger ? raiseThinkingEffort(thinking, pendingTrigger.effort) : thinking;

  // ---------- 连接与数据加载 ----------
  const connect = useCallback(async (p?: string) => {
    if (p) setPort(p);
    const h = await checkHealth();
    setConnected(!!h);
    if (!h) setHealthMsg('连不上本地 server。如果还没启动，请运行 pnpm dev 或 pnpm dev:server');
    return h;
  }, []);

  const refreshSessions = useCallback(async () => {
    const { sessions: ss } = await api.sessions();
    setSessions(ss);
    return ss;
  }, []);
  const autoTitle = useCallback(async (sid: string) => {
    try {
      const r = await api.generateTitle(sid);
      if (r.generated) await refreshSessions();
    } catch { /* 标题生成失败不影响聊天 */ }
  }, [refreshSessions]);

  const openSession = useCallback(async (id: string, fresh = false) => {
    let bs = botsRef.current;
    if (bs.length === 0) {
      bs = (await api.bots()).bots;
      botsRef.current = bs;
      setBots(bs);
    }
    const { messages: ms } = await api.messages(id);
    const prefs = fresh ? {} : loadSessionPrefs(id);
    const def = defaultBotOf(bs);
    // 老会话没有偏好时，用它最后一条回复的 Bot；再退回总管
    const lastBotId = [...ms].reverse().find((m) => m.role === 'assistant' && m.botId)?.botId;
    const botId = prefs.botId && bs.some((b) => b.id === prefs.botId)
      ? prefs.botId
      : (lastBotId && bs.some((b) => b.id === lastBotId) ? lastBotId : (def?.id ?? ''));
    setView('chat');
    setSelectedBotId(botId);
    setMode(prefs.mode ?? 'auto');
    setManualModel(prefs.manualModel ?? '');
    setThinking(prefs.thinking ?? 'standard');
    setCompareModels(prefs.compareModels ?? []);
    setActiveId(id);
    setMessages(ms);
    addTab(id);
    if (ms.length > 0) void autoTitle(id);
  }, [addTab, autoTitle]);

  useEffect(() => { botsRef.current = bots; }, [bots]);

  // 每个会话记住自己的 Bot / 路由方式 / 手动模型 / 思考档
  useEffect(() => {
    if (!activeId) return;
    saveSessionPrefs(activeId, { botId: selectedBotId, mode, manualModel, thinking, compareModels });
  }, [activeId, selectedBotId, mode, manualModel, thinking, compareModels]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const removeSession = useCallback(async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await api.deleteSession(delTarget.id);
      const ss = await refreshSessions();
      if (activeId === delTarget.id) {
        if (ss[0]) await openSession(ss[0].id);
        else { setActiveId(null); setMessages([]); }
      }
      setDelTarget(null);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setDeleting(false);
    }
  }, [delTarget, activeId, refreshSessions, openSession]);

  useEffect(() => {
    void (async () => {
      const h = await connect();
      if (!h) return;
      try {
        const [{ bots: bs }, { providers: ps, models: ms }] = await Promise.all([api.bots(), api.providers()]);
        setBots(bs);
        setProviders(ps);
        setModels(ms);
        setSelectedBotId((cur) => cur || bs[0]?.id || '');
        const { settings } = await api.settings();
        setTheme(settings.theme ?? 'auto');
        setSkin(settings.skin ?? null);
        setMode(settings.routing.mode);
        setManualModel(settings.routing.manualModel ?? settings.models?.default ?? ms[0]?.id ?? '');
        setEnabledModels(settings.models?.enabled ?? null);
        setModelCatalogs(settings.models?.catalogs ?? {});
        setDefaultModel(settings.models?.default ?? '');
        setThinking(settings.thinking?.default ?? 'standard');
        setSandbox(settings.sandbox ?? 'workspace');
        const ss = await refreshSessions();
        if (ss[0]) await openSession(ss[0].id);
      } catch (e: any) {
        setErrorMsg(String(e?.message ?? e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const preset = skin?.preset ? SKIN_PRESETS.find((p) => p.id === skin.preset) : undefined;
    if (skin?.enabled && (skin.file || preset)) {
      root.dataset.skin = 'on';
      root.style.setProperty(
        '--skin-image',
        preset ? preset.css : `url("${api.skinUrl(skin.file)}")`,
      );
      root.style.setProperty('--skin-opacity', String(skin.opacity ?? 0.32));
      root.style.setProperty('--skin-blur', `${skin.blur ?? 0}px`);
    } else {
      delete root.dataset.skin;
      root.style.removeProperty('--skin-image');
    }
  }, [skin]);

  useEffect(() => {
    const onSkin = (e: Event) => setSkin((e as CustomEvent).detail as AppSettings['skin']);
    window.addEventListener('tribot:skin', onSkin);
    return () => window.removeEventListener('tribot:skin', onSkin);
  }, []);

  // 设置页保存后，输入框的模型列表与默认模型跟着刷新
  useEffect(() => {
    const onSettings = async () => {
      try {
        const { settings } = await api.settings();
        setMode(settings.routing.mode);
        setManualModel(settings.routing.manualModel ?? settings.models?.default ?? '');
        setEnabledModels(settings.models?.enabled ?? null);
        setModelCatalogs(settings.models?.catalogs ?? {});
        setDefaultModel(settings.models?.default ?? '');
        setThinking(settings.thinking?.default ?? 'standard');
        setSandbox(settings.sandbox ?? 'workspace');
        const [{ providers: ps, models: ms }, { providers: qs }] = await Promise.all([api.providers(), api.quota()]);
        setProviders(ps);
        setModels(ms);
        setQuota(qs);
      } catch { /* ignore */ }
    };
    window.addEventListener('tribot:settings-changed', onSettings);
    return () => window.removeEventListener('tribot:settings-changed', onSettings);
  }, []);

  // Ctrl+K / Ctrl+P 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'k' || k === 'p')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteQ('');
        setPaletteIdx(0);
        return;
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 会话级用量：token 速度 / 缓存命中率 / 省下 token / 上下文使用率
  useEffect(() => {
    if (!activeId) { setSessionStats(null); return; }
    let alive = true;
    const load = async () => {
      try {
        const r = await api.sessionStats(activeId);
        if (alive) setSessionStats(r.stats);
      } catch { /* 统计失败不影响会话 */ }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId, messages.length]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const resolved = theme === 'auto' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    const onTheme = (e: Event) => {
      const t = (e as CustomEvent).detail;
      if (t === 'auto' || t === 'dark' || t === 'light') setTheme(t);
    };
    window.addEventListener('tribot:theme', onTheme);
    return () => window.removeEventListener('tribot:theme', onTheme);
  }, []);

  const cycleTheme = useCallback(async () => {
    const next = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
    setTheme(next);
    try {
      const { settings } = await api.settings();
      await api.saveSettings({ ...settings, theme: next });
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    }
  }, [theme]);

  useEffect(() => {
    if (!connected) return;
    const tick = async () => {
      try {
        const [{ approvals: as1 }, { providers: qs }] = await Promise.all([api.approvals(), api.quota()]);
        setApprovals(as1);
        setQuota(qs);
      } catch { /* 轮询失败静默 */ }
    };
    void tick(); // 先取一次，别让侧栏额度空 5 秒
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    // 用户往上翻时不要抢滚动位置；只有贴着底部才跟随新内容
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({ behavior: stream.active ? 'auto' : 'smooth', block: 'end' });
  }, [messages, stream.answer, stream.reasoning]);

  // 切换会话时回到最新
  useEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
    return () => cancelAnimationFrame(id);
  }, [activeId]);

  const onThreadScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    stickToBottom.current = near;
    setShowJump(!near);
  }, []);

  // ---------- 上下文洞察 ----------
  const refreshInsight = useCallback(async (): Promise<ContextInsight | null> => {
    if (!activeId || !connected) return null;
    try {
      const { insight: next } = await api.context(activeId, selectedBotId || undefined);
      setInsight(next);
      return next;
    } catch {
      return null;
    }
  }, [activeId, selectedBotId, connected]);

  useEffect(() => {
    void refreshInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, selectedBotId]);

  useEffect(() => {
    if (contextOpen) void refreshInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextOpen]);

  const cycleSandbox = useCallback(async () => {
    const next = SANDBOX_ORDER[(SANDBOX_ORDER.indexOf(sandbox) + 1) % SANDBOX_ORDER.length];
    setSandbox(next);
    try {
      await api.saveSettings({ sandbox: next });
    } catch (e: any) {
      setErrorMsg(`沙箱切换失败：${String(e?.message ?? e)}`);
    }
  }, [sandbox]);

  const addFolder = useCallback(() => {
    const p = folderInput.trim();
    if (!p) return;
    setFolderList((list) => (list.some((x) => x.toLowerCase() === p.toLowerCase()) ? list : [...list, p]));
    setFolderInput('');
  }, [folderInput]);

  const exportSession = useCallback(async () => {
    if (!activeId) return;
    try {
      const md = await api.exportSession(activeId);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tribot-${activeId.slice(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    }
  }, [activeId]);

  const saveFolder = useCallback(async () => {
    if (!activeId) return;
    try {
      await api.updateSession(activeId, { workspaces: folderList });
      await refreshSessions();
      setFolderOpen(false);
      void refreshInsight();
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    }
  }, [activeId, folderList, refreshSessions, refreshInsight]);

  const compactContext = useCallback(async () => {
    if (!activeId || contextBusy) return;
    setContextBusy(true);
    try {
      const r = await api.compactContext(activeId);
      setInsight(r.insight);
      setErrorMsg(r.ok ? '' : r.note);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    } finally {
      setContextBusy(false);
    }
  }, [activeId, contextBusy]);

  // ---------- 发送 ----------
  const attachFile = useCallback(async () => {
    const append = (name: string, content: string) => {
      const clipped = content.length > 60_000 ? `${content.slice(0, 60_000)}\n…（内容过长，已截断）` : content;
      setInput((prev) => `${prev}${prev.trim() ? '\n\n' : ''}【文件：${name}】\n\`\`\`\n${clipped}\n\`\`\`\n`);
    };
    if (window.tribot?.readLocalFile) {
      const r = await window.tribot.readLocalFile();
      if (!r) return;
      if ('error' in r) { setErrorMsg(r.error); return; }
      append(r.name, r.content);
      return;
    }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.md,.txt,.json,.ts,.tsx,.js,.jsx,.css,.html,.py,.yml,.yaml,.toml,.sql,.log,.csv';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => append(f.name, String(rd.result ?? ''));
      rd.readAsText(f);
    };
    inp.click();
  }, []);

  const send = useCallback(async (override?: string, sendOpts?: { plan?: boolean }) => {
    const content = (override ?? input).trim();
    const plan = sendOpts?.plan ?? planMode;
    if (!content || !connected) return;
    // 仅当前会话在生成时排队；别的会话可以同时跑
    if (stream.active || (activeId && sendingRef.current.has(activeId))) {
      if (!activeId) return;
      const sid = activeId;
      const item = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: content, plan };
      setQueues((prev) => ({ ...prev, [sid]: [...(prev[sid] ?? []), item] }));
      if (!override) setInput('');
      return;
    }
    stickToBottom.current = true;
    setShowJump(false);
    if (mode !== 'auto' && availableModels.length === 0) {
      setErrorMsg('还没有拉取模型：去 设置 → 模型与凭证 → 点供应商卡片的「拉取模型」');
      return;
    }
    if (cardOpen && !card.goal.trim()) {
      setErrorMsg('任务卡模式需要填写「目标」');
      return;
    }
    setErrorMsg('');
    let sessionId = activeId;
    if (!sessionId) {
      const { session } = await api.createSession();
      sessionId = session.id;
      activeIdRef.current = sessionId;
      setActiveId(session.id);
      addTab(session.id);
      await refreshSessions();
    }
    const sid = sessionId;
    sendingRef.current.add(sid);
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`, sessionId: sid, role: 'user', content,
      createdAt: new Date().toISOString(),
    };
    setMessages((ms) => [...ms, optimistic]);
    if (!override) setInput('');
    const bot = bots.find((b) => b.id === selectedBotId);
    setStreams((prev) => ({
      ...prev,
      [sid]: {
        active: true, botName: bot ? `${bot.emoji} ${bot.name}` : '',
        reasoning: '', answer: '', segments: [], notes: [],
        startedAt: Date.now(), firstTokenAt: 0,
      },
    }));

    try {
      await streamChat(
        {
          sessionId: sid,
          content,
          botId: selectedBotId || undefined,
          mode,
          model: mode === 'manual' ? manualModel : undefined,
          compareModels: mode === 'compare' ? compareModels : undefined,
          taskCard: cardOpen ? card : undefined,
          thinking,
          plan,
        },
        (e: StreamEvent) => {
          if (e.type === 'token') {
            const channel: StreamSegment['channel'] = e.channel === 'reasoning' ? 'reasoning' : 'answer';
            patchStream(sid, (s) => {
              const last = s.segments[s.segments.length - 1];
              const segments = last?.channel === channel
                ? [...s.segments.slice(0, -1), { channel, text: last.text + e.text }]
                : [...s.segments, { channel, text: e.text }];
              return {
                ...s,
                segments,
                answer: channel === 'answer' ? s.answer + e.text : s.answer,
                reasoning: channel === 'reasoning' ? s.reasoning + e.text : s.reasoning,
                firstTokenAt: s.firstTokenAt || Date.now(),
              };
            });
          } else if (e.type === 'route') {
            patchStream(sid, (s) => ({ ...s, route: { model: e.model, reason: e.reason, degraded: e.degraded } }));
          } else if (e.type === 'tool_call') {
            patchStream(sid, (s) => ({ ...s, notes: [...s.notes, `⚙️ ${e.tool}(${JSON.stringify(e.args).slice(0, 80)})`] }));
          } else if (e.type === 'tool_result') {
            patchStream(sid, (s) => ({ ...s, notes: [...s.notes, e.ok ? `✅ ${e.preview.slice(0, 60)}` : `❌ ${e.preview.slice(0, 60)}`] }));
          } else if (e.type === 'assign') {
            patchStream(sid, (s) => ({ ...s, notes: [...s.notes, `📤 ${e.fromBot} → ${e.toBot}：${e.instruction.slice(0, 50)}`] }));
          } else if (e.type === 'notice') {
            patchStream(sid, (s) => ({ ...s, notes: [...s.notes, e.message] }));
          } else if (e.type === 'plan') {
            if (activeIdRef.current === sid) setPlanCard(e.plan);
          } else if (e.type === 'todos') {
            if (activeIdRef.current === sid) saveTodos(e.todos, sid);
          } else if (e.type === 'approval_request') {
            setApprovals((as1) => [e.approval, ...as1]);
            try {
              new Notification(`TriBot 审批请求（${e.approval.risk}）`, { body: `${e.approval.botName}：${e.approval.reason}` });
            } catch { /* ignore */ }
          } else if (e.type === 'message_done') {
            if (activeIdRef.current === sid) setMessages((ms) => [...ms, e.message]);
            patchStream(sid, (s) => ({ ...s, answer: '', reasoning: '', segments: [], notes: [] }));
          } else if (e.type === 'error') {
            if (activeIdRef.current === sid) setErrorMsg(e.message);
          }
        },
      );
    } catch (e: any) {
      if (activeIdRef.current === sid) setErrorMsg(String(e?.message ?? e));
    } finally {
      sendingRef.current.delete(sid);
      setStreams((prev) => {
        const next = { ...prev };
        delete next[sid];
        return next;
      });
      if (activeIdRef.current === sid) {
        api.messages(sid).then(({ messages: ms }) => setMessages(ms)).catch(() => {});
        void refreshInsight();
      }
      void loadCheckpoints(sid);
      void autoTitle(sid);
      refreshSessions().catch(() => {});
    }
  }, [input, stream.active, connected, activeId, selectedBotId, bots, mode, manualModel, compareModels, cardOpen, card, thinking, planMode, refreshSessions, refreshInsight, availableModels, patchStream, addTab, autoTitle]);

  const stopGeneration = useCallback(async () => {
    if (!activeId) return;
    try { await api.stopSession(activeId); } catch { /* ignore */ }
  }, [activeId]);

  // 当前会话的回复结束后，自动发送它自己的排队消息
  useEffect(() => {
    const sid = activeId;
    if (!sid || stream.active || !connected || drainingRef.current) return;
    const q = queues[sid] ?? [];
    if (q.length === 0) return;
    drainingRef.current = true;
    const [next, ...rest] = q;
    setQueues((prev) => ({ ...prev, [sid]: rest }));
    void send(next.text, { plan: next.plan }).finally(() => { drainingRef.current = false; });
  }, [activeId, stream.active, queues, connected, send]);

  const decide = useCallback(async (id: string, decision: 'approved' | 'denied', scope: ApprovalScope = 'once') => {
    await api.decideApproval(id, decision, scope);
    setApprovals((as1) => as1.filter((a) => a.id !== id));
  }, []);

  const newSession = useCallback(async () => {
    const { session } = await api.createSession();
    await refreshSessions();
    await openSession(session.id, true);
  }, [refreshSessions, openSession]);

  const closeTab = useCallback((id: string) => {
    const idx = openTabs.indexOf(id);
    const next = openTabs.filter((x) => x !== id);
    setOpenTabs(next);
    if (activeId !== id) return;
    const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
    if (fallback) void openSession(fallback);
    else { setActiveId(null); setMessages([]); }
  }, [openTabs, activeId, openSession]);

  const newSessionIn = useCallback(async (workspace?: string) => {
    const { session } = await api.createSession();
    if (workspace) {
      try { await api.updateSession(session.id, { workspaces: [workspace] }); } catch { /* ignore */ }
    }
    await refreshSessions();
    await openSession(session.id, true);
  }, [refreshSessions, openSession]);

  const commitRename = useCallback(async () => {
    if (!renameTarget) return;
    const title = renameText.trim().slice(0, 60);
    if (!title) return;
    try {
      await api.updateSession(renameTarget.id, { title });
      await refreshSessions();
      setRenameTarget(null);
      setRenameText('');
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    }
  }, [renameTarget, renameText, refreshSessions]);

  // ---------- 渲染 ----------
  if (connected === null) return <div className="boot">正在连接本地服务…</div>;
  if (connected === false) {
    return (
      <div className="boot">
        <div className="boot-card">
          <h2>🔌 未连接到 TriBot server</h2>
          <p>{healthMsg}</p>
          <div className="row">
            <input value={portInput} onChange={(e) => setPortInput(e.target.value)} placeholder="端口" />
            <button onClick={() => void connect(portInput)}>重试</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 命令面板（Ctrl+K）----------
  const paletteItems: Array<{ id: string; label: string; hint: string; run: () => void }> = [];
  for (const s of sessions.slice(0, 40)) {
    paletteItems.push({
      id: `s-${s.id}`, label: s.title, hint: '会话',
      run: () => { void openSession(s.id); setPaletteOpen(false); },
    });
  }
  for (const b of bots) {
    paletteItems.push({
      id: `b-${b.id}`, label: b.name, hint: 'Bot',
      run: () => { setSelectedBotId(b.id); setView('chat'); setPaletteOpen(false); },
    });
  }
  for (const [label, view] of [
    ['Bot 团队', 'bots'], ['技能库', 'skills'], ['插件市场', 'plugins'], ['定时任务', 'routines'], ['设置', 'settings'],
  ] as const) {
    paletteItems.push({
      id: `v-${view}`, label, hint: '页面',
      run: () => { setView(view); setPaletteOpen(false); },
    });
  }
  paletteItems.push(
    { id: 'a-new', label: '新建会话', hint: '操作', run: () => { void newSession(); setPaletteOpen(false); } },
    { id: 'a-export', label: '导出当前会话为 Markdown', hint: '操作', run: () => { void exportSession(); setPaletteOpen(false); } },
    { id: 'a-compact', label: '压缩当前上下文', hint: '操作', run: () => { void compactContext(); setPaletteOpen(false); } },
    { id: 'a-theme', label: '切换外观（跟随系统 / 深色 / 浅色）', hint: '操作', run: () => { void cycleTheme(); setPaletteOpen(false); } },
    {
      id: 'a-folder', label: '管理任务文件夹', hint: '操作',
      run: () => { setFolderList(activeWorkspaces); setFolderInput(''); setFolderOpen(true); setPaletteOpen(false); },
    },
  );
  const paletteQuery = paletteQ.trim().toLowerCase();
  const paletteShown = (paletteQuery
    ? paletteItems.filter((it) => `${it.label} ${it.hint}`.toLowerCase().includes(paletteQuery))
    : paletteItems
  ).slice(0, 12);

  return (
    <div className={`layout ${window.tribot?.isElectron ? 'desktop' : ''}`}>
      {view !== 'chat' && <WindowControls />}
      {/* ===== 侧栏 ===== */}
      <aside className="sidebar">
        <div className="brand" onClick={() => setView('chat')}>
          <div className="brand-logo"><Icon name="bolt" size={14} /></div>
          <div>
            <div className="brand-name">TriBot</div>
            <div className="brand-sub">Bot 团队工作台</div>
          </div>
        </div>

        <button className="new-session" onClick={() => void newSession()}>
          <Icon name="plus" size={13} /> 新会话
        </button>

        <div className="side-tabs">
          <button className={sideTab === 'sessions' ? 'on' : ''} onClick={() => setSideTab('sessions')}>会话</button>
          <button className={sideTab === 'files' ? 'on' : ''} onClick={() => setSideTab('files')}>文件</button>
        </div>

        <div className="side-label">
          {sideTab === 'files' ? '工作区文件' : '会话'}
        </div>
        {sideTab === 'files' && !activeId && <p className="file-empty">先选一个会话，再看它的工作区文件。</p>}
        {sideTab === 'files' && activeId && (
          <div className="file-side">
            <FileTree sessionId={activeId} onOpen={(p) => { setPreviewPath(p); setTodoOpen(false); }} />
          </div>
        )}
        <div className={`session-list ${sideTab === 'files' ? 'hidden' : ''}`}>
          {sessionGroups.length === 0 && <p className="file-empty">还没有会话。</p>}
          {sessionGroups.map((g) => {
            const groupKey = g.key || '__default__';
            const collapsed = !!wsCollapsed[groupKey];
            const label = g.key === '__tasks__' ? '任务目录' : g.key ? workspaceLabel(g.key, '工作区') : '未分组';
            return (
              <div className="ws-group" key={groupKey}>
                <div className="ws-group-head">
                  <button
                    className="ws-group-main"
                    onClick={() => setWsCollapsed((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                    title={g.key || '没有绑定工作区的会话'}
                  >
                    <span className="ws-group-caret">{collapsed ? '▸' : '▾'}</span>
                    <Icon name="folder" size={12} />
                    <span className="ws-group-name">{label}</span>
                    <span className="ws-group-count">{g.sessions.length}</span>
                  </button>
                  <button
                    className="ws-group-add"
                    title={`在「${label}」中新建会话`}
                    onClick={() => void newSessionIn(g.key.startsWith('__') ? undefined : g.key)}
                  >+</button>
                </div>
                {!collapsed && g.sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`session-item nested ${s.id === activeId && view === 'chat' ? 'active' : ''}`}
                    onClick={() => void openSession(s.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      setRenameTarget({ id: s.id, title: s.title });
                      setRenameText(s.title);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ id: s.id, title: s.title, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <span className="session-title">{s.title}</span>
                    {streams[s.id]?.active && <span className="session-live" title="正在生成" />}
                    <span className="session-time">{fmtSessionTime(s.updatedAt)}</span>
                    {s.type === 'task' && <span className="tag">任务</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="side-label">额度</div>
        <div className="quota-box">
          {quota
            .filter((q) => {
              const p = providers.find((x) => x.id === q.provider);
              return !!p?.hasKey || q.meter.window5hTokens > 0 || !!q.balance;
            })
            .map((q) => {
            const p = providers.find((x) => x.id === q.provider);
            const pct = q.usage5hTokens == null && q.meter.window5hLimit
              ? Math.min(100, Math.round((q.meter.window5hTokens / q.meter.window5hLimit) * 100))
              : null;
            return (
              <div className="quota-pill" key={q.provider} title={`${p?.label ?? q.provider} · ${q.remote?.ok ? '远程查询正常' : q.remote?.detail ?? '未配置 Key'}${q.planLevel ? ` · ${q.planLevel}` : ''}${q.meter.window5hLimit ? ` · 套餐额度 ${q.meter.window5hTokens}/${q.meter.window5hLimit}（5h）${q.meter.weeklyLimit ? `，${q.meter.weeklyTokens}/${q.meter.weeklyLimit}（周）` : ''}` : ''}`}>
                <div className="q-top">
                  <span className="q-name">
                    {p?.label ?? q.provider}
                    {q.planLevel && <span className="q-plan">{q.planLevel}</span>}
                    {q.provider === 'deepseek' && (
                      <span className={`period ${q.deepseekPeriod}`}>
                        {q.deepseekPeriod === 'peak' ? '峰' : '谷'}
                      </span>
                    )}
                  </span>
                  {q.balance && <span className="q-balance">¥{q.balance.amount.toFixed(2)}</span>}
                  <span className="q-usage">
                    5h {q.usage5hTokens != null
                      ? `${fmtTokens(q.usage5hTokens)} tok`
                      : `${fmtTokens(q.meter.window5hTokens)}${q.meter.window5hLimit ? ` / ${fmtTokens(q.meter.window5hLimit)}` : ''}`}
                  </span>
                </div>
                <div className="q-usage q-week">
                  周 {q.usageWeeklyTokens != null
                    ? `${fmtTokens(q.usageWeeklyTokens)} tok`
                    : `${fmtTokens(q.meter.weeklyTokens)}${q.meter.weeklyLimit ? ` / ${fmtTokens(q.meter.weeklyLimit)}` : ''}`}
                </div>
                {q.planNote && <div className="q-usage q-note">{q.planNote}</div>}
                {pct != null && <div className="q-bar"><div className={`q-fill ${pct > 90 ? 'hot' : ''}`} style={{ width: `${pct}%` }} /></div>}
              </div>
            );
          })}
          {quota.filter((q) => {
            const p = providers.find((x) => x.id === q.provider);
            return !!p?.hasKey || q.meter.window5hTokens > 0 || !!q.balance;
          }).length === 0 && (
            <div className="quota-empty">还没有配置供应商</div>
          )}
        </div>

        <nav className="side-nav">
          {([
            ['bots', 'Bot 团队', 'bots'],
            ['skills', '技能', 'skills'],
            ['plugins', '插件市场', 'market'],
            ['routines', '定时任务', 'clock'],
            ['settings', '设置', 'settings'],
          ] as Array<[View, string, IconName]>).map(([v, label, icon]) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ===== 主区 ===== */}
      <main className="main">
        {view === 'chat' && (
          <>
            {/* 顶栏：当前会话 + 连接状态 */}
            <div className="topbar" onDoubleClick={() => window.tribot?.windowControls?.toggleMaximize()}>
              <span className="topbar-dot" title="本地服务已连接" />
              {openTabs.length === 0 && (
                <span className="topbar-title">
                  {sessions.find((s) => s.id === activeId)?.title ?? 'TriBot'}
                </span>
              )}
              <span className="topbar-spacer" />
              <button
                className={`folder-chip ${activeWorkspace ? 'set' : ''}`}
                title={activeWorkspaces.length > 1 ? activeWorkspaces.join('\n') : (activeWorkspace || '默认工作区（data/workspaces）')}
                onClick={() => { setFolderList(activeWorkspaces); setFolderInput(''); setFolderOpen(true); }}
              >
                <Icon name="folder" size={12} />
                {workspaceName || '任务目录'}
                {activeWorkspaces.length > 1 && <span className="folder-count">+{activeWorkspaces.length - 1}</span>}
              </button>
              {sessionStats && sessionStats.messages > 0 && (
                <div className="session-stats">
                  <span title="上一条回复消耗的输入 + 输出 tokens">
                    上轮 <b>{fmtTokens(lastTurnTokens)}</b> tok
                  </span>
                  <span title="本会话累计输入 + 输出 tokens">
                    本会话 <b>{fmtTokens(sessionStats.inputTokens + sessionStats.outputTokens)}</b> tok
                  </span>
                  <span title="输出速度 = 输出 tokens / 生成耗时">
                    <b>{sessionStats.tokensPerSec.toFixed(sessionStats.tokensPerSec >= 10 ? 0 : 1)}</b> tok/s
                  </span>
                  <span title={`缓存命中 ${fmtTokens(sessionStats.cachedTokens)} / 输入 ${fmtTokens(sessionStats.inputTokens)} tokens`}>
                    缓存 <b>{Math.round(sessionStats.cacheHitRate * 100)}%</b>
                  </span>
                  <span title={`本会话累计省下 ${fmtTokens(sessionStats.savedTokens)} tokens ≈ ¥${sessionStats.savedYuan.toFixed(4)}`}>
                    省 <b>{fmtTokens(sessionStats.savedTokens)}</b>
                  </span>
                  <span
                    className={sessionStats.contextPct > 0.8 ? 'hot' : ''}
                    title={`上下文 ${fmtTokens(sessionStats.contextUsed)} / ${fmtTokens(sessionStats.contextBudget)} tokens`}
                  >
                    上下文 <b>{Math.round(sessionStats.contextPct * 100)}%</b>
                  </span>
                </div>
              )}
              <span className="topbar-sub">
                {bots.find((b) => b.id === selectedBotId)?.name ?? ''} 值守中
              </span>
              <button
                className={`todo-chip ${todoOpen ? 'on' : ''}`}
                onClick={() => setTodoOpen((v) => !v)}
                title="任务清单：右侧面板，可勾选 / 导入 Markdown"
              >
                <Icon name="check" size={13} />
                {todos.length > 0 ? `${todos.filter((t) => t.done).length}/${todos.length}` : '清单'}
              </button>
              <button
                className="theme-btn"
                onClick={() => void cycleTheme()}
                title={`外观：${theme === 'auto' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}（点击切换）`}
              >
                <Icon name={theme === 'auto' ? 'monitor' : theme === 'dark' ? 'moon' : 'sun'} size={13} />
              </button>
              <button
                className={`sandbox-chip ${sandbox}`}
                onClick={() => void cycleSandbox()}
                title={`沙箱：${SANDBOX_HINT[sandbox]}（点击切换）`}
              >
                <Icon name="shield" size={12} /> {SANDBOX_LABEL[sandbox]}
              </button>
              <button
                className={`ctx-chip ${contextOpen ? 'on' : ''}`}
                onClick={() => setContextOpen((v) => !v)}
                title={`上下文洞察 · 已省 ${fmtTokens(insight?.savings?.totalTokens ?? 0)} tokens`}
              >
                <Icon name="context" size={13} />
                {insight ? `${fmtTokens(insight.used)} / ${fmtTokens(insight.budget)}` : '上下文'}
              </button>
              <WindowControls inline />
            </div>

            {openTabs.length > 0 && (
              <div className="session-tabs" role="tablist">
                {openTabs.map((id) => {
                  const s = sessions.find((x) => x.id === id);
                  if (!s) return null;
                  return (
                    <div
                      key={id}
                      role="tab"
                      aria-selected={id === activeId}
                      className={`session-tab ${id === activeId ? 'on' : ''}`}
                      onClick={() => void openSession(id)}
                      title={s.title}
                    >
                      {streams[id]?.active && <i className="tab-live" />}
                      <span className="tab-title">{s.title}</span>
                      <button
                        className="tab-close"
                        title="关闭标签（不删除会话）"
                        onClick={(e) => { e.stopPropagation(); closeTab(id); }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 审批卡浮层 */}
            <div className="approvals">
              {approvals.slice(0, 3).map((a) => (
                <div key={a.id} className={`approval-card ${a.risk}`}>
                  <div className="a-title">
                    <b>{a.botName}</b> 请求执行 <code>{a.tool}</code>
                    <span className={`risk-tag ${a.risk}`}>{a.risk === 'high' ? '高危' : '中危'}</span>
                  </div>
                  <div className="a-reason">{a.reason}</div>
                  <pre className="a-args">{JSON.stringify(a.args, null, 2).slice(0, 400)}</pre>
                  <div className="a-scope-hint">允许一次 / 本会话 / 总是允许 —— 后两者会写进「设置 → 已授权工具」</div>
                  <div className="a-actions">
                    <button className="approve" onClick={() => void decide(a.id, 'approved', 'once')}>允许一次</button>
                    <button onClick={() => void decide(a.id, 'approved', 'session')}>本会话</button>
                    <button onClick={() => void decide(a.id, 'approved', 'always')}>总是允许</button>
                    <button className="deny" onClick={() => void decide(a.id, 'denied')}>拒绝</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="chat-main">
              {sessionBots.length > 0 && (
                <aside className="bot-rail" aria-label="会话成员">
                  <span className="rail-label">成员</span>
                  {sessionBots.map((b) => (
                    <button
                      key={b.id}
                      className={`rail-btn ${stream.active && selectedBotId === b.id ? 'busy' : ''}`}
                      title={`跳到 ${b.name} 最后一条回复`}
                      onClick={() => jumpToBot(b.id)}
                    >
                      <span className="rail-ico"><BotIcon role={b.role} name={b.name} size={17} /></span>
                      <span className="rail-name">{b.name}</span>
                      {stream.active && selectedBotId === b.id && <i className="rail-dot" />}
                    </button>
                  ))}
                </aside>
              )}
              <div className="chat-scroll" ref={scrollRef} onScroll={onThreadScroll}>
              <div className="thread">
                {messages.length === 0 && (
                  <div className="empty-hint">
                    <div className="empty-brand">
                      <span className="empty-wordmark">TriBot</span>
                      <span className="empty-dot">.</span>
                    </div>
                    <h2>把任务丢给一支 Bot 团队</h2>
                    <p>本地运行 · 多家模型任意混用 · 每一步都能看见、能拦住、能回看</p>
                    <div className="start-grid">
                      <button className="start-card" onClick={() => setInput('帮我调研一下 XX，出一份带来源的简报')}>
                        <span className="start-idx">01</span>
                        <span className="start-title">直接派活</span>
                        <span className="start-desc">「帮我调研 XX，出一份带来源的简报」</span>
                      </button>
                      <button className="start-card" onClick={() => setCardOpen(true)}>
                        <span className="start-idx">02</span>
                        <span className="start-title">按五要素下单</span>
                        <span className="start-desc">目标 / 数据源 / 限制 / 交付物 / 审批点</span>
                      </button>
                      <button className="start-card" onClick={() => setMode('compare')}>
                        <span className="start-idx">03</span>
                        <span className="start-title">同题对比</span>
                        <span className="start-desc">一个问题，三家模型并排回答</span>
                      </button>
                    </div>
                    <div className="empty-foot">
                      <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行 · <kbd>Ctrl</kbd>+<kbd>K</kbd> 命令面板 · 点「计划」先出方案再动手
                    </div>
                  </div>
                )}
                <MessageList messages={messages} bots={bots} />
                {stream.active && <StreamingBubble s={stream} />}
                {planCard && (
                  <div className="plan-card">
                    <div className="plan-head">
                      <span><Icon name="plan" size={13} /> 计划待确认</span>
                      <span className="plan-hint">批准后会切回执行模式</span>
                    </div>
                    <div className="plan-body"><Markdown text={planCard} /></div>
                    <div className="plan-actions">
                      <button
                        className="approve"
                        disabled={stream.active}
                        onClick={() => {
                          setPlanCard(null);
                          setPlanMode(false);
                          void send('按上面的计划开始执行', { plan: false });
                        }}
                      >
                        批准并执行
                      </button>
                      <button onClick={() => setPlanCard(null)}>继续完善</button>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
                {showJump && (
                  <button
                    className="jump-bottom"
                    onClick={() => {
                      stickToBottom.current = true;
                      setShowJump(false);
                      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }}
                  >
                    ↓ 最新
                  </button>
                )}
              </div>
            </div>
            </div>

            {/* ===== 输入区 ===== */}
            <div className="composer">
              {cardOpen && (
                <div className="task-card">
                  <div className="tc-head">任务卡（五要素：目标 / 数据源 / 限制 / 交付物 / 审批点）<button onClick={() => setCardOpen(false)}>收起</button></div>
                  <input placeholder="目标 *：要达成什么" value={card.goal} onChange={(e) => setCard({ ...card, goal: e.target.value })} />
                  <input placeholder="数据源：从哪里获取信息（可选）" value={card.sources ?? ''} onChange={(e) => setCard({ ...card, sources: e.target.value })} />
                  <input placeholder="限制：时间/预算/技术约束（可选）" value={card.constraints ?? ''} onChange={(e) => setCard({ ...card, constraints: e.target.value })} />
                  <input placeholder="交付物：要什么格式的结果（可选）" value={card.deliverable ?? ''} onChange={(e) => setCard({ ...card, deliverable: e.target.value })} />
                  <input placeholder="审批点：哪些动作需要先问我（可选）" value={card.reviewPoint ?? ''} onChange={(e) => setCard({ ...card, reviewPoint: e.target.value })} />
                </div>
              )}
              <div className="composer-tools">
              <div className="bot-picker" ref={botMenuRef}>
                <button
                  className="bot-picker-trigger"
                  title={selectedBot?.role}
                  onClick={() => setBotMenuOpen((v) => !v)}
                >
                  <BotIcon role={selectedBot?.role} name={selectedBot?.name} size={15} />
                  <span>{selectedBot?.name ?? '选 Bot'}</span>
                  <em>{BOT_TAG[selectedBot?.name ?? ''] ?? 'Bot'}</em>
                  <span className="bp-caret">▾</span>
                </button>
                {botMenuOpen && (
                  <div className="bot-picker-menu">
                    {bots.map((b) => (
                      <button
                        key={b.id}
                        className={selectedBotId === b.id ? 'on' : ''}
                        title={b.role}
                        onClick={() => { setSelectedBotId(b.id); setBotMenuOpen(false); }}
                      >
                        <BotIcon role={b.role} name={b.name} size={16} />
                        <span className="bp-name">{b.name}</span>
                        <span className="bp-tag">{BOT_TAG[b.name] ?? 'Bot'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
                <span className="flex1" />
                <button
                  className={`plan-toggle ${planMode ? 'on' : ''}`}
                  onClick={() => setPlanMode((v) => !v)}
                  title="计划模式：先出计划、等你批准再执行（写文件/跑命令/抓外网会被拦住）"
                >
                  <Icon name="plan" size={13} /> 计划
                </button>
                <Menu<ThinkingEffort>
                  label="思考"
                  tone={thinking}
                  value={thinking}
                  onChange={(v) => setThinking(v)}
                  title="思考程度：快速/标准不推理，深度才推理；会同时改变系统提示、温度与工具轮次上限"
                  options={[
                    { value: 'fast', name: '快速', hint: '不推理，首字最快' },
                    { value: 'standard', name: '标准', hint: '默认，平衡速度与质量' },
                    { value: 'deep', name: '深度', hint: '开推理，更稳但更慢' },
                  ]}
                />
                {pendingTrigger && effectiveThinking !== thinking && (
                  <span
                    className="trigger-hint"
                    title={`检测到「${pendingTrigger.matched}」，发送时自动按「${THINKING_LABEL[effectiveThinking]}」执行`}
                  >
                    <Icon name="spark" size={11} /> 自动升到{THINKING_LABEL[effectiveThinking]}
                  </span>
                )}
                <Menu<RoutingMode>
                  value={mode}
                  onChange={(v) => setMode(v)}
                  title="路由方式"
                  options={[
                    { value: 'auto', name: '自动路由', hint: '按任务难度选模型' },
                    { value: 'manual', name: '手动指定', hint: '固定用一个模型' },
                    { value: 'failover', name: '容错降级', hint: '失败自动换下一家' },
                    { value: 'compare', name: '同题对比', hint: '三家并排回答' },
                  ]}
                />
                {mode === 'manual' && (
                  <Menu<string>
                    value={manualModel || defaultModel}
                    onChange={(v) => setManualModel(v)}
                    title="指定模型（只列已拉取的）"
                    options={availableModels.length > 0 ? availableModels.map((m) => {
                      const has = !!providers.find((p) => p.id === m.provider)?.hasKey;
                      return {
                        value: m.id,
                        name: shortModelName(m.label),
                        hint: `${providers.find((p) => p.id === m.provider)?.label ?? m.provider} · ${m.tier}${has ? '' : ' · 未配置 Key'}`,
                        disabled: !has,
                      };
                    }) : [{ value: '', name: '还没有拉取模型', hint: '去 设置 → 模型与凭证 拉取', disabled: true }]}
                  />
                )}
                {mode === 'compare' && (
                  <div className="compare-picks">
                    {availableModels.length === 0 && <span className="cmp-empty">还没有拉取模型</span>}
                    {availableModels.map((m) => {
                      const p = providers.find((x) => x.id === m.provider);
                      const has = !!p?.hasKey;
                      const picked = compareModels.includes(m.id);
                      const full = compareModels.length >= 4 && !picked;
                      return (
                        <label
                          key={m.id}
                          className={`${picked ? 'on' : ''} ${!has || full ? 'off' : ''}`}
                          title={!has ? `${m.label}：${p?.label ?? m.provider} 未配置 Key` : full ? '最多同时对比 4 个模型' : `${p?.label ?? m.provider} · ${m.tier}`}
                        >
                          <input
                            type="checkbox"
                            disabled={!has || full}
                            checked={picked}
                            onChange={(e) => setCompareModels((cs) =>
                              e.target.checked ? [...cs, m.id] : cs.filter((x) => x !== m.id))}
                          />
                          {m.label}
                          <span className="cmp-prov">{p?.label ?? m.provider}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <button className="card-btn" title="把本地文件内容放进对话（任何模型都能读到）" onClick={() => void attachFile()}>
                  📎
                </button>
                <button className={`card-btn ${cardOpen ? 'on' : ''}`} title="任务五要素卡" onClick={() => setCardOpen(!cardOpen)}>
                  <Icon name="card" size={15} />
                </button>
              </div>
              {queue.length > 0 && (
                <div className="queue-bar">
                  <span className="queue-label">排队 {queue.length}</span>
                  {queue.map((q, i) => (
                    <div className={`queue-chip ${i === 0 ? 'head' : ''}`} key={q.id}>
                      <span className="qc-text" title={q.text}>{q.text.slice(0, 40)}</span>
                      <button title="插队到最前" onClick={() => updateQueue((qq) => [q, ...qq.filter((x) => x.id !== q.id)])}>↑</button>
                      <button
                        title="取出编辑"
                        onClick={() => {
                          updateQueue((qq) => qq.filter((x) => x.id !== q.id));
                          setInput(q.text);
                        }}
                      >✎</button>
                      <button title="删除" onClick={() => updateQueue((qq) => qq.filter((x) => x.id !== q.id))}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="input-row">
                <textarea
                  value={input}
                  placeholder={cardOpen ? '补充说明（可留空，点发送直接按任务卡派活）…' : `给 ${bots.find((b) => b.id === selectedBotId)?.name ?? 'Bot'} 发任务…（Enter 发送 / Shift+Enter 换行）`}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                  }}
                  rows={2}
                />
                {stream.active ? (
                  <button className="send stop" onClick={() => void stopGeneration()} title="停止当前回复（已排队的消息会保留）">
                    停止
                  </button>
                ) : (
                  <button className="send" disabled={!input.trim()} onClick={() => void send()}>
                    发送 <Icon name="arrowUp" size={13} />
                  </button>
                )}
              </div>
              {errorMsg && <div className="error-bar" onClick={() => setErrorMsg('')}>⚠️ {errorMsg}（点击关闭）</div>}
            </div>
          </>
        )}

        {view === 'bots' && <BotsPanel bots={bots} models={models} onChanged={async () => setBots((await api.bots()).bots)} onBack={() => setView('chat')} />}
        {view === 'skills' && <SkillsPanel onChanged={() => {}} onBack={() => setView('chat')} />}
        {view === 'plugins' && <PluginsPanel onBack={() => setView('chat')} />}
        {view === 'routines' && <RoutinesPanel onOpenSession={openSession} onBack={() => setView('chat')} />}
        {view === 'settings' && <SettingsPanel onBack={() => setView('chat')} />}

        {view === 'chat' && contextOpen && (
          <>
            <div className="ctx-mask" onClick={() => setContextOpen(false)} />
            <ContextDrawer
              insight={insight}
              busy={contextBusy}
              onClose={() => setContextOpen(false)}
              onRefresh={() => void refreshInsight()}
              onCompact={() => void compactContext()}
            />
          </>
        )}
        {view === 'chat' && todoOpen && (
          <TodoDock
            todos={todos}
            checkpoints={checkpoints}
            onToggle={(id) => saveTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done, status: !t.done ? 'completed' : 'pending' } : t)))}
            onDelete={(id) => saveTodos(todos.filter((t) => t.id !== id))}
            onAdd={(text) => saveTodos([...todos, { id: `todo-${Date.now()}`, text, done: false, status: 'pending' }])}
            onReplace={(items) => saveTodos(items.map((it, i) => ({
              id: `todo-${Date.now()}-${i}`, text: it.text, done: it.done, status: it.done ? 'completed' : 'pending',
            })))}
            onRestoreCheckpoint={(id) => void restoreCp(id)}
            onClose={() => setTodoOpen(false)}
          />
        )}
      {previewPath && activeId && <FilePreview sessionId={activeId} path={previewPath} onClose={() => setPreviewPath(null)} />}
      </main>

      {paletteOpen && (
        <div className="modal-mask palette-mask" onClick={() => setPaletteOpen(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={paletteQ}
              placeholder="搜索会话 / Bot / 页面 / 操作…"
              onChange={(e) => { setPaletteQ(e.target.value); setPaletteIdx(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIdx((i) => Math.min(i + 1, paletteShown.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIdx((i) => Math.max(0, i - 1)); }
                else if (e.key === 'Enter') { paletteShown[paletteIdx]?.run(); }
              }}
            />
            <div className="palette-list">
              {paletteShown.map((it, i) => (
                <button
                  key={it.id}
                  className={`palette-item ${i === paletteIdx ? 'on' : ''}`}
                  onMouseEnter={() => setPaletteIdx(i)}
                  onClick={it.run}
                >
                  <span>{it.label}</span>
                  <em>{it.hint}</em>
                </button>
              ))}
              {paletteShown.length === 0 && <p className="palette-empty">没有匹配项</p>}
            </div>
            <div className="palette-foot">
              <kbd>↑ ↓</kbd> 选择 <kbd>Enter</kbd> 执行 <kbd>Esc</kbd> 关闭
            </div>
          </div>
        </div>
      )}

      {folderOpen && (
        <div className="modal-mask" onClick={() => setFolderOpen(false)}>
          <div className="modal folder-modal" onClick={(e) => e.stopPropagation()}>
            <h3>工作区</h3>
            <p className="muted">会话在这个工作区里读写文件、执行命令。第一个是主目录；可以加多个目录（参考资料、另一个项目），保存后立即生效。</p>
            <div className="ws-list">
              {folderList.map((p, i) => (
                <div className={`ws-card ${i === 0 ? 'primary' : ''}`} key={`${p}-${i}`}>
                  <div className="ws-card-main">
                    <b><Icon name="folder" size={13} /> {workspaceLabel(p, '任务目录')}</b>
                    <span className="ws-path" title={p}>{p}</span>
                  </div>
                  <div className="ws-card-actions">
                    {i === 0 ? (
                      <span className="folder-primary">主目录</span>
                    ) : (
                      <button onClick={() => setFolderList((list) => [p, ...list.filter((x) => x !== p)])}>
                        设为主目录
                      </button>
                    )}
                    <button className="danger" onClick={() => setFolderList((list) => list.filter((x) => x !== p))}>移除</button>
                  </div>
                </div>
              ))}
              {folderList.length === 0 && (
                <p className="folder-empty">还没有工作区，保存后会退回 Bot 默认工作区。</p>
              )}
            </div>
            <div className="folder-row">
              <input
                value={folderInput}
                placeholder="C:\path\to\another-folder"
                spellCheck={false}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); }}
              />
              {window.tribot?.chooseFolder && (
                <button
                  onClick={async () => {
                    const p = await window.tribot!.chooseFolder!();
                    if (p) setFolderList((list) => (list.some((x) => x.toLowerCase() === p.toLowerCase()) ? list : [...list, p]));
                  }}
                >
                  选择…
                </button>
              )}
              <button onClick={addFolder} disabled={!folderInput.trim()}>添加</button>
            </div>
            <div className="a-actions">
              <button className="approve" onClick={() => void saveFolder()}>保存</button>
              <button onClick={() => setFolderList([])}>用默认</button>
              <button onClick={() => setFolderOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 168), top: Math.min(ctxMenu.y, window.innerHeight - 56) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              setRenameTarget({ id: ctxMenu.id, title: ctxMenu.title });
              setRenameText(ctxMenu.title);
              setCtxMenu(null);
            }}
          >
            重命名会话
          </button>
          <button
            className="ctx-item danger"
            onClick={() => {
              const target = sessions.find((s) => s.id === ctxMenu.id);
              setDelTarget({
                id: ctxMenu.id,
                title: ctxMenu.title,
                workspace: target?.meta?.workspace as string | undefined,
              });
              setCtxMenu(null);
            }}
          >
            删除会话
          </button>
        </div>
      )}

      {renameTarget && (
        <div className="modal-mask" onClick={() => setRenameTarget(null)}>
          <div className="modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <h3>重命名会话</h3>
            <p className="muted">只改显示名称，不影响消息和工作区。</p>
            <input
              autoFocus
              value={renameText}
              maxLength={60}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void commitRename(); }
                if (e.key === 'Escape') setRenameTarget(null);
              }}
              placeholder="会话名称"
            />
            <div className="a-actions">
              <button className="approve" onClick={() => void commitRename()} disabled={!renameText.trim()}>保存</button>
              <button onClick={() => setRenameTarget(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {delTarget && (
        <div className="modal-mask" onClick={() => { if (!deleting) setDelTarget(null); }}>
          <div className="modal delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除会话</h3>
            <p className="muted">「{delTarget.title}」的全部消息、工具输出存档都会删掉，无法恢复。</p>
            <p className="muted delete-path">
              {delTarget.workspace
                ? <>任务目录：<code>{delTarget.workspace}</code>（在 data/tasks 下一并删除；你自己指定的项目目录只移除记录，不动文件）</>
                : '这个会话没有独立任务目录。'}
            </p>
            <div className="a-actions">
              <button className="danger" disabled={deleting} onClick={() => void removeSession()}>
                {deleting ? '删除中…' : '删除'}
              </button>
              <button onClick={() => setDelTarget(null)} disabled={deleting}>取消</button>
            </div>
          </div>
        </div>
      )}

      {onboard && (
        <Onboarding
          onDone={() => setOnboard(false)}
          onOpenSettings={() => { setView('settings'); }}
          onFinishFolder={(p) => {
            if (p && activeId) {
              void api.updateSession(activeId, { workspace: p })
                .then(() => refreshSessions())
                .catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}

// ---------- 上下文洞察抽屉 ----------
function ContextDrawer({ insight, busy, onClose, onRefresh, onCompact }: {
  insight: ContextInsight | null;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCompact: () => void;
}) {
  const used = insight?.used ?? 0;
  const budget = insight?.budget ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const hot = pct > 75;
  return (
    <aside className="ctx-drawer">
      <header className="ctx-head">
        <div>
          <h3>上下文洞察</h3>
          <p>中文 1 字 ≈ 1 token，英文 3.5 字符 ≈ 1 token（估算）</p>
        </div>
        <button className="icon-btn" onClick={onClose} title="关闭"><Icon name="close" size={14} /></button>
      </header>

      {!insight ? (
        <div className="ctx-empty">还没有会话内容</div>
      ) : (
        <>
          <div className="ctx-savings">
            <div className="cs-main">
              <b>{fmtTokens(insight.savings.totalTokens)}</b>
              <span>tokens 已省</span>
            </div>
            <div className="cs-sub">
              ≈ ¥{insight.savings.costSavedYuan.toFixed(4)} · 本会话累计（按 ¥{insight.savings.pricePerMTok}/M 输入价）
            </div>
            <div className="cs-detail">
              工具输出压缩 {fmtTokens(insight.savings.spillTokens)} · 摘要压缩 {fmtTokens(insight.savings.summaryTokens)}
            </div>
          </div>

          <div className="ctx-total">
            <div className="ctx-num">
              <b>{fmtTokens(insight.used)}</b>
              <span>/ {fmtTokens(insight.budget)} tokens</span>
            </div>
            <div className={`ctx-pct ${hot ? 'hot' : ''}`}>{pct}%</div>
          </div>
          <div className={`ctx-bar ${hot ? 'hot' : ''}`}><i style={{ width: `${pct}%` }} /></div>

          <div className="ctx-meta">
            <span>{insight.historyIncluded}/{insight.historyTotal} 条消息</span>
            <span>{insight.skills} 个技能</span>
            <span>{insight.tools} 个工具</span>
            {insight.compactions > 0 && <span className="ok">{insight.compactions} 次压缩</span>}
            <span className={insight.summarized ? 'ok' : ''}>
              {insight.summarized ? `已摘要 ${insight.summaryChars} 字` : '未压缩'}
            </span>
          </div>

          <div className="ctx-parts">
            {insight.parts.filter((p) => p.key !== 'saved').map((p) => (
              <div className="ctx-part" key={p.key}>
                <div className="ctx-part-head">
                  <span>{p.label}</span>
                  <b>{fmtTokens(p.tokens)}</b>
                </div>
                <div className="ctx-track"><i style={{ width: `${used > 0 ? Math.min(100, Math.max(1, (p.tokens / used) * 100)) : 0}%` }} /></div>
                {p.detail && <div className="ctx-detail">{p.detail}</div>}
              </div>
            ))}
          </div>

          <div className="ctx-suggests">
            <div className="ctx-sub">建议</div>
            {insight.suggestions.map((s, i) => <p key={i}>{s}</p>)}
          </div>

          <div className="ctx-actions">
            <button className="approve" disabled={busy} onClick={onCompact}>{busy ? '压缩中…' : '压缩上下文'}</button>
            <button onClick={onRefresh}><Icon name="refresh" size={13} /> 刷新</button>
          </div>
        </>
      )}
    </aside>
  );
}

// ---------- 消息渲染（对比消息分组并排）----------
function MessageList({ messages, bots }: { messages: ChatMessage[]; bots: Bot[] }) {
  const groups: Array<{ type: 'single'; m: ChatMessage } | { type: 'compare'; ms: ChatMessage[] }> = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (m.compareIndex != null) {
      if (last?.type === 'compare' && last.ms[0].botName?.split(' · ')[0] === m.botName?.split(' · ')[0] && last.ms.length < 4) {
        last.ms.push(m);
      } else {
        groups.push({ type: 'compare', ms: [m] });
      }
    } else {
      groups.push({ type: 'single', m });
    }
  }
  return (
    <>
      {groups.map((g, i) =>
        g.type === 'single' ? (
          <MessageBubble key={g.m.id} m={g.m} bots={bots} />
        ) : (
          <div className="compare-row" key={i}>
            {g.ms.map((m) => <MessageBubble key={m.id} m={m} bots={bots} compact />)}
          </div>
        ),
      )}
    </>
  );
}

function MessageBubble({ m, bots, compact }: { m: ChatMessage; bots: Bot[]; compact?: boolean }) {
  if (m.role === 'system') {
    return <div className="msg system"><Markdown text={m.content} /></div>;
  }
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          <Markdown text={m.content} />
          <div className="msg-foot"><CopyButton text={m.content} /></div>
        </div>
      </div>
    );
  }
  const bot = bots.find((b) => b.id === m.botId);
  return (
    <div className={`msg assistant ${compact ? 'compact' : ''}`} data-bot-id={m.botId}>
      <div className="msg-meta">
        <span className="avatar"><BotIcon role={bot?.role} name={bot?.name} size={15} /></span>
        <b>{m.botName ?? 'Bot'}</b>
        {m.model && (
          <span className={`model-badge ${m.degraded ? 'degraded' : ''}`} title={m.routeReason}>
            {m.model}{m.degraded ? ' ·已降级' : ''}
          </span>
        )}
        {m.usage && <span className="usage">{fmtTokens(m.usage.inputTokens)}→{fmtTokens(m.usage.outputTokens)} tok</span>}
        {m.usage?.cachedTokens ? (
          <span
            className="usage cache"
            title={`缓存命中 ${fmtTokens(m.usage.cachedTokens)} / 输入 ${fmtTokens(m.usage.inputTokens)} tokens`}
          >
            缓存 {Math.round((m.usage.cachedTokens / Math.max(1, m.usage.inputTokens)) * 100)}%
          </span>
        ) : null}
      </div>
      <div className="bubble">
        <Markdown text={m.content} />
        <div className="msg-foot"><CopyButton text={m.content} /></div>
      </div>
    </div>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch { /* file:// 或权限受限时走兜底 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`copy-btn ${done ? 'done' : ''}`}
      title="复制这条消息"
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? '已复制' : '复制'}
    </button>
  );
}

function StreamingBubble({ s }: { s: StreamingState }) {
  const hasContent = s.segments.some((seg) => seg.text.trim().length > 0);
  return (
    <div className="msg assistant streaming">
      <div className="msg-meta">
        <b>{s.botName ?? 'Bot'}</b>
        {s.route && (
          <span className={`model-badge ${s.route.degraded ? 'degraded' : ''}`} title={s.route.reason}>
            {s.route.model}{s.route.degraded ? ' · 已降级' : ''}
          </span>
        )}
        {s.notes.slice(-2).map((n, i) => <span key={i} className="note">{n}</span>)}
      </div>
      {s.segments.map((seg, i) => seg.channel === 'reasoning' ? (
        <div className="reasoning" key={`r-${i}`}><Markdown text={seg.text} /></div>
      ) : (
        <div className="bubble" key={`a-${i}`}><Markdown text={seg.text} /></div>
      ))}
      {!hasContent && <div className="typing">▍思考中…</div>}
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
