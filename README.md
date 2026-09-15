# Emby Theater Enhanced

基于 Carnival 3.0 与综合补丁的 Windows Emby 客户端维护工程。当前版本为 0.1.1 开发候选，保留离线 Web UI、内嵌 libmpv 与原生 Session 链路。

Emby Theater Enhanced is an unofficial community-maintained project. It is not affiliated with or endorsed by Emby.

Emby Theater Enhanced 是非官方的社区维护项目，与 Emby 不存在隶属、合作或认可关系。

第一轮已建立源码、输入清单、构建脚本、Inno 安装包、播放/远控审计与容错诊断。本地测试、实际安装生命周期、真实 STRM 播放及服务器后台控制均已通过；WatchTogether 按用户确认的后台控制口径验收。普通文件库内无样本，完整结果见 [LIVE_ACCEPTANCE](docs/LIVE_ACCEPTANCE.md) 和 [PROJECT_STATUS](docs/PROJECT_STATUS.md)。

当前维护版 resolver 在原 PlaybackManager/Session 链内按每条 STRM 路径规则选择 DirectUrl、CloudDrive2 same-origin HTTP、Mount 和 Native 的顺序，Transcode 保持 Native。DirectUrl 只接受受限的 file-local User-Agent；任意 `additionalHeaders` 均安全回退 same-origin。自动测试、frozen transport/file-local UA/Stop 以及 fake DirectUrl 完整链既有证据已通过；真实服务器播放证据继续按验收矩阵单独记录。安全边界见 [CD2 DirectUrl contract](docs/CD2_DIRECT_URL.md) 和 [STRM resolver settings](docs/STRM_RESOLVER_SETTINGS.md)。

STRM 智能解析现在提供正式 Playback 设置页、main-process 持久化配置、多路径最长前缀匹配、cloud-first/mount-first/custom 策略，以及 AUTO/USER/DISABLED 规则生命周期。配置文件位于 `%APPDATA%\EmbyTheaterEnhanced\config\\`；CloudDrive2 token 只保存在 main-process secret 文件，renderer 只得到 `tokenConfigured` 状态。保存后重启应用使播放 service 重新加载配置。

## 使用本地构建

> `v0.1.1-baseline` 是 source-governance baseline，不是 clone 后即可完整再现发行产物的源码包。本地构建仍依赖未公开的已锁定 runtime/input；完整离线 Web snapshot、native binary 和 vendor 输入因来源及再分发许可尚待确认而未公开。二进制 Release 仅会在这些组件完成来源、许可和对应源码义务审计后开放。

已生成 `dist/EmbyTheaterEnhanced-0.1.1-final-win-x64/`。双击其中的 `Start-Enhanced.cmd` 启动。启动入口只为 Enhanced 初始化缺失的配置，然后启动原 Windows host。应用数据位于 `%APPDATA%\EmbyTheaterEnhanced`，现有 `%APPDATA%\mpv` 配置保留。

安装候选位于 `dist/EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe`。在用户授权的独立目录已验证从 0.1.0 覆盖升级、安装后启动及卸载；测试安装已卸载，Portable 可继续用于登录验收。

目录内保留的 Carnival BAT 属于基线审计材料，请使用 Enhanced 的启动入口和 setup.exe。原归档始终保留。

## 开发

```powershell
npm ci --ignore-scripts
powershell -NoProfile -ExecutionPolicy Bypass -File tools/prepare.ps1
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1 -OutputName EmbyTheaterEnhanced-new-win-x64
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-new-win-x64 -Visible -TestMedia
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-runtime.ps1 -RuntimeName EmbyTheaterEnhanced-new-win-x64 -Visible -TestPipeline
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1 -RuntimeName EmbyTheaterEnhanced-new-win-x64 -Compiler 'path/to/ISCC.exe'
```

已有输出不会被覆盖；重复构建用 `-OutputName EmbyTheaterEnhanced-next-win-x64`。构建只使用本地已校验 vendor，不联网下载或升级 Electron。初次复现需要两个原始归档；哈希见 `vendor/runtime-manifest.json`。

`src/electronapp` 是维护入口；`vendor` 记录来源和文件哈希；`tools` 负责构建、测试；`docs` 记录已确认结论与待验收内容。根 `package.json` 同时锁定开发工具和需要复制进 frozen Electron 的纯 JavaScript runtime 依赖；`tools/build.ps1` 只复制 lockfile 中的 production closure，并拒绝 native addon。

## 后续阅读

- [当前状态与接手入口](docs/PROJECT_STATUS.md)
- [CloudDrive2 DirectUrl 安全契约](docs/CD2_DIRECT_URL.md)
- [STRM 智能解析设置契约](docs/STRM_RESOLVER_SETTINGS.md)
- [架构与未来 Resolver 边界](docs/ARCHITECTURE.md)
- [播放链路](docs/PLAYBACK_PIPELINE.md) / [Session 与远控](docs/SESSION_CONTROL.md)
- [测试](docs/TESTING.md) / [构建与安装](docs/PACKAGING.md)
- [Carnival 审计](docs/CARNIVAL_BASELINE.md) / [libmpv 环境](docs/LIBMPV_RUNTIME.md)
- [许可与公开范围](docs/LICENSING.md) / [第三方声明](THIRD_PARTY_NOTICES.md)
- [AI 模型使用策略](docs/AI_MODEL_POLICY.md)
