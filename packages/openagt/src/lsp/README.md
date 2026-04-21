# LSP (Language Server Protocol) 模块

LSP 服务器管理，提供语言智能（诊断、自动补全、跳转到定义等）。

---

## 目录

- [架构概览](#架构概览)
- [核心组件](#核心组件)
- [支持的 LSP 功能](#支持的-lsp-功能)
- [配置](#配置)
- [使用示例](#使用示例)
- [诊断格式](#诊断格式)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             LSP 架构                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     LSP Service                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │   │
│  │  │ LSP Client  │  │ LSP Server │  │  Launcher  │            │   │
│  │  │ (连接到     │  │ (stdio/TCP│  │  (自动检测 │            │   │
│  │  │  Language  │  │  进程)     │  │  LSP 服务器│            │   │
│  │  │  Server)   │  │            │  │  命令)     │            │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────┴───────────────────────────────┐   │
│  │                     Diagnostic Manager                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │   │
│  │  │  按文件     │  │  按严重级别 │  │  发布/订阅  │            │   │
│  │  │  聚合诊断   │  │  过滤       │  │  到 UI     │            │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心组件

### LSP Client (`client.ts`)

连接到语言服务器并发送请求：

```typescript
// 连接到 stdio LSP 服务器
const transport = new StdioTransport(serverPath, args, cwd)
await client.connect(transport)

// 发送请求
const result = await client.textDocument.rename({
  textDocument: { uri: fileUri },
  position: { line, character },
  newName: "newName",
})
```

### LSP Server (`server.ts`)

本地 LSP 服务器管理：

```typescript
// 自动检测并启动 LSP 服务器
const server = await detectAndLaunch(
  filePath,
  cwd,
  env,
  { trace LSP: "verbose" }
)
```

### Launcher (`launch.ts`)

自动检测文件类型并启动对应的 LSP 服务器：

```typescript
// 自动选择合适的 LSP 服务器
const server = await launchForFile(
  "/path/to/project/src/main.ts",
  {
    typescript: "typescript-language-server",
    javascript: "typescript-language-server",
    python: "python-lsp-server",
    rust: "rust-analyzer",
    go: "gopls",
  }
)
```

### Language Definitions (`language.ts`)

100+ 编程语言的扩展名到语言 ID 映射：

```typescript
// 部分映射
LANGUAGE_EXTENSIONS[".ts"] = "typescript"
LANGUAGE_EXTENSIONS[".py"] = "python"
LANGUAGE_EXTENSIONS[".rs"] = "rust"
LANGUAGE_EXTENSIONS[".go"] = "go"
```

### Diagnostic Manager (`diagnostic.ts`)

诊断信息聚合与发布：

```typescript
// 接收 LSP 诊断事件
client.on("textDocument/publishDiagnostics", (params) => {
  const { uri, diagnostics } = params
  // 按文件聚合
  // 按严重级别过滤
  // 发布到 UI 层
})
```

---

## 支持的 LSP 功能

| 功能 | 说明 |
|------|------|
| 诊断 (Diagnostics) | 编译错误、警告、lint 问题 |
| 自动补全 (Completion) | 智能补全建议 |
| 跳转到定义 (Goto Definition) | 跳转到符号定义位置 |
| 查找引用 (Find References) | 查找符号的所有引用 |
| 重命名 (Rename) | 符号重命名 |
| 悬停信息 (Hover) | 符号类型和文档 |
| 签名帮助 (Signature Help) | 函数参数签名 |
| 格式化 (Formatting) | 代码格式化 |
| 折叠 (Folding) | 折叠区域 |

---

## 配置

### LSP 服务器配置 (`opencode.json`)

```json
{
  "lsp": {
    "servers": {
      "typescript": {
        "command": "typescript-language-server",
        "args": ["--stdio"],
        "rootPatterns": ["tsconfig.json"]
      },
      "python": {
        "command": "python-lsp-server",
        "args": []
      }
    },
    "autoStart": true,
    "trace": "off"
  }
}
```

### 诊断过滤

```json
{
  "lsp": {
    "diagnosticFilters": [
      { "severity": "error", "ignore": false },
      { "severity": "warning", "ignore": false },
      { "severity": "information", "ignore": true },
      { "severity": "hint", "ignore": true }
    ]
  }
}
```

---

## 使用示例

### 获取文件诊断

```typescript
import { LSP } from "@/lsp"

// 获取当前打开文件的诊断
const diagnostics = await lsp.getDiagnostics(fileUri)
console.log(diagnostics)
// [{ range, severity, message, source }]
```

### 跳转到定义

```typescript
// 发送 gotoDefinition 请求
const result = await client.textDocument.definition({
  textDocument: { uri: fileUri },
  position: { line: 10, character: 5 },
})

if (result) {
  const location = Array.isArray(result) ? result[0] : result
  console.log("定义位置:", location.uri, location.range)
}
```

### 触发自动补全

```typescript
const completions = await client.textDocument.completion({
  textDocument: { uri: fileUri },
  position: { line: 10, character: 15 },
  context: { triggerKind: 1, triggerCharacter: "." }
})
```

---

## 诊断格式

LSP 诊断结果统一转换为以下格式：

```typescript
interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity: "error" | "warning" | "information" | "hint"
  message: string
  source: string          // 来源，如 "typescript", "eslint"
  code?: string | number  // 错误代码
  tags?: ("unnecessary" | "deprecated")[]
}
```

---

## 相关文档

- [LSP 规范](https://microsoft.github.io/language-server-protocol/)
- [主 README](../../README.md)
