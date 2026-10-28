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
var import_jsx_runtime = require("react/jsx-runtime");
var ROLES = [
  { name: "\u603B\u7BA1", emoji: "\u{1F9ED}", desc: "\u62C6\u89E3\u3001\u5206\u6D3E\u3001\u5408\u5E76\u3001\u9A8C\u6536" },
  { name: "\u7814\u7A76\u5458", emoji: "\u{1F50D}", desc: "\u68C0\u7D22\u3001\u6765\u6E90\u5206\u7EA7\u3001\u4EA4\u53C9\u9A8C\u8BC1" },
  { name: "\u5DE5\u7A0B\u5E08", emoji: "\u{1F6E0}", desc: "\u8BFB\u6539\u6587\u4EF6\u3001\u8DD1\u547D\u4EE4\u3001\u9A8C\u8BC1" },
  { name: "\u7BA1\u5BB6", emoji: "\u23F0", desc: "\u5DE1\u68C0\u3001\u9608\u503C\u5224\u7EA7\u3001\u5F02\u5E38\u7B80\u62A5" },
  { name: "\u5BA1\u7A3F\u4EBA", emoji: "\u{1F9EA}", desc: "\u5BF9\u6297\u5BA1\u67E5\uFF1A\u7ED3\u8BBA/\u5F15\u7528/\u8FB9\u754C" },
  { name: "\u56E2\u961F", emoji: "\u{1F465}", desc: "\u603B\u7BA1 \u2192 \u4E13\u5BB6 \u2192 \u5BA1\u7A3F\u4EBA" }
];
function applyRole(draft, name) {
  const rest = draft.replace(/^\/tribot\s+\S+\s*/u, "");
  return `/tribot ${name} ${rest}`.trimEnd() + " ";
}
function RoleDock(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const draft = props?.input?.draft ?? "";
  const active = ROLES.find((role) => draft.startsWith(`/tribot ${role.name}`));
  const label = active ? `${active.emoji} ${active.name}` : "\u9009\u62E9 Bot \u89D2\u8272";
  const pick = (name) => {
    props?.inputActions?.setDraft?.(applyRole(draft, name));
    setOpen(false);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsh-color-text-tertiary, #8a8a8a)" }, children: "TriBot" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((value) => !value),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 10px",
          borderRadius: 13,
          border: "1px solid var(--dsh-color-border, #d8d2c4)",
          background: "var(--dsh-color-bg-elevated, #fffdf7)",
          color: "var(--dsh-color-text, #2b2a26)",
          fontSize: 12,
          cursor: "pointer"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 9, opacity: 0.6 }, children: "\u25BE" })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        role: "menu",
        style: {
          position: "absolute",
          bottom: 34,
          left: 48,
          zIndex: 50,
          width: 260,
          padding: 6,
          borderRadius: 10,
          border: "1px solid var(--dsh-color-border, #d8d2c4)",
          background: "var(--dsh-color-bg-elevated, #fffdf7)",
          boxShadow: "0 12px 32px rgba(0,0,0,.18)"
        },
        children: ROLES.map((role) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            onClick: () => pick(role.name),
            style: {
              display: "flex",
              width: "100%",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: 0,
              borderRadius: 7,
              background: active?.name === role.name ? "rgba(180,140,60,.12)" : "transparent",
              color: "inherit",
              textAlign: "left",
              cursor: "pointer"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: 18, textAlign: "center" }, children: role.emoji }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "flex", flexDirection: "column", gap: 1 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 13 }, children: role.name }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, opacity: 0.55 }, children: role.desc })
              ] })
            ]
          },
          role.name
        ))
      }
    )
  ] });
}

// src/client/index.ts
var inject = ["inputTriggers", "slots"];
var ROLES2 = [
  { id: "dispatcher", name: "\u603B\u7BA1", description: "\u62C6\u89E3\u3001\u5206\u6D3E\u3001\u5408\u5E76\u3001\u9A8C\u6536" },
  { id: "researcher", name: "\u7814\u7A76\u5458", description: "\u68C0\u7D22\u3001\u6765\u6E90\u5206\u7EA7\u3001\u4EA4\u53C9\u9A8C\u8BC1" },
  { id: "engineer", name: "\u5DE5\u7A0B\u5E08", description: "\u8BFB\u6539\u6587\u4EF6\u3001\u8DD1\u547D\u4EE4\u3001\u9A8C\u8BC1" },
  { id: "steward", name: "\u7BA1\u5BB6", description: "\u5DE1\u68C0\u3001\u9608\u503C\u5224\u7EA7\u3001\u5F02\u5E38\u7B80\u62A5" },
  { id: "reviewer", name: "\u5BA1\u7A3F\u4EBA", description: "\u5BF9\u6297\u5BA1\u67E5\uFF1A\u7ED3\u8BBA/\u5F15\u7528/\u8FB9\u754C" },
  { id: "team", name: "\u56E2\u961F", description: "\u603B\u7BA1 \u2192 \u4E13\u5BB6 \u2192 \u5BA1\u7A3F\u4EBA \u6D41\u6C34\u7EBF" }
];
function apply(ctx) {
  const inputTriggers = ctx.get("inputTriggers");
  if (!inputTriggers?.registerSource) {
    console.warn("[tribot-role-picker] inputTriggers service is unavailable");
    return;
  }
  ctx.effect(
    () => inputTriggers.registerSource({
      trigger: "#",
      name: "tribot-role",
      candidates(_session, { query }) {
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
          order: 30
        },
        RoleDock
      )
    );
  } else {
    console.warn("[tribot-role-picker] slots service is unavailable");
  }
}
return module.exports; } });
