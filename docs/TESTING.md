# 测试与验收

## 当前自动检查

```powershell
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1
python tools/probe-libmpv.py dist/EmbyTheaterEnhanced-win-x64/electronapp/libmpv/x64/mpv-1.dll
```

单元测试覆盖属性无回复、空值、桥接异常、监听器释放、日志脱敏与重复脱敏、外置插件读取旧配置/进程执行的封锁，以及 STRM/CD2 Resolver 的判定、Windows/UNC/POSIX mapping、空/root cloudPrefix、RPC/transport reject、deadline、Abort/cancel/late callback、URL 校验、CD2 → Mount → Native、Transcode、POSIX candidate 不进入 Windows Mount 和 persistent profile inspect 安全枚举。当前为 43/43。修改 JS 已通过 node --check；PS 脚本由实际 PowerShell 5.1 构建与打包执行验证。

## CloudDrive2 PR #2

最终候选 runtime 为 `EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review`，重复构建为 `EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-repeat`。依赖/transport smoke：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
dist/EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review/x64/electron/electron.exe tools/cd2-runtime-smoke.cjs dist/EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

该 smoke 在 frozen Electron 18.3.15 / Node 16.13.2 中加载 grpc-js 1.14.4、proto-loader 0.8.1 和最小 proto，启动本地 fake gRPC server，验证 Bearer metadata、`FindFileByPath`、`GetDownloadUrlPath(false)`、deadline、URL result 与 0 native addon。

CD2 hit、Mount fallback 和 Native fallback 必须串行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review -TestStopBeforePlayer
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review -Visible -TestPipeline -TestMount -TestCd2
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review -Visible -TestPipeline -TestMount -TestCd2Miss
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review -Visible -TestPipeline -TestCd2Miss
```

Stop-before-player 独立进程将 PlaybackInfo 保持 pending，terminal Stop 后释放，验证 `player.play` 未调用且没有 Playing report。CD2 hit 结果：普通视频保持 native；STRM source 切到 fake same-origin URL；Item/MediaSource/MediaSourceId/PlaySessionId、Pause/Seek/Unpause/NextTrack/Stop 与 19 条报告保持；7 次 resolve 中 3 次 active call 被新 Play/双 NextTrack/Stop 取消，退出时 0 active；旧请求、旧 `core-playing` listener、late result 与 unhandled rejection 均未影响最新 source。两个 miss 夹具分别验证 Mount 与 Native。

真实 CD2 smoke 只从本机既有配置在内存读取 token，并用临时环境变量提供一条 mapping。`tools/cd2-real-smoke.cjs` 仅调用两个 V1 RPC、HEAD 和单字节 Range；最终结果为 mapping hit、same-origin HTTP、HEAD 200、Range 206、无重定向。真实路径、URL、query、token、媒体名与账号不写入仓库或公开 evidence。

`tools/cd2-media-diagnostic.cjs` 使用有限候选独立验证真实 CD2 media。最终 `mkv-medium` 结果：pathAccepted、file-format=MKV、13 tracks（1 video/1 audio）、core-playing、core-idle=false、cache state/time 与 time-pos advancing，未观察 EOF/error。bridge 不直接暴露 start-file/file-loaded/end-file/log-message；file-loaded 由 format+track list 推断。2026-09-14 使用同一个 persistent acceptance profile 的 inspect 返回 `logged-in`，通过现有 `mapLocalPath` 和 CD2 只读 RPC 验证同一条 source-side mapping 后，两个真实 Emby POSIX STRM 样本均 `cd2_hit`；embedded libmpv/core-playing、Session/WebSocket/controls/reports 全部通过。

test-runtime 使用真实 frozen Electron，独立 profile 和 APPDATA，不读取现有客户端登录信息。检查 Web 应用就绪、libmpv 注册及 externalplayer 未注册。隐藏窗口可能不生成可用截图，因此脚本如实记录 screenshotAvailable，不将空 PNG 视为视觉验收。

可见合成视频测试入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -Visible -TestMedia
```

