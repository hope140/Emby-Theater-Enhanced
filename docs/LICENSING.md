# 许可与公开范围

## 结论

本仓库维护层采用 **GPL-2.0-only**，完整文本见根目录 `LICENSE`。

依据是官方 `MediaBrowser/emby-theater-electron` 的 3.0.21 对照提交与 `MediaBrowser/emby-theater-windows` 的 3.0.20 对照提交均提供 GNU GPL v2 文本。所审计的维护源码没有发现明确的 “version 2 or any later version” 版权/许可声明；GPL v2 文本末尾的示例不是对本项目的额外授权。因此不能证明 `GPL-2.0-or-later`，本项目保守地使用 `GPL-2.0-only`。

`src/electronapp/package.json` 中的 `MIT` 字段与上述官方仓库根许可不一致，不能单独作为整个衍生维护工程的许可依据。

## 本次公开基线包含

- 可审计的维护脚本、测试、安装器、文档和许可文件。
- 已确认可维护的 Electron 应用层文件；其具体来源判定保留在 `docs/CARNIVAL_BASELINE.md` 与 `vendor/runtime-manifest.json`。
- 构建输入清单和哈希，不包含输入本体。

## 修改后的上游文件

首次公开前已审计 `vendor/runtime-manifest.json` 中 B 类、且进入公开基线的文本代码文件。每个此类 JavaScript、CSS 或 HTML 文件内均带有 2026-09-12/13 的显著修改声明，并指向根 `LICENSE`。无法在严格 JSON 中安全添加注释的 B 类 `package.json` 与翻译 JSON 已排除，等待其来源和修改记录可单独证明后再公开。审计清单见 `docs/MODIFIED_UPSTREAM_FILES.md`。

## 本次公开基线排除

- `vendor/carnival/`、`vendor/patch/` 和原始 Carnival SFX、综合补丁 ZIP。
- `dist/`、`build/`、安装器、原生 DLL/NODE/EXE/PDB 及其他生成二进制。
- `src/electronapp/www/` 的完整离线 Web 快照：其大部分归为 E 类，精确上游来源与再分发权尚未独立确认。
- 原始真实播放证据：其中包含私人媒体库的内部标识；公开文档只保留脱敏结论。
- 任何凭据、用户 profile、安装测试输出、日志、缓存和本机路径。

来源未知不等于自动获得 GPL 再分发权。未来若要公开新增资产、完整 Web 快照或二进制，必须先核对来源、适用许可、对应源码义务和第三方通知。

## 发布前要求

任何未来二进制发布都需要单独的许可审计：确认每个随包组件可再分发、提供 GPL v2 所需的完整对应源码或等效获取方式，并保留相应第三方许可。当前 `v0.1.1-baseline` 只是源代码治理基线，不是二进制 Release。
