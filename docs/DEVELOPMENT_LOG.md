# 开发日志

## 2026-09-13 — CloudDrive2 Resolver Sol High 架构评审

在 `main == origin/main == 7670d42`、工作区仅有既有调研文档改动的基线上完成 Tier 2 / Sol High 评审。本轮没有修改 `src/`、`package.json`、CD2 配置/mount/cache、Emby/服务器配置或网盘数据，没有执行 refresh、真实 Enhanced 播放、分支、commit、PR、发布或安装。

复用一个现有 115 媒体样本，对同一文件分别执行 `GetDownloadUrlPath(get_direct_url=false/true)`。`false` 返回同源 `downloadUrlPath`，HEAD=200、单字节 Range=206，无重定向和额外 header。`true` 额外返回 provider/external HTTPS DirectUrl、专用 User-Agent 和分钟级 expiresIn，additionalHeaders 为空；裸 URL 的 HEAD/Range 均为 403，携带返回 User-Agent 后 HEAD 仍为 403、Range 为 206，交叉顺序复测两次一致。所有 token、完整 URL/query、媒体名、账号和私人路径只在内存中使用且未输出或落盘。

Transport 结论：固定 `@grpc/grpc-js@1.14.4` + `@grpc/proto-loader@0.8.1`，放在 Electron main process，通过窄 IPC 服务 renderer。临时隔离 smoke 使用随包 Electron 18.3.15 / Node 16.13.2、repo proto 1.0.13 调用 runtime 1.0.15，Bearer metadata、unary RPC、deadline 和 insecure localhost HTTP/2 成功，无 native addon。`grpc-web` 因 wire protocol 不同且需要代理而不采用。临时依赖只位于 ignored `.work`，完成后清理。

架构结论：115 DirectUrl 分类为 Level B，但因专用 User-Agent、分钟级有效期及当前 Pepper bridge 只能把 command 参数转成字符串，DirectUrl 不进入 V1。PR #2 建议实现 `CD2 same-origin HTTP → Mount → Native`；Transcode 永远 Native。异步接入必须在 PlaybackManager 与 libmpv 之间共享单调 generation/request id，Stop/NextTrack/新播放立即取消旧请求，并在每个 await 后和最终 `loadfile` 前拒绝 stale response。建议总 lookup budget 750ms，不 retry、不 refresh、不持久或跨播放缓存 URL。

Model Tier: 2
Model: GPT-5.6 Sol
Reason: gRPC packaging, proto/runtime drift, provider HTTP headers/expiry, PlaybackManager/libmpv asynchronous lifecycle and native fallback span multiple layers
Escalated: yes, from the prior Tier 1 research

## 2026-09-13 — CloudDrive2 Resolver 调研完成

按当前主线任务书优先审计 `hope140/embyToLocalPlayer` 的 `beta` 分支，研究快照为 `54b2abae0537f1b4c65752edaac059d3cda4790e`。本轮只做设计和只读验证，没有修改 Enhanced 产品源码，没有执行 CD2 refresh，没有进行 Enhanced + CD2 实际播放集成，也没有修改本机 CD2 配置、挂载、账号或媒体数据。

新增 `docs/CD2_RESEARCH.md`，记录 ETLP 的完整 STRM → local path → path_map → gRPC → HTTP download URL → 外置播放器调用链，以及路径推导、mapping、refresh、headers/Range/auth、fallback、禁止迁移逻辑、Enhanced V1/V2 边界和 fake/real 测试方案。

本机只读结果：CloudDrive2 service 为 Running/Automatic，运行时 RPC 版本为 1.0.15；19798 的 HTTP 与 gRPC 可用，配置中的 19799 在探测时未监听；存在一个已挂载的 Windows drive-letter mount。使用运行 ETLP 配置的现有 token 仅在内存中查询一个媒体样本，`FindFileByPath`、`GetDownloadUrlPath` 成功，返回同源 HTTP URL；HEAD=200，单字节 Range=206，支持 `Accept-Ranges: bytes`，本次没有额外 HTTP headers 和重定向。当前 ETLP 一条 path_map 对该样本没有命中，因此 mapping 是后续实机命中的前置条件。敏感 token、URL、路径、账号和媒体名未写入文档。

ETLP beta 的 CD2 client/gateway 测试使用 fake/stub，`test_strm_media_path`、`test_clouddrive2_client`、`test_clouddrive2_gateway` 通过。当前结论为 **Need Sol High review**，原因是 Python cp39-win32 `grpcio` 与 Enhanced Node/Electron 不兼容，以及 proto/runtime 漂移、Range/临时 URL、可选动态 headers、refresh stream 和 PlaybackManager source-only 接入存在跨层风险。调研完成后按任务要求停止，等待主线程审核。

