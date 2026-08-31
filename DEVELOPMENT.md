# dsh-tool-google-drive 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-google-drive` |
| 定位 | DeepSeek Harness 的 Google Workspace 只读集成插件 |
| 版本 | v0.1.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | Google Drive API v3、Google Docs API v1、Google Sheets API v4 |
| 认证 | static access token 或 OAuth refresh token |

### 1.1 目录

```text
src/client.ts          GoogleDriveClient：token 管理、fetch 注入、超时、错误映射，以及 Drive/Docs/Sheets 映射
src/index.ts         9 个 defineTool 定义与插件 apply
scripts/auth-google.mjs  OAuth 授权辅助脚本，用于生成 refreshToken 配置
tests/client.spec.ts    客户端契约测试
tests/tools.spec.ts     工具注册、凭证保护、业务值测试
tests/auth-script.spec.ts OAuth helper 的非交互契约测试
examples/cordis.yml     dsh 组合配置示例
```

## 2. 技术决策

### 2.1 认证

Google Drive 插件支持两种常见场景：
- accessToken：直接使用现成 OAuth access token，适合本地快速接入。
- clientId + clientSecret + refreshToken：通过 OAuth refresh token 自动换取并缓存 access token。

`npm run auth:google` 提供本地授权辅助流程：生成 Google 授权 URL，监听 `127.0.0.1` loopback callback，用授权码请求 token endpoint，并输出可复制的 Cordis YAML。脚本使用 Node 内置模块实现，不引入 Google SDK 运行时依赖；授权 URL 包含 PKCE、`access_type=offline`、`prompt=consent` 与 `include_granted_scopes=true`。

### 2.2 工具范围

v0.1 覆盖高频只读 Workspace 工作流：
- 凭证检查。
- Drive 文件列表/搜索与元数据查看。
- Google Workspace 文件导出，例如 Google Docs 导出为 `text/plain`，或将 PDF 等二进制导出为 base64。
- Shared Drive 列表、详情，以及文件搜索里的 `supportsAllDrives` / `includeItemsFromAllDrives` / `corpora` / `driveId`。
- Google Docs 文档结构与文本提取。
- Google Sheets 表格元数据与 A1 范围值读取。

### 2.3 错误映射

| 场景 | 返回/行为 |
|---|---|
| 未配置凭证 | `{ ok: false, reason }` 或 `{ found: false, reason }` |
| Google OAuth / Drive / Docs / Sheets API 非 2xx | 抛 `GoogleDriveError` |
| 超时或网络失败 | 透传异常 |

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
```

当前测试覆盖：

- 静态 access token 认证。
- refresh token 换取 access token 与缓存。
- 文件搜索列表分页与查询参数。
- 文件元数据查询。
- Google Workspace 文件导出。
- Shared Drive 列表与详情。
- Google Docs 文本提取。
- Google Sheets 元数据与值读取。
- 工具注册、render 函数与输出 schema。
- OAuth helper `--print-url` 非交互路径、授权 URL 参数、secret 不出现在 URL/输出、自定义 scopes、端口配置和 npm/bin 入口。

## 4. 后续方向

- 多文件批量导出与本地落盘。
- Docs 结构化段落/标题/表格更细粒度输出。
- Sheets 批量 range 读取与更友好的表格渲染。
