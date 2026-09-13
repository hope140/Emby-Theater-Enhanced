# 测试与验收

## 当前自动检查

```powershell
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1
python tools/probe-libmpv.py dist/EmbyTheaterEnhanced-win-x64/electronapp/libmpv/x64/mpv-1.dll
```

单元测试覆盖属性无回复、空值、桥接异常、监听器释放、日志脱敏与重复脱敏、外置插件读取旧配置/进程执行的封锁。修改 JS 已通过 node --check；PS 脚本由实际 PowerShell 5.1 构建与打包执行验证。

test-runtime 使用真实 frozen Electron，独立 profile 和 APPDATA，不读取现有客户端登录信息。检查 Web 应用就绪、libmpv 注册及 externalplayer 未注册。隐藏窗口可能不生成可用截图，因此脚本如实记录 screenshotAvailable，不将空 PNG 视为视觉验收。

可见合成视频测试入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -Visible -TestMedia
```

测试生成 64×64、30fps、5 秒 Y4M 样本，通过原 libmpv 插件独立实例检测播放推进、暂停、seek、恢复、停止。0.1.1 测试使用子进程 MPV_HOME，断言 bilinear 和 ETE-CONFIG-PROBE 标记实际生效，并逐项核对 900/2048/3072/4096/8192MiB 的 native 文本值。初版仅 APPDATA 隔离失败的结论已由此修正。测试不修改个人配置或系统环境变量。

## 本地播放链集成测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-0.1.1-final-win-x64 -Visible -TestPipeline
```

使用真实 PlaybackManager、已注册 libmpv、ApiClient 播放上报序列化与 input/api.js 消息分派；fixture 在 127.0.0.1 随机端口仅提供生成的 Y4M。服务器 API 响应、上报递送与 WebSocket 消息投递由内存 fixture 代替，OSD 路由因没有登录环境而单独替换为已完成 Promise。产品源码没有为测试跳过 PlaybackManager。

普通视频与 STRM 两种 Item 元数据均走 DirectPlay。STRM 的 Item.Path 保持 .strm，MediaSource.Path 是 HTTP 内容地址。断言播放器选择、source/sidecar 保留、开始/进度/停止报告、ItemId/MediaSourceId/PlaySessionId 一致，以及 Pause/Seek/Unpause/Stop 下行与对应状态上报。NextTrack 断言旧项停止、新项启动和新 PlaySessionId。该测试验证客户端链路，不代表真实服务器创建了 Session，也不是 WebSocket 网络或 WatchTogether 双端验收。

UI/runtime 测试顺序执行，避免多个 Electron 启动/宿主测试争用桌面；构建和哈希检查可以独立执行。原有无服务器的 DirectStream fixture 和隐藏窗口超时记录保留，最新通过证据见状态文档。

## 验收分层

| 层级 | 第一轮结果 |
|---|---|
| 输入哈希与解包 | 通过 |
| 诊断/外置入口单元测试 | 8/8 通过 |
| JS 语法与 PowerShell 构建 | 通过 |
| 两次独立 runtime 载荷一致性 | 1013 文件一致 |
| Inno 编译与载荷复核 | 通过，1012 载荷文件一致 |
| Electron UI 启动与插件注册 | 通过 |
| DLL 版本/API 查询 | 通过 |
| 隐藏窗口合成视频 | 超时，未取得 bridge ready；保留失败证据 |
| 可见窗口合成视频 | 5 项播放器动作通过，实际截图已检查 |
| Windows host 启动 | 通过：host 存活、4 Electron 进程、诊断日志 |
| 本地 PlaybackManager / 消息分派 / 上报集成 | 普通视频、STRM、NextTrack 通过；模拟服务器 API |
| 安装/升级/卸载 | 用户授权独立目录通过，快捷方式、注册表及载荷核验通过；卸载后清理核验通过 |
| 真实普通视频与 STRM Native | 两集 STRM DirectStream 通过，普通文件库内无样本 |
| 真实 Session/远控/WatchTogether | 实服命令、WebSocket、客户端与服务端回读通过；WatchTogether 按用户确认的后台控制口径 |
| 配置隔离、缓存诊断、GPU 输出 | MPV_HOME 标记与 5 档容量通过；gpu-next/D3D11 已取得，真实 shader/HDR 待验收 |

后续可见测试结果及最新状态以 PROJECT_STATUS 和 DEVELOPMENT_LOG 为准。

实际安装测试脚本 `tools/test-installer.ps1` 仅在用户授权后传 `-AuthorizedInstallTest`。它拒绝已有测试目录、安装记录、快捷方式、运行 host 或已有 Enhanced profile，以免污染已有数据；本次测试结束保留了 Enhanced profile，不能不经检查直接重复该脚本。没有自动删除 profile。安装过程使用当前已提权上下文，未验证 UAC 提示交互或 Program Files ACL。

## 真实 Emby 测试卡

2026-09-13 用户授权任意库内样本，说明全库 STRM，并将 WatchTogether 验收口径确认为后台控制正常。真实测试已通过，详见 LIVE_ACCEPTANCE.md。普通文件无库内样本，不伪装成已做实服验证；双客户端同步精度未单独测试。
