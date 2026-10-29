window.__ModuleLoader__.load({ id: 'dsh-tribot-role-picker', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/RoleDock.tsx
var import_react = require("react");

// src/client/locales.ts
var NS = "tribot-role-picker";
var zh = {
  "choose": "\u9009\u62E9\u89D2\u8272",
  "chooseAria": "\u9009\u62E9 TriBot \u89D2\u8272",
  "menuAria": "TriBot \u89D2\u8272",
  "switchAria": "\u542F\u7528\u6216\u505C\u7528 TriBot \u89D2\u8272\u9009\u62E9\uFF08\u4EC5\u5F53\u524D\u4F1A\u8BDD\uFF09",
  "statsSaved": "\u5DF2\u7701",
  "statsCache": "\u7F13\u5B58",
  "statsTitle": "\u672C Harness \u8FD0\u884C\u4EE5\u6765\uFF0C\u5DE5\u5177\u8F93\u51FA\u538B\u7F29/\u53BB\u91CD\u7D2F\u8BA1\u907F\u514D\u7684 token \u4E0E\u7F13\u5B58\u547D\u4E2D\u7387\uFF08\u6570\u636E\u6765\u81EA save-token \u63D2\u4EF6\uFF09",
  "role.dispatcher": "\u603B\u7BA1",
  "role.dispatcher.desc": "\u62C6\u89E3\u3001\u5206\u6D3E\u3001\u5408\u5E76\u3001\u9A8C\u6536",
  "role.researcher": "\u7814\u7A76\u5458",
  "role.researcher.desc": "\u68C0\u7D22\u3001\u6765\u6E90\u5206\u7EA7\u3001\u4EA4\u53C9\u9A8C\u8BC1",
  "role.engineer": "\u5DE5\u7A0B\u5E08",
  "role.engineer.desc": "\u8BFB\u6539\u6587\u4EF6\u3001\u8DD1\u547D\u4EE4\u3001\u9A8C\u8BC1",
  "role.steward": "\u7BA1\u5BB6",
  "role.steward.desc": "\u5DE1\u68C0\u3001\u9608\u503C\u5224\u7EA7\u3001\u5F02\u5E38\u7B80\u62A5",
  "role.reviewer": "\u5BA1\u7A3F\u4EBA",
  "role.reviewer.desc": "\u5BF9\u6297\u5BA1\u67E5\uFF1A\u7ED3\u8BBA / \u5F15\u7528 / \u8FB9\u754C",
  "role.team": "\u56E2\u961F",
  "role.team.desc": "\u603B\u7BA1 \u2192 \u4E13\u5BB6 \u2192 \u5BA1\u7A3F\u4EBA"
};
var en = {
  "choose": "Choose role",
  "chooseAria": "Choose a TriBot role",
  "menuAria": "TriBot roles",
  "switchAria": "Enable or disable the TriBot role picker (this session only)",
  "statsSaved": "saved",
  "statsCache": "cache",
  "statsTitle": "Tokens avoided by output compression/dedupe and cache hit rate since this harness run (data from the save-token plugin)",
  "role.dispatcher": "Dispatcher",
  "role.dispatcher.desc": "Split, assign, merge, accept",
  "role.researcher": "Researcher",
  "role.researcher.desc": "Search, grade sources, cross-check",
  "role.engineer": "Engineer",
  "role.engineer.desc": "Read, edit, run, verify",
  "role.steward": "Steward",
  "role.steward.desc": "Inspect, grade, report exceptions",
  "role.reviewer": "Reviewer",
  "role.reviewer.desc": "Adversarial review: claims, citations, limits",
  "role.team": "Team",
  "role.team.desc": "Dispatcher \u2192 specialist \u2192 reviewer"
};

// src/client/RoleDock.tsx
var import_jsx_runtime = require("react/jsx-runtime");
async function fetchStats() {
  try {
    if (typeof fetch === "undefined") return null;
    const res = await fetch("/save-token/api/dashboard", { credentials: "same-origin" });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || typeof j.reliefPct !== "number") return null;
    return j;
  } catch {
    return null;
  }
}
function fmtTok(n) {
  return n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
}
var ROLES = [
  { id: "dispatcher", canonical: "\u603B\u7BA1", emoji: "\u{1F9ED}" },
  { id: "researcher", canonical: "\u7814\u7A76\u5458", emoji: "\u{1F50D}" },
  { id: "engineer", canonical: "\u5DE5\u7A0B\u5E08", emoji: "\u{1F6E0}" },
  { id: "steward", canonical: "\u7BA1\u5BB6", emoji: "\u23F0" },
  { id: "reviewer", canonical: "\u5BA1\u7A3F\u4EBA", emoji: "\u{1F9EA}" },
  { id: "team", canonical: "\u56E2\u961F", emoji: "\u{1F465}" }
];
var GLOBAL_KEY = "tribot-role-picker:enabled";
function sessionKey(sessionId) {
  return sessionId ? `${GLOBAL_KEY}:session:${sessionId}` : GLOBAL_KEY;
}
function readEnabled(sessionId) {
  try {
    if (typeof localStorage === "undefined") return true;
    if (sessionId) {
      const own = localStorage.getItem(sessionKey(sessionId));
      if (own !== null) return own !== "0";
    }
    return localStorage.getItem(GLOBAL_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeEnabled(sessionId, value) {
  try {
    localStorage.setItem(sessionKey(sessionId), value ? "1" : "0");
  } catch {
  }
}
function isPickerEnabled(sessionId) {
  return readEnabled(sessionId);
}
function applyRole(draft, canonical) {
  const rest = draft.replace(/^\/tribot\s+\S+\s*/u, "");
  return `/tribot ${canonical} ${rest}`.trimEnd() + " ";
}
function RoleDock(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const sessionId = props?.sessionId;
  const [enabled, setEnabled] = (0, import_react.useState)(() => readEnabled(sessionId));
  const [stats, setStats] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    let stop = false;
    const tick = async () => {
      const s = await fetchStats();
      if (!stop && s) setStats(s);
    };
    void tick();
    const timer = setInterval(tick, 5e3);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    setEnabled(readEnabled(sessionId));
  }, [sessionId]);
  const draft = props?.input?.draft ?? "";
  const matched = draft.match(/^\/tribot\s+(\S+)/u);
  const active = ROLES.find((role) => role.canonical === matched?.[1]);
  const isZh = String(props?.locale ?? (typeof navigator === "undefined" ? "" : navigator.language)).toLowerCase().startsWith("zh");
  const fallback = isZh ? zh : en;
  const t = (key) => props?.t?.(key) ?? fallback[key] ?? String(key);
  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    writeEnabled(sessionId, next);
    if (!next) {
      setOpen(false);
      try {
        const draft2 = props?.input?.draft ?? "";
        const marker = "[TriBot \u89D2\u8272\u5DF2\u505C\u7528\uFF0C\u9000\u51FA\u5F53\u524D\u89D2\u8272\uFF0C\u6062\u590D\u9ED8\u8BA4\u52A9\u624B\u6A21\u5F0F]";
        if (!draft2.includes("[TriBot \u89D2\u8272\u5DF2\u505C\u7528")) {
          props?.inputActions?.setDraft?.(draft2 + marker);
        }
      } catch {
      }
    }
  };
  const pick = (canonical) => {
    props?.inputActions?.setDraft?.(applyRole(draft, canonical));
    setOpen(false);
  };
  const switchButton = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: "tribot-role-switch",
      role: "switch",
      "aria-checked": enabled,
      "aria-label": t("switchAria"),
      title: t("switchAria"),
      onClick: toggleEnabled,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tribot-role-track", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tribot-role-knob" }) })
    }
  );
  if (!enabled) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tribot-role-dock", children: switchButton });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tribot-role-dock", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "tribot-role-trigger",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-label": t("chooseAria"),
        onClick: () => setOpen((value) => !value),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: active ? `${active.emoji} ${t(`role.${active.id}`)}` : t("choose") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tribot-role-caret", "aria-hidden": true, children: "\u25BE" })
        ]
      }
    ),
    switchButton,
    stats && (stats.totals?.avoidedTokens ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "tribot-role-stats", title: t("statsTitle"), children: [
      "\u26A1 ",
      t("statsSaved"),
      " \u2248",
      fmtTok(stats.totals?.avoidedTokens ?? 0),
      " tok\uFF08",
      stats.reliefPct,
      "%\uFF09\xB7 ",
      t("statsCache"),
      " ",
      stats.cacheHitPct,
      "%"
    ] }),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tribot-role-menu", role: "menu", "aria-label": t("menuAria"), children: ROLES.map((role) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        role: "menuitemradio",
        "aria-checked": active?.id === role.id,
        className: "tribot-role-item",
        onClick: () => pick(role.canonical),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tribot-role-emoji", "aria-hidden": true, children: role.emoji }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "tribot-role-copy", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tribot-role-name", children: t(`role.${role.id}`) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tribot-role-desc", children: t(`role.${role.id}.desc`) })
          ] })
        ]
      },
      role.id
    )) })
  ] });
}