Model Tier: 1
Model: GPT-5（当前 Codex 会话）
Reason: research contract and evidence boundary were explicit; implementation was intentionally out of scope
Escalated: no

## 2026-09-13 — PR #1 边界修正与真实 native smoke

根据主线程复核修正当前 PR 的两个边界：Mount 规则改为按优先级逐条生成并立即执行 `existsSync`，高优先级 sidecar 命中不会被后续 sourcePath 解析失败推翻；候选扩展改为明确音视频 allowlist，`.txt`、`.nfo` 等文件即使存在也不作为 Mount source。

新增回归覆盖 malformed/unsupported sourcePath 的优先级短路和非媒体扩展误命中。Node 单元测试 19/19 通过；包含修正的隔离 frozen Electron runtime native fallback 与 Mount-hit 两套测试通过，PlaybackManager、Session/control 和 20 条模拟报告保持通过。

随后使用现有 Enhanced 登录态进行最小真实 Emby smoke。只读检查确认非管理员、WebSocket 在线，选取 2 个 STRM 样本；样本 `Container=mp4`，`MediaSource.Path` 为当前规则不可解析的 other 形态。实际播放为 DirectStream，最终 source 类型为 URL，证明本次真实播放走 native fallback；Play、Pause、Seek、Unpause、NextTrack、Stop 全部通过，10 条播放报告被接受，停止后状态清理通过。当前条件没有自然 Mount 映射，real Emby Mount hit pending；未修改服务器配置、媒体库、权限、元数据或用户认证材料，未写入公开 evidence。

Model Tier: 1
Model: GPT-5.6 Luna Max
Reason: boundary corrections were explicit and the real smoke reused the existing acceptance harness
Escalated: no

## 2026-09-13 — STRM Mount Resolver 第一版

按用户确认的 `feat/strm-mount-resolver` 规格，在 repo-local Git identity `hope140 <hope140y@outlook.com>` 下实现最小确定性 STRM Mount Resolver。Resolver 只在 `libmpv.playInternal(options)` 的最终 `loadfile` 前替换 source，继续沿用 PlaybackManager、Item、MediaSource、PlaySessionId、字幕/音轨、offset、播放上报和远控链路。

完成内容：

- 新增 `src/electronapp/resolvers/strm-resolver.js`，按 `Item.Path` `.strm` 后缀或 `MediaSource.Container=strm` 判定 STRM，并统一 native fallback。
- 新增 `src/electronapp/resolvers/mount-resolver.js`，依次支持 sidecar stem、明确 Windows/UNC `sourcePath`、URL pathname 文件名及 `name`/`filename`/`file_name`，仅 `existsSync` 命中才返回 local。
- Transcode、缺字段、非法 URL、解码异常、文件不存在和 Resolver 异常均保留 `options.url`；诊断只记录脱敏的类型、reason、存在性和 fallback 状态。
- 扩展 Node 单元测试和隔离 PlaybackManager runtime 夹具，覆盖普通媒体、STRM native fallback、Mount 命中、Session/control 状态保持和 20 条模拟上报。

验证：Node 单元测试 17/17 通过；修改 JS 与 PowerShell 语法检查通过；隔离 frozen Electron 的普通视频、STRM Mount、PlaybackManager 上报、Pause/Seek/Unpause/Stop/NextTrack 通过。隔离 runtime 不是真实 Emby 服务器 Mount 验收，真实 Mount 样本、字幕/音轨差异、换流重入和长时间稳定性仍待实机验证。没有实现 CD2、外部播放器、Session 模拟或服务器改动。

Model Tier: 1
Model: GPT-5.6 Luna Max
Reason: task contract and acceptance criteria were already explicit
Escalated: no

## 2026-09-13 — 开源基线与模型策略

建立公开源代码基线的许可证和公开范围：官方 Windows/Electron 对照仓库均为 GPL v2，维护源码未证明 `or later` 授权，故新增根 `LICENSE` 并采用 GPL-2.0-only。新增 `THIRD_PARTY_NOTICES.md`、`docs/LICENSING.md`，将 vendor 输入、二进制、构建产物和 E 类完整离线 Web snapshot 排除在首个公开提交外。更新 README 的非官方声明、`.gitignore`、测试输出路径与真实验收文档表述；没有修改播放、Session、libmpv 或 Resolver。

