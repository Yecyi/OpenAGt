# OpenAG Documentation

使用 [Mintlify](https://mintlify.com) 构建的 OpenAG 官方文档。

---

## 目录

- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [开发](#开发)
- [内容规范](#内容规范)
  - [页面结构](#页面结构)
  - [组件使用](#组件使用)
  - [导航配置](#导航配置)
- [发布](#发布)
- [相关文档](#相关文档)

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 文档框架 | Mintlify |
| 部署 | GitHub Pages |
| 编辑 | MDX |

## 目录结构

```
docs/
├── docs/                  # 文档内容
│   ├── getting-started/  # 入门指南
│   ├── guides/           # 使用指南
│   └── api/              # API 参考
├── public/               # 静态资源
├── mint.json            # Mintlify 配置
└── package.json
```

## 开发

```bash
# 安装 Mintlify CLI
npm i -g mint

# 本地预览
mint dev
# 访问 http://localhost:3000
```

## 内容规范

### 页面结构

```markdown
---
title: 页面标题
description: 简短描述
---

# 大标题

内容...
```

### 组件使用

Mintlify 提供丰富的组件：

- `<Card>` - 信息卡片
- `<CodeGroup>` - 代码分组
- `<ResponseField>` - API 响应字段
- `<RequestExample>` - 请求示例

### 导航配置

在 `mint.json` 中配置侧边栏和导航：

```json
{
  "navigation": [
    {
      "group": "Getting Started",
      "pages": ["getting-started/introduction"]
    }
  ]
}
```

## 发布

通过 GitHub App 自动部署到生产环境。推送到默认分支后会自动发布更改。

## 相关文档

- [Mintlify 文档](https://mintlify.com/docs)
- [Mintlify Starter Kit](https://starter.mintlify.com/quickstart)
- [主 README](../../README.md)
