#!/usr/bin/env node
// 挂死不响应的假 MCP 服务器（测试夹具）：读 stdin 但永不回复任何 JSON-RPC 请求。
// 用法：node mcp-hang.mjs <pidFile>   （把自己的 PID 写进 pidFile，供测试事后探活）
import fs from 'node:fs';

const pidFile = process.argv[2];
if (pidFile) fs.writeFileSync(pidFile, String(process.pid));
process.stdin.resume();
process.stdin.on('data', () => { /* 吞掉请求，故意不响应 */ });
