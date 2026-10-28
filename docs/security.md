# TriBot 凭证安全说明（自查报告）

> 结论先说：**API Key 不再明文落盘**；安装包、渲染层、日志里都没有完整 Key。
> 但任何本地应用都无法防住「同用户的恶意程序读内存/DPAPI」，这一点不能承诺。

## 1. Key 存在哪

| 位置 | 内容 | 保护 |
|---|---|---|
| `data/credentials.json` | `enc:v1:iv:tag:ct`（AES-256-GCM） | 没有主密钥无法解密 |
| `data/.masterkey`（桌面版） | 主密钥的 DPAPI 密文 | Windows 账户绑定；换用户/换机器解不开 |
| `data/.localkey`（纯命令行回退） | 32 字节随机主密钥 | 文件权限 0600；仅在本机可用 |
| `.env` | 可选的兜底 Key | **明文**；只要不写 .env 就不会有 |

桌面版启动时：Electron 用 `safeStorage`（Windows DPAPI / macOS Keychain）生成并保护主密钥，再通过子进程环境变量 `TRIBOT_MASTER_KEY` 传给本地 server；server 只监听 `127.0.0.1`。

## 2. 这次实际修了什么

之前用 `pnpm dev:server`（没有 Electron）跑时，`saveCredentials` 发现没有主密钥就**直接写明文**，而且启动迁移只在「已加密」时才执行，所以 `data/credentials.json` 里一直是明文。

现在：

- 没有 Electron 主密钥时，自动生成 `data/.localkey`（0600）并用它做 AES-256-GCM
- server 启动时**总是**重新落盘一次：明文会被加密；用 `.localkey` 加密过的、在桌面版拿到 DPAPI 主密钥后会被迁移成 DPAPI 版本
- 实测当前文件：`glm`/`minimax` 的 `apiKey` 均以 `enc:v1:` 开头

## 3. 发布包自查

- `release/**/resources/app` 里没有 `data/`、没有 `credentials.json`、没有 `.env`
- 在 `server.cjs`、`renderer/assets/*.js` 中搜索真实 Key 片段（前缀、尾号）→ **0 命中**
- 渲染层只拿 `hasKey` 与 `…sDpM` 尾号；`/api/providers` 不返回 Key；设置页的凭据接口只返回 mask 后的 hint
- 本地 HTTP 只绑定 `127.0.0.1`；SSE/接口没有把 Key 放进事件或工具参数

## 4. 仍然存在的风险

| 风险 | 说明 | 建议 |
|---|---|---|
| 同用户恶意程序 | 可读进程内存、可调 DPAPI、可读 `.localkey` | 不在不可信机器上填 Key |
| 本机管理员 | 可调试/注入进程 | 无法防御 |
| `.env` 兜底 | 明文 | 用了桌面版后删掉 .env 里的 Key |
| 账号被盗 | Key 本身泄露 | 到各供应商后台轮换 |
| 日志/崩溃转储 | Electron/Chromium 崩溃文件可能含内存 | 不共享崩溃转储 |

**能力边界**：客户端加密解决的是「文件被拷走 / 安装包被逆向 / 仓库泄露」；它解决不了「攻击者已经以你的账户运行代码」。

## 5. 复核命令

```powershell
# 1. 确认密文
node -e "const c=require('./data/credentials.json'); for (const [k,v] of Object.entries(c.providers)) console.log(k, v.apiKey ? v.apiKey.slice(0,7) : 'no key')"

# 2. 发布包不含 Key
Select-String -Path release/TriBot-win32-x64/resources/app/build/*.cjs `
  -Pattern '<your-provider-key-prefix>' -SimpleMatch

# 3. 发布包不含 data
Test-Path release/TriBot-win32-x64/resources/app/data
```
