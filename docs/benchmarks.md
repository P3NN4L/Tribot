# 流式速度基准（benchmarks）

- 生成时间：2026/10/27 00:30:40
- 服务端：`http://127.0.0.1:47615`（本地 dev server，真实 API）
- 测量口径：`scripts/bench-speed.mjs`（POST /api/chat 流式）
  - **TTFT** = 请求发出 → 第一个非 reasoning token（秒）
  - **总时** = 请求发出 → done（秒）；**tok/s** = outputTokens ÷ (总时 − TTFT)
  - 固定 prompt：`用三句话解释什么是缓存命中率。`，mode=manual，每组合 1 次

> 说明：`MiniMax-M3.1-Flash` 不在模型注册表（内置清单只有 MiniMax-M3 / M2）。
> 路由器按设计回退到可用模型，「实际路由」列如实记录回退结果，不是静默失败。

| 模型 · 档位 | TTFT (s) | 总时 (s) | 输出 tokens | tok/s | 实际路由 |
|---|---:|---:|---:|---:|---|
| glm-5.3 · 快速 | 3.68 | 5.10 | 83 | 58.3 | `glm-5.3` |
| glm-5.3 · 标准 | 7.07 | 8.84 | 156 | 88.4 | `glm-5.3` |
| glm-5.3 · 深度 | 12.85 | 15.56 | 637 | 235.5 | `glm-5.3` |
| glm-5.3-flash · 快速 | 4.71 | 7.11 | 111 | 46.2 | `glm-5.3-flash` |
| glm-5.3-flash · 标准 | 4.00 | 7.93 | 166 | 42.2 | `glm-5.3-flash` |
| glm-5.3-flash · 深度 | 13.65 | 16.29 | 579 | 219.4 | `glm-5.3-flash` |
| MiniMax-M3.1-Flash · 快速 | 1.19 | 2.05 | 122 | 142.5 | `MiniMax-M3.1-Flash` |
| MiniMax-M3.1-Flash · 标准 | 2.57 | 5.21 | 564 | 213.7 | `MiniMax-M3.1-Flash` |
| MiniMax-M3.1-Flash · 深度 | 6.30 | 10.83 | 844 | 186.6 | `MiniMax-M3.1-Flash` |

---

原始 JSONL（`scripts/bench-speed.mjs` 逐行输出）：

```json
{"model":"glm-5.3","thinking":"fast","ttft":"3.68","total":"5.10","outTokens":83,"tokPerSec":"58.3","chars":133,"route":"glm-5.3","sessionId":"8a9c02d4-ad40-4576-94f4-b3fe68d8da5b"}
{"model":"glm-5.3","thinking":"standard","ttft":"7.07","total":"8.84","outTokens":156,"tokPerSec":"88.4","chars":232,"route":"glm-5.3","sessionId":"f8cc5459-bcc0-4a80-8256-14bf6faf0655"}
{"model":"glm-5.3","thinking":"deep","ttft":"12.85","total":"15.56","outTokens":637,"tokPerSec":"235.5","chars":301,"route":"glm-5.3","sessionId":"86b47c4f-03d2-44d2-9dfa-a2eeb83a6741"}
{"model":"glm-5.3-flash","thinking":"fast","ttft":"4.71","total":"7.11","outTokens":111,"tokPerSec":"46.2","chars":182,"route":"glm-5.3-flash","sessionId":"3c6e85cf-6ddb-4e36-bbb4-c9a2ba98d6b2"}
{"model":"glm-5.3-flash","thinking":"standard","ttft":"4.00","total":"7.93","outTokens":166,"tokPerSec":"42.2","chars":275,"route":"glm-5.3-flash","sessionId":"a5f658cd-a967-4432-9584-bbfdde40d025"}
{"model":"glm-5.3-flash","thinking":"deep","ttft":"13.65","total":"16.29","outTokens":579,"tokPerSec":"219.4","chars":277,"route":"glm-5.3-flash","sessionId":"c133dcf8-b39c-4c9b-a48b-c631b65daaae"}
{"model":"MiniMax-M3.1-Flash","thinking":"fast","ttft":"1.19","total":"2.05","outTokens":122,"tokPerSec":"142.5","chars":234,"route":"MiniMax-M3.1-Flash","sessionId":"991a5c5a-cfe1-4ec5-8c00-a5987a9cb32e"}
{"model":"MiniMax-M3.1-Flash","thinking":"standard","ttft":"2.57","total":"5.21","outTokens":564,"tokPerSec":"213.7","chars":486,"route":"MiniMax-M3.1-Flash","sessionId":"8fc9093f-d2b9-4141-ab3f-66c4f193e540"}
{"model":"MiniMax-M3.1-Flash","thinking":"deep","ttft":"6.30","total":"10.83","outTokens":844,"tokPerSec":"186.6","chars":657,"route":"MiniMax-M3.1-Flash","sessionId":"654db41f-7c99-44d1-b640-8ce7ba30558e"}
```