测试生成 64×64、30fps、5 秒 Y4M 样本，通过原 libmpv 插件独立实例检测播放推进、暂停、seek、恢复、停止。0.1.1 测试使用子进程 MPV_HOME，断言 bilinear 和 ETE-CONFIG-PROBE 标记实际生效，并逐项核对 900/2048/3072/4096/8192MiB 的 native 文本值。初版仅 APPDATA 隔离失败的结论已由此修正。测试不修改个人配置或系统环境变量。

## 本地播放链集成测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-strm-mount-resolver-final5 -Visible -TestPipeline
```

使用真实 PlaybackManager、已注册 libmpv、ApiClient 播放上报序列化与 input/api.js 消息分派；fixture 在 127.0.0.1 随机端口仅提供生成的 Y4M。服务器 API 响应、上报递送与 WebSocket 消息投递由内存 fixture 代替，OSD 路由因没有登录环境而单独替换为已完成 Promise。产品源码没有为测试跳过 PlaybackManager。

普通视频与 STRM 两种 Item 元数据均走 DirectPlay。默认夹具不提供 Mount sidecar，验证 STRM 的 native fallback；加 `-TestMount` 时生成同目录本地 Y4M 文件，检查插件 `currentSrc()` 已切换到确定性本地 source。两种模式都断言 Item/MediaSource 保留、开始/进度/停止报告、ItemId/MediaSourceId/PlaySessionId 一致，以及 Pause/Seek/Unpause/Stop 下行与对应状态上报。NextTrack 断言旧项停止、新项启动和新 PlaySessionId。该测试验证客户端链路，不代表真实服务器创建了 Session，也不是 WebSocket 网络或 WatchTogether 双端验收。

Mount 命中夹具：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-strm-mount-resolver-final5 -Visible -TestPipeline -TestMount
```

UI/runtime 测试必须串行执行。测试输出只保留在 `.work` 隔离目录，不进入公开 evidence；启动后应确认没有残留 Electron/host 进程。

构建和哈希检查可以独立执行。原有无服务器的 DirectStream fixture 和隐藏窗口超时记录保留，最新通过证据见状态文档。

## 验收分层

| 层级 | 第一轮结果 |
|---|---|
| 输入哈希与解包 | 通过 |
| 诊断/外置入口/STRM Resolver 单元测试 | 43/43 通过 |
| JS 语法与 PowerShell 构建 | 通过 |
| 两次独立 runtime 载荷一致性 | 1013 文件一致 |
| Inno 编译与载荷复核 | 通过，1012 载荷文件一致 |
| Electron UI 启动与插件注册 | 通过 |
| DLL 版本/API 查询 | 通过 |
| 隐藏窗口合成视频 | 超时，未取得 bridge ready；保留失败证据 |
| 可见窗口合成视频 | 5 项播放器动作通过，实际截图已检查 |
| Windows host 启动 | 通过：host 存活、4 Electron 进程、诊断日志 |
| 本地 PlaybackManager / 消息分派 / 上报集成 | 普通视频、STRM native fallback、NextTrack 通过；模拟服务器 API |
| 隔离 runtime Mount 命中 | 普通视频、STRM Mount、Session/control 通过；本地 Y4M fixture |
| 真实 Emby native fallback smoke | 非管理员登录、WebSocket、DirectStream native fallback、Pause/Seek/Unpause/NextTrack/Stop 和 10 条报告通过；real Emby Mount hit pending |
| 安装/升级/卸载 | 用户授权独立目录通过，快捷方式、注册表及载荷核验通过；卸载后清理核验通过 |
| 真实普通视频与 STRM Native | 两集 STRM DirectStream 通过，普通文件库内无样本 |
| 真实 Session/远控/WatchTogether | 实服命令、WebSocket、客户端与服务端回读通过；WatchTogether 按用户确认的后台控制口径 |
| 配置隔离、缓存诊断、GPU 输出 | MPV_HOME 标记与 5 档容量通过；gpu-next/D3D11 已取得，真实 shader/HDR 待验收 |
| CD2 unit/fake | 43/43；transport reject fallback、Abort、cloudPrefix root、POSIX mapping/candidate、POSIX 不进入 Windows Mount、profile inspect 安全枚举、fake gRPC/HTTP、deadline/cancel/late 与 URL 校验通过 |
| CD2 frozen runtime | grpc-js/proto-loader require、fake unary/metadata、CD2 hit、Mount/Native fallback、generation/controls/reports 通过 |
| CD2 可重复构建 | final/repeat 各 2156 个 manifest 载荷，逐文件 SHA256 0 差异；0 runtime native addon |
| CD2 installer payload | 隔离编译/解包，2157 个 `{app}` 文件与 runtime 逐哈希一致；setup SHA256 `6f908cd85945dcecf220f9841496d94e447f2848977cf80d03560b7567a5d351`；未执行系统安装 |
| 真实 CD2 只读 smoke | mapping/RPC/same-origin URL/HEAD 200/Range 206 通过；无 refresh 或设置修改 |
| 真实 Enhanced + CD2 media | 独立 MKV core-playing、tracks、cache 与 time-pos advancing 通过 |
| 真实 Emby + CD2 | inspect `logged-in`；两个样本均 `cd2_hit`/CD2 URL；embedded libmpv/core-playing 与 playback advancing、Session/WebSocket/Play/Pause/Seek/Resume/NextTrack/Stop、两个 Item/MediaSource/PlaySession identity 和 10 条报告全部通过 |

