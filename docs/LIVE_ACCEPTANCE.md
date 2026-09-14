# 第一轮真实运行验收

日期：2026-09-13（UTC+8）；产品版本：0.1.1。

用户已自行登录，账号非管理员。用户允许使用库内任意影视，并说明全库均为 STRM；WatchTogether 本轮以后台控制正常为验收标准，不要求额外双客户端测试。

## 实际结果

选择两个不同的 STRM 样本（STRM Sample A、STRM Sample B）。两项均 Item.Path 以 .strm 结尾、单 MediaSource。通过现有 PlaybackManager 调用内嵌 libmpv，播放方式为原生 DirectStream。样本名称、内部 ItemId、MediaSourceId 和 PlaySessionId 不进入公开仓库。

| 检查 | 结果 |
|---|---|
| 账号与 Session | 非管理员；自己的 Session 可见；SupportsRemoteControl=true；WebSocket 已连接 |
| 播放与进度 | 客户端进度推进，服务器显示正确 Item 与对应进度 |
| Pause | 服务端 POST 接受，真实 WebSocket Playstate 到达；客户端与服务器均暂停 |
| Seek | 后台跳转至 60 秒；客户端、服务器 PositionTicks 均为 600000000 |
| Unpause | 后台恢复，客户端继续推进到 62 秒以上 |
| NextTrack | Sample A 停止、Sample B 开始，换为新的 PlaySessionId |
| Stop | 服务端接受、WebSocket 到达、客户端停止；服务端 NowPlayingItem 清空 |
| 上报一致性 | 两个不同 Item 各对应一个 MediaSource 和 PlaySession；真实开始/过程/停止请求全部成功 |
| 画面与 native 属性 | 实际查看动画画面；gpu-next 输出、d3d11va 硬解，缓存字节值 3221225472 |

完整控制测试包含 10 条实际发送的播放报告，全部接受。另一次约 20 秒画面检查完成后通过服务器 Stop 停止。测试没有修改服务端配置、权限或媒体文件；正常播放会留下样本观看进度，未额外回写重置。原始证据文件仅保存在本地忽略目录。

## 工具与证据边界

`tools/accept-live.ps1 -AuthorizedLivePlayback` 启动项目专用验收入口，复用现有 Enhanced profile，不复制凭据、不启动调试监听端口。使用真实 ApiClient 发送控制到服务器自己的 Session，观察真实 WebSocket 消息、播放器状态和 Sessions 回读。上报观察位于 ajax 层，仅记录实际发送请求的白名单字段，不替换传输、不模拟结果。

验收启动入口加载相同产品 main.js 和资源；不经过 .NET host 的本轮播放测试与此前 Windows host/安装启动验证分别记录。普通启动方式在测试后恢复。

初次脚本使用 npm 包名 `emby-theater-enhanced`，登录时 token 对应产品名称 `Emby Theater Enhanced`，导致可远控的 WebSocket Session 与 HTTP Session 不一致。把验收入口 app name 修正为 productName 后，账号无需权限变化，完整远控通过。没有因此修改产品能力声明或服务器设置。

## 结论

第一轮运行验收按用户更新口径通过。普通文件因全库 STRM 无实服样本，保留本地/模拟证据；HDR、大码率长时间稳定性、所有编码、插件双端同步精度不在这两个样本的证明范围。本验收阶段当时尚未执行 Git 提交或发布；后续公开基线状态以 `PROJECT_STATUS.md` 为准。当前产品构建与安装包无需重新生成。

## 2026-09-14 — PR #2 follow-up

使用同一个 `%LOCALAPPDATA%\EmbyTheaterEnhanced-Acceptance` profile 进行 inspect。实现现在只有在 API client 存在且 `getCurrentUser()` 成功返回用户对象时才报告 `loggedIn=true`；超时、拒绝、空用户、缺少 API 或异常只返回安全枚举，不输出 server URL、username、token、cookie、localStorage 或 raw exception。实际 inspect 结果为 `exists=true, loggedIn=true, reason=logged-in`。

在当前工作区生成的隔离 runtime 上执行真实验收，选择两个 POSIX STRM 样本。只读 mapping 诊断确认两个样本共享一条稳定 single-prefix mapping，relative suffix 保持，边界/`..`/POSIX case sensitivity 通过，两个 CD2 target 均为 regular file，HEAD 200、Range 206 且无重定向。真实 Session 可见、账号为非管理员、WebSocket 在线、远控能力有效；两个样本均 `cd2_hit`，source kind 为 CD2 URL，embedded libmpv/core-playing 与 playback advancing、Play、Pause、Seek、Resume、NextTrack、Stop 全部通过，10 条播放报告全部被服务器接受。

