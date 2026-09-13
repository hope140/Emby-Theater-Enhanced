# 修改后的上游文件审计

审计日期：2026-09-13（UTC+8）。依据 `vendor/runtime-manifest.json`，下列文件与官方 Electron 3.0.21 对照版本不同，且作为可公开的维护文本代码保留。每个文件内都有显著声明：该文件为 Emby Theater Enhanced 维护的修改版本，修改日期为 2026-09-12/13，并按 GPL-2.0-only 分发。

| 路径 | 类型 |
|---|---|
| `src/electronapp/apphost.js` | JavaScript |
| `src/electronapp/cec/cec.js`、`command-map.js` | JavaScript |
| `src/electronapp/filesystem.js`、`fullscreenmanager.js`、`main.js` | JavaScript |
| `src/electronapp/plugins/cec.js`、`plugins/cec/cec.js`、`cec.html` | JavaScript / HTML |
| `src/electronapp/plugins/libmpv.js`、`libmpv.css` | JavaScript / CSS |
| `src/electronapp/plugins/mpvplayer/audio.js`、`audio.html`、`video.js`、`video.html` | JavaScript / HTML |
| `src/electronapp/scripts/appclose.js`、`videohandler.js` | JavaScript |
| `src/electronapp/serverdiscovery/serverdiscovery-native.js`、`serverdiscovery.js` | JavaScript |
| `src/electronapp/shell.js`、`splash.html` | JavaScript / HTML |
| `src/electronapp/wakeonlan/wakeonlan-native.js`、`wakeonlan.js` | JavaScript |

未公开的 B 类文件：`src/electronapp/package.json`、`plugins/mpvplayer/strings/en-US.json`、`plugins/mpvplayer/strings/zh-CN.json`。这些 JSON 文件不能以注释方式安全承载修改说明，且公开基线本身不承诺可独立构建，故在获得更精确的来源/修改记录前不纳入。
