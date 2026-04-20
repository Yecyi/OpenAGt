# OpenAGt Web Documentation

基于 Astro + Starlight 构建的 OpenAGt 官方文档站点。

---

## 目录

- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [开发](#开发)
- [内容创作](#内容创作)
  - [文档格式](#文档格式)
  - [组件](#组件)
  - [内置组件示例](#内置组件示例)
- [配置](#配置)
  - [starlight.config.ts](#starlightconfigts)
- [部署](#部署)
  - [Vercel](#vercel)
  - [Cloudflare Pages](#cloudflare-pages)
- [相关文档](#相关文档)

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Astro + Starlight |
| 内容 | MDX |
| 部署 | Vercel / Netlify / Cloudflare Pages |
| 搜索 | Algolia DocSearch (可选) |

## 目录结构

```
web/
├── src/
│   ├── content/
│   │   └── docs/           # 文档内容
│   │       ├── getting-started/
│   │       ├── guides/
│   │       ├── configuration/
│   │       └── api/
│   ├── assets/             # 静态资源
│   └── env.d.ts
├── public/                  # 公共资源
├── astro.config.mjs       # Astro 配置
├── package.json
└── tsconfig.json
```

## 开发

```bash
# 安装依赖
npm install

# 本地开发
npm run dev
# 访问 http://localhost:4321

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 内容创作

### 文档格式

```markdown
---
title: 页面标题
description: 简短描述
sidebar:
  label: 侧边栏标签
  order: 1
---

# 大标题

内容支持 MDX 语法。

## 代码块

```typescript
const hello = "world"
```
```

### 组件

Starlight 提供丰富的内置组件：

- `<Card>` - 信息卡片
- `<CardGrid>` - 卡片网格
- `<LinkCard>` - 链接卡片
- `<Steps>` - 步骤列表
- `<Tabs>` - 标签页
- `<TabItem>` - 标签内容

### 内置组件示例

```markdown
import { Tabs, TabItem } from '@astrojs/starlight/components'

<Tabs>
  <TabItem label="npm">
    ```bash
    npm install
    ```
  </TabItem>
  <TabItem label="pnpm">
    ```bash
    pnpm install
    ```
  </TabItem>
</Tabs>
```

## 配置

### starlight.config.ts

```typescript
import { defineConfig } from '@astrojs/starlight'

export default defineConfig({
  title: 'OpenAGt',
  description: 'Enhanced AI coding agent',
  
  social: {
    github: 'https://github.com/your-repo/openag',
  },
  
  sidebar: [
    {
      label: 'Getting Started',
      items: [
        { label: 'Introduction', link: '/getting-started/' },
        { label: 'Installation', link: '/getting-started/installation' },
      ],
    },
  ],
  
  components: {
    // 自定义组件
  },
})
```

## 部署

### Vercel

```bash
# vercel.json (可选)
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

### Cloudflare Pages

```bash
# 构建命令
npm run build

# 输出目录
dist
```

## 相关文档

- [Starlight 文档](https://starlight.astro.build/)
- [Astro 文档](https://docs.astro.build)
- [主 README](../../README.md)
