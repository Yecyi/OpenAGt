import type { TaskType } from "@/coordinator/schema"

export const IntentDictionary = {
  broadModifiers: {
    en: ["deep dive", "dive deeper", "thorough", "comprehensive", "full", "entire", "whole", "all files"],
    zh: ["深入", "深度", "完整", "全面", "彻底", "全部", "全量", "详细", "仔细"],
  },
  projectTargets: {
    en: [
      "project",
      "repo",
      "repository",
      "codebase",
      "workspace",
      "source tree",
      "src directory",
      "package structure",
    ],
    zh: ["项目", "仓库", "代码库", "工作区", "源码", "工程", "目录结构", "包结构"],
  },
  technicalTargets: {
    en: [
      "architecture",
      "technical detail",
      "technical details",
      "technological detail",
      "technological details",
      "key technology",
      "key technological",
      "algorithms",
      "algorithm",
      "internals",
      "structure",
    ],
    zh: ["架构", "算法", "技术细节", "技术详情", "核心技术", "项目结构", "内部实现", "运行逻辑", "系统结构"],
  },
  explicitProjectPhrases: {
    en: [
      "full project",
      "entire project",
      "whole project",
      "codebase overview",
      "project overview",
      "project architecture",
      "project structure",
      "repository structure",
      "how this project works",
      "how the project works",
    ],
    zh: ["完整项目", "整个项目", "全项目", "代码库概览", "项目概览", "项目架构", "项目结构", "仓库结构"],
  },
  workflow: [
    {
      workflow: "review",
      en: ["review", "code review", "pull request", "pr "],
      zh: ["审查", "代码审查", "评审", "拉取请求"],
    },
    {
      workflow: "debugging",
      en: ["debug", "bug", "error", "fail", "failing", "fix", "incident", "outage"],
      zh: ["调试", "排查", "错误", "失败", "修复", "故障", "事故", "丢失"],
    },
    {
      workflow: "writing",
      en: ["write", "draft", "essay", "article", "copy", "story", "blog"],
      zh: ["写", "撰写", "草稿", "文章", "文案", "博客"],
    },
    {
      workflow: "data-analysis",
      en: ["data analysis", "analyze dataset", "spreadsheet", "statistics", "stats", "chart", "csv", "xlsx"],
      zh: ["数据分析", "数据集", "表格", "统计", "图表"],
    },
    {
      workflow: "coding",
      en: ["implement", "code", "refactor", "test", "typescript", "api", "frontend", "backend"],
      zh: ["实现", "编码", "重构", "测试", "前端", "后端", "接口"],
    },
    {
      workflow: "planning",
      en: ["plan", "roadmap", "strategy", "timeline", "milestone"],
      zh: ["计划", "路线图", "策略", "时间线", "里程碑"],
    },
    {
      workflow: "personal-admin",
      en: ["calendar", "email", "inbox", "personal admin", "follow up", "follow-up"],
      zh: ["日历", "邮件", "收件箱", "个人事务", "跟进"],
    },
    {
      workflow: "research",
      en: ["research", "investigate", "analysis", "analyze", "explore"],
      zh: ["研究", "调查", "分析", "探索"],
    },
    {
      workflow: "documentation",
      en: ["doc", "readme", "documentation"],
      zh: ["文档", "说明", "README"],
    },
    {
      workflow: "environment-audit",
      en: ["environment", "audit", "install", "path", "powershell", "python", "toolchain"],
      zh: ["环境", "审计", "安装", "路径", "工具链"],
    },
    {
      workflow: "automation",
      en: ["automation", "automate", "schedule", "cron", "trigger"],
      zh: ["自动化", "定时", "触发器", "计划任务"],
    },
    {
      workflow: "file-data-organization",
      en: ["organize", "file organization", "folder", "cleanup files"],
      zh: ["整理文件", "文件整理", "文件夹", "归档"],
    },
  ] as const satisfies ReadonlyArray<{
    workflow: TaskType
    en: readonly string[]
    zh: readonly string[]
  }>,
  risk: {
    high: {
      en: [
        "delete",
        "drop",
        "reset",
        "wipe",
        "production",
        "prod",
        "deploy",
        "payment",
        "credential",
        "database",
        "data loss",
        "lost data",
      ],
      zh: ["删除", "清空", "重置", "生产", "线上", "部署", "支付", "凭据", "密钥", "数据库", "数据丢失", "丢失"],
    },
  },
} as const

export function hasAnyTerm(value: string, terms: readonly string[]) {
  return terms.some((item) => value.includes(item.toLowerCase()))
}

export function hasAnyRawTerm(value: string, terms: readonly string[]) {
  return terms.some((item) => value.includes(item))
}
