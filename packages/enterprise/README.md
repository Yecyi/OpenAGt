# OpenAGt Enterprise

企业级功能扩展包，提供高级安全、合规和管理功能。

---

## 目录

- [核心特性](#核心特性)
  - [安全增强](#安全增强)
  - [管理功能](#管理功能)
- [架构](#架构)
- [部署选项](#部署选项)
  - [云部署](#云部署)
  - [容器化部署](#容器化部署)
- [配置](#配置)
  - [企业配置文件](#企业配置文件)
- [API 端点](#api-端点)
  - [管理 API](#管理-api)
  - [审计 API](#审计-api)
- [合规性](#合规性)
  - [支持的标准](#支持的标准)
- [集成](#集成)
  - [CI/CD 集成](#cicd-集成)
  - [ITSM 集成](#itsm-集成)
- [支持](#支持)
- [相关文档](#相关文档)

---

## 核心特性

### 安全增强

| 特性         | 描述                     |
| ------------ | ------------------------ |
| **SSO 集成** | SAML 2.0 / OIDC 企业认证 |
| **审计日志** | 完整的操作审计追踪       |
| **数据驻留** | 合规性数据存储控制       |
| **网络隔离** | VPC / 私有网络部署       |

### 管理功能

| 特性             | 描述               |
| ---------------- | ------------------ |
| **策略控制**     | 组织级别的使用策略 |
| **用量监控**     | Token 和成本分析   |
| **团队管理**     | 用户和权限管理     |
| **API 密钥管理** | 企业级密钥管理     |

## 架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Enterprise 架构                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐         ┌─────────────────┐                        │
│  │   Enterprise   │         │   Control     │                        │
│  │   Gateway      │◀───────▶│   Plane       │                        │
│  │  (Auth/Proxy) │         │               │                        │
│  └─────────────────┘         └─────────────────┘                        │
│           │                           │                                   │
│           ▼                           ▼                                   │
│  ┌─────────────────┐         ┌─────────────────┐                        │
│  │   SSO Provider  │         │   Audit Log   │                        │
│  │  (SAML/OIDC)   │         │   Storage     │                        │
│  └─────────────────┘         └─────────────────┘                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 部署选项

### 云部署

| 选项              | 提供商        | 说明         |
| ----------------- | ------------- | ------------ |
| **OpenAGt Cloud** | AWS/GCP/Azure | 完全托管服务 |
| **Private Cloud** | 客户云        | VPC 私有部署 |
| **On-Premise**    | 客户数据中心  | 物理机房部署 |

### 容器化部署

```yaml
# docker-compose.yml
services:
  opencode-enterprise:
    image: opencode/enterprise:latest
    environment:
      - SSO_ENABLED=true
      - SSO_METADATA_URL=${SSO_METADATA_URL}
      - AUDIT_STORAGE=s3
      - AUDIT_S3_BUCKET=${AUDIT_BUCKET}
    volumes:
      - audit-data:/data
```

## 配置

### 企业配置文件

```json
{
  "enterprise": {
    "organization": {
      "name": "Acme Corp",
      "domain": "acme.com"
    },
    "sso": {
      "type": "saml",
      "metadataUrl": "https://idp.acme.com/metadata",
      "entityId": "opencode-acme"
    },
    "audit": {
      "enabled": true,
      "storage": "s3",
      "retentionDays": 365
    },
    "policies": {
      "allowedModels": ["claude-sonnet-4", "gpt-4o"],
      "maxTokenPerMonth": 1000000000,
      "requireApprovalFor": ["bash", "write"]
    }
  }
}
```

## API 端点

### 管理 API

| 端点                       | 方法 | 描述     |
| -------------------------- | ---- | -------- |
| `/api/enterprise/teams`    | GET  | 列出团队 |
| `/api/enterprise/teams`    | POST | 创建团队 |
| `/api/enterprise/users`    | GET  | 列出用户 |
| `/api/enterprise/policies` | PUT  | 更新策略 |
| `/api/enterprise/usage`    | GET  | 用量统计 |

### 审计 API

| 端点                | 方法 | 描述         |
| ------------------- | ---- | ------------ |
| `/api/audit/events` | GET  | 查询审计事件 |
| `/api/audit/export` | POST | 导出审计日志 |

## 合规性

### 支持的标准

- **SOC 2 Type II** - 安全可用性
- **GDPR** - 数据保护
- **HIPAA** - 医疗数据 (可选)
- **ISO 27001** - 信息安全

## 集成

### CI/CD 集成

```yaml
# GitHub Actions
- name: Run OpenAGt Security Scan
  uses: opencode/enterprise-action@v1
  with:
    policy: enforce
    fail-on-violation: true
```

### ITSM 集成

- ServiceNow
- Jira Service Management
- PagerDuty

## 支持

| 等级           | 响应时间 | 渠道          |
| -------------- | -------- | ------------- |
| **Standard**   | 24h      | Email         |
| **Premium**    | 4h       | Email + Slack |
| **Enterprise** | 1h       | 专属 TAM      |

## 相关文档

- [主 README](../../README.md)
- [部署指南](docs/deployment/)
- [API 参考](docs/api/)
