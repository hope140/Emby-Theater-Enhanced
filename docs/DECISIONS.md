# 长期决策

以下按本轮任务范围建立，未来产品功能需要用户确认后再进入实现。

| 决策 | 原因与落实 |
|---|---|
| Windows First | 先稳定当前 Windows/Carnival 的 native 依赖与部署布局 |
| Emby Only | 保留原客户端身份、PlaybackInfo 与控制协议 |
| Embedded libmpv Only | 正式视频能力集中在内嵌播放器，外置入口先禁用后验收 |
| STRM Only Enhancement | 普通媒体保留基线行为；当前仅对明确 STRM 尝试 Mount，失败回 native |
| Deterministic Mount Before Native | 只尝试 sidecar stem、明确本地 sourcePath、URL pathname 文件名及 `name`/`filename`/`file_name`；必须通过本地存在检查，不做模糊映射或扫描 |
| Transcode Protection | Transcode 上下文不替换 source，优先保持 PlaybackManager 已选择的播放语义 |
| Native Always Fallback | 后续增强失败时返回本次原生 source |
| Resolver Changes Source Only | 不重建身份、不绕过 PlaybackManager、不另起播放会话 |
| Preserve Emby Session | 进度、WebSocket、远控、队列及 EmbyWatchTogether 是必要验收条件 |
| Electron Frozen For Now | 使用实际随包 18.3.15，不依据 package.json 安装新 Electron |
| CD2 Does Not Require Server Plugin | 后续 CD2 是客户端增强路径，服务器插件只作参考 |
| CD2 V1 Uses Same-origin HTTP | main-process grpc-js 只请求 `get_direct_url=false`；CD2 成功后只替换 libmpv source，失败继续 Mount → Native；DirectUrl 留到独立 PR |
| CD2 DirectUrl Is Capability-gated | PR #4 只在 URL、expiry、空 additionalHeaders 与受限 User-Agent 全部安全时使用 DirectUrl；UA 仅通过 mpv file-local loadfile option，任何不安全能力都回到 same-origin → Mount → Native |
| CD2 Credentials Stay in Main | token、Bearer metadata、proto client 与 active calls 不进入 renderer；当前通过环境变量或 ignored local config 注入，不做设置 UI |
| Async Playback Uses Generation | PlaybackManager request id 与 libmpv generation 共同阻止旧 Play/NextTrack/Stop 的 late response、旧 `core-playing` 和旧 error recovery |
| CD2 Lookup Fails Fast | readiness 200ms、Find 350ms、download 300ms，共享 750ms absolute budget；V1 不 retry、refresh、预热或持久缓存 URL |
| Self-use First | 先证明本地客户端正常，再讨论发布与更大兼容范围 |
| Vendor 原件 + src 覆盖 | 保留来源与可比较基线，维护明文层；构建校验所有 vendor 哈希 |
| 新输出目录 | 构建拒绝覆盖已有产物，避免修改运行中的客户端或丢失证据 |
| Enhanced 独立数据目录 | Program Files 应用目录保持静态，与旧 Carnival 配置分离 |
| 新增诊断有界且保持播放语义 | 不支持属性、IPC/日志错误不得阻塞播放；只使用自有瞬态 user-data 槽获取精确缓存文本，不改变媒体/缓存选项；新增日志不记录媒体地址 |
| OBSERVABILITY MUST NOT AFFECT PLAYBACK | 客户端诊断只观察既有 resolver、CD2、Mount 和 libmpv 生命周期；日志、轮转、脱敏、导出或 IPC 失败均 fail-open，不改变 source、timeout、fallback、Session 或远控语义 |
| 公开基线使用 GPL-2.0-only | 官方 Windows/Electron 对照仓库均附 GPL v2 文本；维护源码未证明 `or later` 授权，因此不扩大许可范围；未知 Carnival、Web snapshot 和二进制不进入首个公开提交 |
| 模型按风险而非规模分级 | 默认 Tier 1（Luna）执行规格清楚的工作；Playback/Session/底层兼容等不确定任务才升 Tier 2（Sol）；Sol High 一轮仍无解或重大架构/许可风险才考虑 Tier 3（GPT-6） |

安装器选用项目内 Inno Setup 6.7.3 编译器，职责仅安装、快捷方式、卸载与覆盖升级；不引入 Forge、native rebuild 或大型框架。0.1.1 已完成用户授权的独立目录安装/覆盖/卸载测试；后续系统安装仍须在明确授权范围内执行。