// src/client/styles.ts
var installed = false;
var CSS = `
.tribot-role-dock {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px));
  max-width: var(--dsh-composer-card-max-width, 760px);
  min-width: 0;
  margin: 0 auto;
  padding: 2px 0;
  position: relative;
}

.tribot-role-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: border-color .12s ease, color .12s ease, background .12s ease;
}

.tribot-role-trigger:hover,
.tribot-role-trigger[aria-expanded='true'] {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}

.tribot-role-caret {
  font-size: 9px;
  opacity: .55;
}

.tribot-role-switch {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.tribot-role-track {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  transition: background .12s ease, border-color .12s ease;
}

.tribot-role-switch:hover .tribot-role-track {
  border-color: var(--dsw-alias-brand-primary);
}

.tribot-role-switch[aria-checked='true'] .tribot-role-track {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
}

.tribot-role-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  transition: left .12s ease, background .12s ease;
}

.tribot-role-switch[aria-checked='true'] .tribot-role-knob {
  left: 15px;
  background: var(--dsw-alias-bg-layer-1);
}


.tribot-role-stats {
  flex: none;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
  font-size: 11px;
  opacity: .65;
  white-space: nowrap;
}

.tribot-role-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 60;
  box-sizing: border-box;
  width: 270px;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
}

.tribot-role-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tribot-role-item:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent);
}

.tribot-role-item[aria-checked='true'] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}

.tribot-role-emoji {
  flex: none;
  width: 18px;
  text-align: center;
}

.tribot-role-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.tribot-role-name {
  font-size: 13px;
}

.tribot-role-desc {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
  font-size: 11px;
  opacity: .62;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
function adoptStyles() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.dataset.tribotRolePicker = "";
  style.textContent = CSS;
  document.head.append(style);
}

// src/client/index.ts
var inject = ["inputTriggers", "slots", "locale"];
var ROLES2 = [
  { id: "dispatcher", name: "\u603B\u7BA1", description: "\u62C6\u89E3\u3001\u5206\u6D3E\u3001\u5408\u5E76\u3001\u9A8C\u6536" },
  { id: "researcher", name: "\u7814\u7A76\u5458", description: "\u68C0\u7D22\u3001\u6765\u6E90\u5206\u7EA7\u3001\u4EA4\u53C9\u9A8C\u8BC1" },
  { id: "engineer", name: "\u5DE5\u7A0B\u5E08", description: "\u8BFB\u6539\u6587\u4EF6\u3001\u8DD1\u547D\u4EE4\u3001\u9A8C\u8BC1" },
  { id: "steward", name: "\u7BA1\u5BB6", description: "\u5DE1\u68C0\u3001\u9608\u503C\u5224\u7EA7\u3001\u5F02\u5E38\u7B80\u62A5" },
  { id: "reviewer", name: "\u5BA1\u7A3F\u4EBA", description: "\u5BF9\u6297\u5BA1\u67E5\uFF1A\u7ED3\u8BBA/\u5F15\u7528/\u8FB9\u754C" },
  { id: "team", name: "\u56E2\u961F", description: "\u603B\u7BA1 \u2192 \u4E13\u5BB6 \u2192 \u5BA1\u7A3F\u4EBA \u6D41\u6C34\u7EBF" }
];
function apply(ctx) {
  adoptStyles();
  const locale = ctx.locale;
  if (locale?.register) {
    ctx.effect(() => locale.register(NS, { zh, en }), "tribot-role-picker: dictionaries");
  }
  const inputTriggers = ctx.get("inputTriggers");
  if (!inputTriggers?.registerSource) {
    console.warn("[tribot-role-picker] inputTriggers service is unavailable");
    return;
  }
  ctx.effect(
    () => inputTriggers.registerSource({
      trigger: "#",
      name: "tribot-role",
      candidates(session, { query }) {
        if (!isPickerEnabled(session?.sessionId)) return [];
        const q = query.trim().toLowerCase();
        const rows = q ? ROLES2.filter(
          (role) => role.id.includes(q) || role.name.includes(q) || role.description.includes(q)
        ) : ROLES2;
        return rows.map((role) => ({
          name: role.name,
          value: role.id,
          description: role.description
        }));
      },
      onPick({ candidate }) {
        const role = ROLES2.find((item) => item.id === candidate.value) ?? ROLES2[0];
        return { text: `/tribot ${role.name} ` };
      }
    }),
    "tribot-role-picker: # source"
  );
  const slots = ctx.slots;
  if (slots?.inject) {
    slots.inject(
      "conversation.input.dock",
      () => slots.register(
        {
          name: "conversation.input.dock",
          id: "tribot-role-picker",
          order: 30,
          locale: NS,
          inject: (sessionId) => ({ sessionId })
        },
        RoleDock
      )
    );
  } else {
    console.warn("[tribot-role-picker] slots service is unavailable");
  }
}
return module.exports; } });
