# 变更记录

## 0.1.1 CloudDrive2 Resolver 候选 — 2026-09-13

- 新增 main-process CloudDrive2 gRPC transport、窄化 renderer IPC、单条安全 path mapping 与 same-origin download URL 校验。
- STRM source 优先级更新为 CD2 HTTP → Mount → Native；Transcode 保持 Native，DirectUrl 延后。
- 新增 PlaybackManager request id、libmpv generation、RPC cancel、旧 core-playing listener 清理与 750ms absolute budget。
- frozen runtime 构建精确复制 grpc-js/proto-loader production closure，并拒绝 native addon；两次构建与 installer 解包逐哈希一致。
- unit/fake/frozen runtime 与真实 CD2 只读 smoke 通过；真实 CD2 source replacement 已确认，但真实 media 起播与真实 Emby Session/控制仍待验收。

## 0.1.1 开发候选 — 2026-09-12

- 确认 native 缓存配置正确、legacy bridge 回传 int64 时截断；修复诊断的精确字节数记录并保留原始回传值。覆盖 900MiB 至 8192MiB 边界测试。
- 同 embed 诊断串行执行、直接匹配该 embed 的回复；精确文本不可用时如实记为 unavailable。
- 测试通过 MPV_HOME 实际隔离 native 配置；启动诊断区分候选配置文件与真实加载证据。
- 新增真实 PlaybackManager、ApiClient 报告序列化和消息分派的本地集成测试，普通视频、STRM、Pause/Resume/Seek/Stop/Next 全部通过。服务器部分为 fixture，实际 Emby 验收仍待用户样本。
- 新版 runtime、安装包已生成；保持 Electron 与 native binary 基线。

## 0.1.0 开发候选 — 2026-09-12

- 建立 Carnival + 综合补丁基线、可维护应用源码、SHA256 文件清单和知识库。
- 新增 vendor 校验、可重复 portable runtime 构建和 Inno Setup 6 安装包流程。
- 吸收输入包的 toast、WebSocket 与 3072 MiB 缓存选项修复，未改变用户默认缓存值。
- 使用输入包的新 libmpv，冻结随包 Electron。
- 禁用外置播放器自动注册及直接模块实例入口，保留原代码。
- 新增实际运行时版本与 libmpv 属性诊断；不支持字段超时退出，日志不包含媒体地址或凭据。
- 新增隔离启动、合成媒体测试入口和诊断容错测试。

这不是已完成真实 Emby 验收的正式发布；没有创建 Git commit 或远端发布。