新增 `docs/AI_MODEL_POLICY.md`，并在 AGENTS/DECISIONS 中固定 Tier 1 默认、Tier 2/3 升降级规则与重要任务留痕字段。敏感信息扫描未发现待公开文件中的实际认证材料；测试中仅有刻意构造的脱敏样例。

Model Tier: policy
Model: current Codex session
Reason: licensing evidence, public-boundary audit, and acceptance-document reconciliation
Escalated: no

本轮建立本地 `main` 的公开源代码基线并创建带注释的 `v0.1.1-baseline` 标签；没有配置 remote、推送或创建 GitHub Release。提交只包含已审计范围，提交署名使用项目中性 noreply 地址而非本机个人 Git 身份。

公开审核清理后，确认用户提供的 GitHub remote 无既有 branch/tag，再以普通 fast-forward 初次推送 `main` 和 `v0.1.1-baseline`。没有 force push，也没有创建 GitHub Release。公开版本移除了真实媒体样本名称、内部 Item/MediaSource/PlaySession 标识及其原始 JSON evidence；补充 source-governance baseline 的不可独立构建说明，并审计公开 B 类文本代码的 GPL 修改声明。

## 2026-09-13 — 真实 STRM 与后台控制验收完成

用户登录非管理员账号，授权任意库内影视并说明全库 STRM；WatchTogether 按后台控制正常验收。只查有限候选并使用两个不同 STRM 样本。真实 DirectStream 播放、服务端进度、Pause/Seek 60 秒/Unpause/NextTrack/Stop 均通过；10 条真实播放报告全部被接受，逐 Item 的 MediaSource/PlaySession 一致。另做可见画面检查，确认 gpu-next、d3d11va 与正确 3GiB 缓存诊断。

新增 live 验收工具，凭据仅由原客户端读取，不输出、不复制。初次工具 app name 错用 package.name，导致 HTTP/WS Session 分裂；改用 productName 后完整通过，没有改产品源码或服务器权限。通过报告按白名单沉淀为 docs/evidence/live-acceptance.json。保留用户播放进度，停止测试播放并恢复普通启动。0.1.1 构建哈希不变，无需重建。第一轮按最新用户确认口径关闭；普通文件库内无样本、HDR和插件双端同步精度未覆盖，Git提交发布未授权。

## 2026-09-13 — 最终证据整理

补齐 `docs/evidence/first-round-followup.json`，记录实际媒体测试、客户端 fixture 上报、诊断、安装/覆盖/卸载和最终安装包 SHA256。复核测试安装目录与注册表记录已移除、无测试 host 残留、个人 mpv.conf 哈希未变。0.1.1 最终 runtime 与重复构建 1013 文件一致；安装包实际解包 1012 载荷全匹配。继续入口是用户登录并指定真实样本，无需重复已通过的本地测试。

## 2026-09-12 — 第一轮继续收尾，0.1.1

用户指出仍有本地工作可推进，要求继续完成第一轮。先修正上一轮“本地可做的工作全部完成”的过满表述，继续处理已知问题。随后用户表示会自行登录 Enhanced 并指定真实样本，并明确授权独立测试目录安装/覆盖/卸载。

完成：

- 同一个实际 embed 上核对 900/2048/3072/4096/8192MiB，证明 native 缓存属性正确，bridge 回传 int32 截断。诊断改为自有瞬态 user-data 文本快照，安全整数验证后记录精确值及 legacyValue；读取前清空元数据槽，防止失败后误读旧值。
- 回复直接限定到目标 embed，同 embed 的 ready/playing 采集串行；unsupported、超时仍不阻塞播放。空 shader 数组正确记录 configured=false。
- 依据该 mpv revision 的源码确认 Windows Known Folder 默认路径，测试改用子进程 MPV_HOME；bilinear 与配置标记已实测通过。正式启动未改画质或个人配置。
- 新增真实 PlaybackManager、ApiClient 播放报告序列化及 input/api.js 消息分派的 fixture 集成测试。普通视频和 STRM 两项均 DirectPlay；source 与 Item.Path 保留；开始/进度/停止报告的 ItemId/MediaSourceId/PlaySessionId 一致；Pause/Seek/Unpause/Stop 和 NextTrack 全部通过，共收集 20 条模拟上报。
- 单元测试 8/8 通过；最终修改 JS 语法检查通过。新版独立合成视频与配置/容量测试通过。原 Windows host 启动检查通过，1 host + 4 Electron 进程与诊断日志存在。
- 0.1.1 runtime 重复构建 1013 文件 SHA256 全一致；安装包 123972095 bytes，SHA256 `84bfd2970d6d31277fe43fffdd9f1b20f608458d070986a62d318181d3bd5701`；解包与实际安装均核对 1012 个载荷文件。
- 在授权独立目录先安装 0.1.0，再覆盖到 0.1.1；注册表版本/路径、桌面与开始菜单快捷方式通过。实际执行已安装快捷方式，launcher exit=0，Windows host/Electron/诊断日志通过。卸载 exit=0，目录/注册表/快捷方式均清理；新建的 Enhanced profile 保留供后续登录，个人 mpv.conf SHA256 未变。