实际 mapping 只存在于 ignored local acceptance 配置，没有写入源码、文档、fixture、acceptance report 或 Git。验收不使用 `Item.Path` 替代 `MediaSource.Path`，也没有自动学习、扫描或修改服务器/CD2 配置；原始证据只保存在本地 ignored work directory。

## 2026-09-14 — PR #4 DirectUrl 分层验收

复用同一 persistent profile 与已有 ignored mapping，不修改服务器或 CloudDrive2。安全模式在 renderer 内选取既有 STRM 的真实 `MediaSource.Path` 并调用 trusted CD2 IPC；输出只保留字段存在性和状态枚举。结果为 `sourceKind=direct-url`、returned User-Agent present、expiresIn present。随后 exact embedded libmpv 以 file-local `loadfile` option 打开该 DirectUrl，观察到 path accepted、format present、core-idle=false 与 time-pos advancing；未把 URL、query、UA、token、媒体名或路径写入公开 evidence。

完整 PlaybackManager → Session/WebSocket/controls/reports 复测多次在 `manager.play()` 45 秒内未完成，且 resolver 记录为 0，证明阻塞发生在本轮 source resolution 之前。刷新率协议独立 probe 正常；未修改产品播放链来绕过该阻塞。`ETE_CD2_DIRECT_URL=0` 的真实 same-origin 分层重试两次停在新 embed `bridge-not-ready`，没有发 loadfile。PR #2 的两个真实 same-origin 样本与全控制链证据仍有效，但不能替代 PR #4 的完整实服验收，因此本轮结论为 DirectUrl acquisition/libmpv PASS、完整真实 Emby acceptance 未通过。

## 2026-09-14 — PR #4 收尾复核

按当前源码重建独立 verification runtime 后，frozen DirectUrl fixture 进入 resolver 并观察到 DirectUrl 请求、required UA 与 no-leak；整体 fixture 在切换第二个 source 时发生 UI readiness timeout，因此不新增完整 controls/generation 通过结论。exact Pepper file-local UA 探针与 Stop-before-player 仍通过。

使用已有 persistent profile 和 ignored mapping 做一次有界真实 DirectSmoke，inspect/select 通过，但 resolver 阶段返回 timeout，未创建 bridge、未发起媒体请求；此结果记录为 acceptance/runtime 前置阻塞，不作为 DirectUrl 或 fallback 失败。前一条已保存的真实 DirectUrl 分层成功证据仍是本轮 product path 的 PASS 依据，完整 PlaybackManager/Session/WebSocket/controls/reports 继续保持未通过。

## 2026-09-14 — Pepper readiness 抖动诊断

本轮不是功能验收，使用当前 `main@e9e2ad221ed5059574f830e9ffd9ef0dd5c8a22c` 新建 verification runtime，连续执行 Run A/B/C，每次只执行 `inspect,select,play,stop`。三次均 acceptance success、runner completed、timedOut=false、cleanup verified-clean、residual=0；每次 unique embed=1，播放期间无 recreation/duplicate，Stop 后正常 disconnected。

脱敏 timing 如下：

| Run | play→embed | embed→bootstrap | bootstrap→authoritative ready | embed→authoritative ready | authoritative ready→manager resolved |
|---|---:|---:|---:|---:|---:|
| A | 5996ms | 3ms | ≈0ms（raw -1） | 2ms | 2657ms |
| B | 4565ms | 4ms | ≈0ms（raw -1） | 3ms | 2117ms |
| C | 4535ms | 4ms | ≈0ms（raw -1） | 3ms | 2268ms |

三次的 resolver-result 均在 ready 后 4–5ms 出现；没有证据将 PR4/DirectUrl/resolver 与 Pepper ready 延迟关联。`loadfileObservation=unavailable` 仍是 acceptance-only outgoing command 观测缺口。结论为 `ROOT CAUSE NOT YET CONFIRMED`，主要抖动位于 embed 前置的 PlaybackManager/player 链，精确子阶段尚未观测；产品代码没有修改。

## 2026-09-14 — Pepper ready listener race follow-up

分支 `fix/pepper-ready-listener-race` 的产品修复 commit 为 `731dc2ad5ca4898475a5e641b6975563f9cf8c74`。按该 commit 构建新 runtime 后只执行一次 `inspect,select,play,stop`，结果为 inspect PASS、select PASS、isStrm=true、unique embed=1、Pepper ready、resolver-result、manager-play-resolved 和 classification success；runner completed、cleanup verified-clean、residual=0。

本次 timing 为 `play→embed=4724ms`、`embed→Pepper ready=22ms`。它只证明 listener 顺序修复没有破坏当前播放链，不证明性能改善，也不改变历史 `ROOT CAUSE NOT YET CONFIRMED` 结论。`loadfileObservation=unavailable` 继续作为 observability gap。
