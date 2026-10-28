#!/usr/bin/env node
// 最小 MCP stdio 假服务器（测试夹具）：只实现 initialize / notifications/initialized / tools/list / tools/call
// 用法：node mcp-echo.mjs   （stdin/stdout 各行一个 JSON）
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-echo', version: '0.0.1' },
      },
    });
  } else if (msg.method === 'notifications/initialized') {
    // 通知，无需响应
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'echo', description: '把 arguments 原样回声返回' },
          { name: 'fail_always', description: '总是返回 isError 的工具' },
        ],
      },
    });
  } else if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `echo: ${JSON.stringify(msg.params?.arguments ?? {})}` }],
          isError: false,
        },
      });
    } else if (name === 'fail_always') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: '这是工具内部错误（isError=true）' }],
          isError: true,
        },
      });
    } else {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32602, message: `未知工具：${name}` },
      });
    }
  }
});
