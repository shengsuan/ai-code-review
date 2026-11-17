# ai-code-review (`crv`)

只读的 AI 代码审查 Agent：CLI 独立运行，同时提供 MCP stdio Server 供 VS Code 等客户端调用。

## 快速开始

```bash
npm install && npm run build && npm link
crv config init --provider openai-chat
export OPENAI_API_KEY=...

crv review                     # 工作区：staged / unstaged / untracked
crv review --staged
crv review --base origin/main  # 当前分支 vs base
crv review --commit abc123
crv review --custom "重点检查并发与资源释放"
crv review --file src/a.ts
crv review -f sarif -o crv.sarif --fail-on high
crv history | crv show latest | crv explain <findingId>
crv serve                      # MCP stdio server
```

Provider 类型：`openai-chat`（/v1/chat/completions）、`openai-responses`（/v1/responses）、`anthropic`（/v1/messages）、`compatible`（任意 OpenAI 兼容服务，需 `baseUrl`）。

## VS Code / MCP

```json
{ "mcpServers": { "ai-code-review": { "type": "stdio", "command": "crv", "args": ["serve"] } } }
```

工具：`review_workspace`、`review_staged`、`review_file`、`get_review_report`、`explain_finding`。

## 配置

优先级：用户级 `~/.config/crv/config.json` < 项目级 `.crv/config.json` < 环境变量（`CRV_PROVIDER`、`CRV_MODEL`、`CRV_BASE_URL`、`CRV_API_KEY`）< CLI 参数。
项目规则写在 `.crv/rules.md`，自动注入审查提示词。`checks` 中预定义的命令（如 tsc、lint）可由 Agent 通过 `run_checks` 调用。

## 规则文件

`.crv/rules.json` 自动加载（也可用 `--rules my-rules.json` 或 MCP 的 `rules` 参数传入）：

```json
{
  "include": ["src/**/*.{ts,tsx}", "src/**/*.go"],
  "exclude": ["**/*.test.ts", "**/generated/**"],
  "rules": [
    { "path": "src/api/**/*.go", "rule": "All exported handlers must validate request bodies before use." },
    { "path": "**/*mapper*.xml", "rule": "Check SQL for injection risks, parameter errors, and missing closing tags." }
  ]
}
```

- `include`：非空时，只审查匹配的变更文件；`exclude`：排除匹配的文件。被跳过的文件会记录在报告的 `skipped` 中。
- `rules[].path` 可为单个 glob 或 glob 数组，对应规则只注入到包含匹配文件的审查批次，并在验证阶段一并提供。
- glob 不区分大小写，路径相对仓库根目录。未知字段会报错，避免拼写错误被静默忽略。
- 与 `.crv/rules.md`（全局纯文本规则）可同时使用。

## 流程

Diff 解析 → 上下文收集（AST 符号、定义、调用方）→ 分批审查（general / security）→ 去重 → 二次验证 → 置信度过滤 → 报告（terminal / json / sarif）。
报告保存在 `.crv/reviews/`。
