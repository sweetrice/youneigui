# 有内鬼 🎬

> **「有内鬼，终止交易。」** ——《无间道》2002

---

## 这是什么？

「有内鬼」是一个**双向平等、聊完即焚、零社交沉淀**的临时沟通协商窗口。

### 解决什么问题？

```
电话销售想加你微信介绍产品，你不想加但又不好意思拒绝
       ↓
你被困在一个「临时沟通」里，进退两难
       ↓
「有内鬼」提供一个协商窗口：
  ✅ 聊成了 → 自愿留联系方式（产品不干预）
  ✅ 聊崩了 → 任一方一键「结束会话」，数据立即清空
```

### 核心设计

- **双向平等终止权**：创建者和参与者任何一方都可以主动结束会话，对方无需确认
- **双层销毁**：手动终止（优先，立即可控）+ 到期自动销毁（兜底，防止遗忘）
- **零社交沉淀**：不做好友系统、不做历史消息、不存储联系人
- **真人验证**：OAuth 登录确保是真人，但不存储社交关系数据
- **Markdown 导出**：销毁前可导出会话留档，销毁后永久删除

---

## 快速开始（本地开发）

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（复制 .env.example）
cp .env.example .env
# 编辑 .env，填入 OAuth AppID/Secret

# 3. 启动 Redis（需要 Docker）
docker run -d --name youneigui-redis -p 6379:6379 redis:alpine

# 4. 启动开发服务器
npm run dev
# 访问 http://localhost:3000
```

## Docker Compose 部署

```bash
# 配置 .env 后一键启动
docker-compose up -d

# 访问 http://your-server:3000
```

## OAuth 配置说明

当前版本仅支持 **GitHub OAuth**，申请地址：

👉 [github.com/settings/developers → New OAuth App](https://github.com/settings/developers)

| 字段 | 填什么 |
|------|--------|
| Application name | 有内鬼 Dev（或自定义） |
| Homepage URL | `http://localhost:3000`（或你的部署域名） |
| Authorization callback URL | `http://localhost:3000/auth/github/callback`（必须精确匹配） |

创建后拿到 Client ID + Client Secret，填入 `.env`：

```bash
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

### 接入更多 OAuth 渠道（微信 / 微博 / Google / ...）

当前代码是按 **单 provider 可扩展架构** 设计的。要接入新渠道，核心步骤是：

1. 安装对应 passport strategy：`npm i passport-<provider>`
2. 在 `src/config.js` 加一段 `provider: { clientId, clientSecret }`
3. 在 `src/oauth/index.js` 里加一个新的 `passport.use(new Strategy(...))`
4. 在同文件里加两条路由 `/auth/<provider>` 和 `/auth/<provider>/callback`
5. 在登录页 HTML（同一个文件里的 router.get('/login') 内联模板）加一个按钮

**如果你希望接入新的 OAuth 渠道，推荐方式是：fork 本仓库后让 AI（例如 Trae / Cursor）根据 [passportjs.org/packages](https://www.passportjs.org/packages/) 的文档帮你写。** 把要接入的 provider 名称 + 申请好的 Client ID/Secret 告诉 AI，它能一次写对。

> 为什么 MVP 只留 GitHub？OAuth 渠道越多，测试矩阵越大（每个渠道的 callbackURL、scope、用户 profile 字段名都不同）。留一个跑通的，扩展交给社区和 AI。

---

## 多语言支持（i18n）

当前内置 **中文（默认）+ 英文**，顶部导航栏有 `EN / 中` 切换按钮，选择后存 `localStorage`，刷新即生效。

### 架构

- **前端**：`public/js/i18n.js` — 中文原文作为 key，运行时遍历 `<body>` 下所有文本节点匹配替换。现有 HTML **零改动**。
- **后端 Markdown 导出**：`src/export/routes.js` 接收 `?lang=en` 参数，两套模板（zh / en），`Date.toLocaleString` 也会切换 locale。

### 添加新语言（日语 / 韩语 / 法语 / ...）

1. 打开 `public/js/i18n.js`，复制 `LANGS.en` 改成 `LANGS.ja`（或 ko / fr / ...），逐条翻译
2. 打开 `src/export/routes.js`，复制 `I18N.en` 改成 `I18N.ja`，逐条翻译
3. 加一条 `case 'ja': ...` 切换 `dateLocale`
4. 顶部切换按钮显示的语言代码要更新 —— 在 `i18n.js` 的 `initI18n` 里把按钮文本改多态

**推荐方式：fork 后让 AI 根据当前 zh→en 词典，帮你翻译成目标语言。** 把要加的语言 + zh/en 词典文件路径告诉 AI，一次能写对。

---

## 项目结构

```
youneigui/
├── docs/
│   └── 产品需求说明书.md
├── src/
│   ├── oauth/        # OAuth 登录模块
│   ├── room/         # 房间（会话）管理模块
│   ├── ws/           # WebSocket 实时通信模块
│   └── export/       # Markdown 导出模块
├── public/           # 前端静态资源（单页 HTML + 原生 JS）
├── redis/            # Redis 数据模型和脚本
├── docker-compose.yml
├── .env.example
└── LICENSE
```

## 安全边界

- ✅ 全站 HTTPS
- ✅ 聊天内容只存 Redis 并设 TTL，不落持久库
- ✅ 导出文件即时生成返回，不留存
- ✅ 销毁后仅保留脱敏审计日志（房间ID、时间、人数），不含聊天内容

> 本产品用于隐私友好的临时沟通，不构成合规涉密通信方案，不替代 NDA 或正式合同。

## 明确不做

- ❌ 不加好友、不建群、不提供对方资料页
- ❌ 不做历史会话列表
- ❌ 不做已读回执、在线状态
- ❌ 不获取微信/微博昵称头像
- ❌ 不提供一键跳转微信或复制微信号
- ❌ 不阻止截图（截图无法技术阻止）

## 许可证

AGPL-3.0 © 有内鬼开发者

## 贡献

欢迎提交 Issue 和 PR。开源验证项目，大家一起来完善。

---

### 已知风险

- 微信内置浏览器对第三方 OAuth 回调可能有拦截，需实测
- 微信 snsapi_base 网页授权需已认证服务号
- 截图无法技术阻止，产品只降低「对话长期残留」风险
