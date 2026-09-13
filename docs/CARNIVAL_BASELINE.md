# Carnival 基线审计

审计日期 2026-09-12（UTC+8）。输入为用户本地提供的两个原件，原件未修改。Carnival SFX 可直接解包，1234 条目、1009 文件，无加密条目。

| 输入 | SHA256 |
|---|---|
| Carnival 3.0 SFX | `9d53fe71b42a530e9941f97ad712bd6724dbb0e7aa0e7de73a4bf9614b28b001` |
| 综合补丁最终 ZIP | `2316cd37733b4abf5475dcb9f36d050e2e83c52807ea3b40b9b97d8a80263b43` |

## 分类结果

对照官方 [Electron 3.0.21](https://github.com/MediaBrowser/emby-theater-electron/tree/db0f4c814ee1e7d9b5f50010065c5cb64a20357e)，以及 [Windows 3.0.20](https://github.com/MediaBrowser/emby-theater-windows/tree/708fadc068cbf66ced6aece4a32f3e12bb2c4e13)。参考源码已下载至工作缓存；没有以官方源码替换 Carnival。Electron 仓库的 3.0.20 标签查询返回 404，因此不能宣称完成该精确版本对照。

| 类别 | 数量 | 判定方式 |
|---|---:|---|
| A 官方可直接对应 | 22 | 与 3.0.21 对应路径 SHA256 一致 |
| B 明文定制或差异 | 29 | 与官方参考内容不同，或明确 Carnival 定制入口 |
| C 第三方依赖 | 126 | Electron runtime 与 node_modules；未逐一源码重建 |
| D Native / managed binary | 17 | EXE/DLL/NODE/PDB；精确构建来源未证明 |
| E 暂未确认来源 | 815 | 参考仓库无对应路径，包含大量离线 Web 资源和资产 |

E 类不表示加密或不可编辑。`www` 中 JS/HTML/CSS 可维护，但参考 Electron 仓库主要依赖在线 Web UI，不能据文件可读就声称它与官方某个 Web 版本完全对应。B 类也不等于已证明所有差异均由 Carnival 作者撰写。

## 关键组件

| 组件 | 当前证据 | 维护方式 |
|---|---|---|
| Emby.Theater.exe | 文件版本 3.0.20.0；有官方 Windows host 参考源码，未证明 Carnival EXE 是该源码编译所得 | 保留 vendor，暂不重建 |
| electronapp | main/preload/插件、平台适配为明文；相对目录加载路径已查明 | `src/electronapp` 维护 |
| electronapp/www | 离线 Web 应用，包含明显定制与综合补丁 | 可编辑，精确官方 Web 来源待查 |
| mpv-win32-x64.node | 233984 bytes；`main.js` 经 register-pepper-plugins 注册 `application/x-mpvjs` | Pepper/PPAPI bridge，不能当作普通 Node addon 直接 require |
| mpv-1.dll | 原 Carnival 99861006 bytes；Enhanced 使用综合补丁 119725568 bytes | 独立 libmpv 版本管理 |
| x64/electron | 实测 Electron 18.3.15 / Chromium 100.0.4896.160 / Node 16.13.2 | 冻结 vendor runtime |

关键完整 SHA256、用途、来源及替换计划均在 `vendor/runtime-manifest.json`。Electron package.json 的 ^9.4.0 只是过时的开发依赖声明，不能代表实际运行环境。

## 综合补丁吸收

直接采用已核验 payload 的 `apiclient.js` 与 `toast.css`；对 video.html 增加 3072 MiB 选项但不修改 appSettings 默认值；替换指定 mpv-1.dll。未运行补丁的安装/恢复脚本。画质配置、shader、字体仍是用户配置范围，构建不会覆盖。

## 当前限制

没有大范围逆向分析，没有证明全部 native binary 的可重建性，没有完成 E 类每个文件的许可证/来源核验。第一轮实现是在锁定 vendor 上维护明文层。