测试期间发现的夹具问题及边界：未提供 Windows host 的 Electron-only fixture 不能依赖 localhost:8154 文件探测，因此使用随机 localhost HTTP 媒体源；HTTP endpoint 标记错误时走 DirectStream 请求不存在的 fixture API，修正输入后通过。未登录场景的 OSD 导航单独替换，其他产品播放链未改。一次 UI 与 host 测试并行后启动超时，后续媒体验证顺序执行成功。保留失败证据，不把它们写成产品功能验收成功。

尚待真实 Emby 普通视频/STRM、实际 Session/WebSocket、后台远控与 WatchTogether；用户将登录并指定样本。没有创建 Git 仓库、commit、PR 或远端发布。所有真实服务器操作仍等待样本范围。

## 2026-09-12 — 第一轮本地准备与开发

任务输入为第一阶段任务书及本地两个归档。开始时目录只有 SFX 与综合补丁 ZIP，没有 Git 仓库、分支或提交。按本地开发范围执行，未将任务书的 commit 示例视为授权。

完成工作：

1. 保存原件并核对 SHA256，Carnival 解包 1234 条目/1009 文件、补丁 51 文件；未执行原安装/恢复脚本。
2. 下载固定官方参考，逐文件分类，22 A / 29 B / 126 C / 17 D / 815 E；导入可维护 src/electronapp，vendor 只读及忽略规则。
3. 吸收已核验 toast、apiclient、3072MiB 选项和新版 libmpv；建立 prepare/build/package/installer/启动入口。
4. 禁用外置自动注册和模块实例调用；保留旧代码、Remote Control 与 shared shell。
5. 建立运行时版本与 ready/playing 容错诊断、日志脱敏和 4 项单元测试。
6. 完成播放链、Session/WebSocket、外置禁用、libmpv 与未来 Resolver 插入点文档。

实际验证：

- PowerShell 5.1 构建成功；重复构建载荷 1013 文件全哈希一致。
- Inno Setup 6.7.3 编译成功，setup 123990793 bytes，SHA256 `f120c2b0f4ba46e8153bcb451e9cb0a06fee1a2987753c303965c0177a2dfb66`。
- 安装包解包后 1012 个载荷文件全哈希匹配。未运行安装器。
- Electron 启动、离线 Web UI、插件列表检查通过，启动截图已查看。版本 18.3.15 / Chromium 100.0.4896.160 / Node 16.13.2。
- 独立 libmpv 插件合成媒体播放推进、pause、seek、resume、stop 5 项通过；取得实际 GPU 与视频输出属性。
- 原 .NET host 在唯一测试副本运行，10 秒后 host 存活、4 个 Electron 进程、诊断日志存在；退出时只终止该副本内的进程。
- DLL probe 得到 API 2.5、mpv v0.41.0-920-gdd5d17d32；unsupported 版本属性如实返回 unavailable。
- 诊断与外置禁用测试 4/4 通过；修改 JS 语法检查通过。

处理中发现并保留的证据：

- PowerShell 5.1 默认编码误读中文 manifest 文件名，构建改为显式 UTF8 后成功。
- 隐藏窗口合成媒体超时；可见窗口成功。
- 首次可见媒体测试使用已注册插件，停止事件进入需要 API client 的 PlaybackManager，未登录上下文抛 getSavedEndpointInfo；测试改为独立实例后全部动作通过。产品 PlaybackManager 未因此修改。
- 临时 APPDATA 不能证明 native mpv 配置隔离；ready 值与现有用户配置对应。个人 mpv.conf 未修改。
- demuxer-max-bytes 回报 -1073741824，疑似 bridge 32 位数值回报问题，实际缓存影响待查。

尚未完成：系统安装/升级/卸载、真实 Emby 普通视频和 STRM、真实后台 Session 与远控、EmbyWatchTogether、完整 mpv.conf 路径追踪和画质效果验收。第一轮处于本地开发完成、真实验收待关闭的状态。

Commit 列表：空。未初始化 Git，未提交、推送、创建 PR、发布或修改服务器。