后续可见测试结果及最新状态以 PROJECT_STATUS 和 DEVELOPMENT_LOG 为准。隔离 runtime 的 Mount 命中不替代真实 Emby 服务器 Mount 验收。

## 最小真实 Emby Smoke

使用现有 Enhanced 登录态执行，不在命令行、仓库、文档、fixture 或公开 evidence 中保存服务器参数和认证信息。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/accept-live.ps1 -AuthorizedLivePlayback -RuntimeName EmbyTheaterEnhanced-0.1.1-strm-mount-resolver-final5
```

本次结果：登录态非管理员、WebSocket 在线；2 个 STRM 样本的 `Container=mp4`，`MediaSource.Path` 为当前规则不可解析的 other 形态；真实播放保持 `DirectStream` 和 URL native source，故 real Emby Mount hit pending。Play、Pause、Seek、Unpause、NextTrack、Stop 全部通过，10 条播放报告被服务器接受，停止后状态清理通过。没有修改服务器配置、媒体库、权限或元数据。

2026-09-14 PR #2 follow-up 使用新的 persistent profile inspect。检查只在 API client 存在且 `getCurrentUser()` 成功返回用户对象时报告 `loggedIn=true`；失败只返回 `logged-in`、`not-logged-in` 或 `inspection-error` 等安全枚举，不输出 server URL、账号、token、cookie、localStorage 或 raw exception。只读 mapping 诊断确认两个样本共享一条稳定 prefix mapping，relative suffix 保持，边界/`..`/POSIX case sensitivity 通过，两个 CD2 target 均为 regular file，HEAD 200、Range 206 且无重定向。随后真实验收两个样本均 `cd2_hit`，source kind 为 CD2 URL，embedded libmpv/core-playing、Play、Pause、Seek、Resume、NextTrack、Stop、Session/WebSocket 回读和 10 条播放报告全部通过。`Item.Path` 仅用于 sidecar identity，未用于替代 source mapping。

实际安装测试脚本 `tools/test-installer.ps1` 仅在用户授权后传 `-AuthorizedInstallTest`。它拒绝已有测试目录、安装记录、快捷方式、运行 host 或已有 Enhanced profile，以免污染已有数据；本次测试结束保留了 Enhanced profile，不能不经检查直接重复该脚本。没有自动删除 profile。安装过程使用当前已提权上下文，未验证 UAC 提示交互或 Program Files ACL。

## 真实 Emby 测试卡

2026-09-13 用户授权任意库内样本，说明全库 STRM，并将 WatchTogether 验收口径确认为后台控制正常。真实测试已通过，详见 LIVE_ACCEPTANCE.md。普通文件无库内样本，不伪装成已做实服验证；双客户端同步精度未单独测试。
