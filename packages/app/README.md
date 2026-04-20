# OpenAGt Web Application

基于 SolidJS 的 Web 界面，提供会话管理和实时协作功能。

---

## 目录

- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [开发](#开发)
  - [环境变量](#环境变量)
  - [E2E 测试](#e2e-测试)
- [与后端通信](#与后端通信)
- [部署](#部署)
- [相关文档](#相关文档)

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端框架 | SolidJS |
| 构建工具 | Vite |
| 样式 | CSS Modules + CSS Variables |
| 测试 | Playwright (E2E) |
| 状态管理 | SolidJS createStore |

## 目录结构

```
app/
├── src/
│   ├── App.tsx              # 根组件
│   ├── index.tsx            # 入口文件
│   ├── routes/              # 路由
│   │   └── index.tsx
│   ├── components/          # UI 组件
│   │   ├── Chat/            # 聊天组件
│   │   ├── Editor/          # 编辑器组件
│   │   ├── Terminal/        # 终端模拟器
│   │   └── Settings/        # 设置面板
│   ├── stores/              # 状态管理
│   └── lib/                 # 工具函数
├── public/                  # 静态资源
├── test/
│   └── e2e/                 # E2E 测试
├── package.json
└── vite.config.ts
```

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev
# 访问 http://localhost:3000

# 构建生产版本
pnpm build

# E2E 测试
pnpm test:e2e:local
```

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PLAYWRIGHT_SERVER_HOST` | 后端地址 | `localhost` |
| `PLAYWRIGHT_SERVER_PORT` | 后端端口 | `4096` |
| `PLAYWRIGHT_PORT` | Vite 端口 | `3000` |

### E2E 测试

Playwright 自动启动 Vite dev server，要求后端运行在 `localhost:4096`。

```bash
# 安装 Playwright 浏览器
bunx playwright install chromium

# 运行所有 E2E 测试
bun run test:e2e:local

# 运行指定测试
bun run test:e2e:local -- --grep "settings"
```

## 与后端通信

Web 应用通过 HTTP + SSE 与后端通信：

```
┌─────────────┐          HTTP/SSE           ┌─────────────┐
│  SolidJS   │ ◀─────────────────────────▶ │   OpenAGt   │
│  Web App   │      GET /api/session/:id   │   Server   │
│            │      POST /api/prompt       │  (Hono)    │
└─────────────┘      GET /api/stream       └─────────────┘
```

## 部署

构建产物 (`dist/`) 可部署到任意静态托管服务：

- Netlify
- Vercel
- Surge
- Cloudflare Pages

## 相关文档

- [主 README](../../README.md)
- [SolidJS 文档](https://solidjs.com)
- [Vite 配置](https://vitejs.dev)
