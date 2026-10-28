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
var inject = ["inputTriggers"];
var ROLES = [
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
        const rows = q ? ROLES.filter(
          (role) => role.id.includes(q) || role.name.includes(q) || role.description.includes(q)
        ) : ROLES;
        return rows.map((role) => ({
          name: role.name,
          value: role.id,
          description: role.description
        }));
      },
      onPick({ candidate }) {
        const role = ROLES.find((item) => item.id === candidate.value) ?? ROLES[0];
        return { text: `/tribot ${role.name} ` };
      }
    }),
    "tribot-role-picker: # source"
  );
}
return module.exports; } });
