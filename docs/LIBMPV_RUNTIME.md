# libmpv 与 Electron 运行环境

2026-09-12 在本地构建输出上实际执行得到：

| 项目 | 结果 | 证据级别 |
|---|---|---|
| Electron | 18.3.15 | frozen Electron 主进程 process.versions |
| Chromium | 100.0.4896.160 | 同一主进程 process.versions.chrome |
| Node | 16.13.2 | 同一主进程 process.versions.node |
| mpv-version | mpv v0.41.0-920-gdd5d17d32 | DLL mpv_create → mpv_initialize → property |
| libmpv client API | 2.5 | DLL mpv_client_api_version 导出 |
| ffmpeg-version | N-125998-g2a20737f6 | DLL property |
| libmpv-version / mpv-build-date | null / null | 该次 property 查询未返回值，不据此推断加载失败 |

libmpv 来源随综合补丁内的说明为 [shinchiro 20260809 release](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260809)，asset `mpv-dev-x86_64-20260809-git-dd5d17d328.7z`。来源说明中的构建日期为 2026-08-09，runtime 未能用 mpv-build-date property 复核。DLL SHA256 为 `965efde4c8199f942bf9ed9d3e6fbcb7dd9dc961524d5780a9ca67da53f14d0c`，因 bridge 导入文件名将 libmpv-2.dll 保持为 mpv-1.dll。

## 最小诊断

`electronapp/enhanced/diagnostics.js` 在主进程写实际版本；libmpv.js 在 ready 和 playing 后发起采集，不 await 到播放链。同一 embed 的采集串行执行，回复直接在该 embed 上按属性匹配，避免跨播放器或重叠采集混淆。

记录 vo/current-vo、gpu-api/context、hwdec/current、scale/cscale/dscale/tscale、deband、interpolation、video-sync、target-colorspace-hint/trc/prim/peak、tone/gamut mapping、glsl-shaders、video-params/out-params、config/config-dir、sub-font/fonts-dir、demuxer-max-bytes。每字段 1500ms 超时，unsupported/null/timeout 均记录并继续；监听器在完成/失败/超时清理。

新增客户端日志位于 `%APPDATA%\EmbyTheaterEnhanced\logs\ete-client.jsonl`，使用 UTF-8 JSONL 追加写入；单文件约 2 MiB 后按 `.1`、`.2`、`.3` 轮转。媒体地址、Item 名称、认证信息不进入日志；shader/config/font 目录只记录是否配置及数量。日志写入使用异步 fail-open 队列，失败不会传播到播放链。Carnival 原有其他日志行为不属于本次全面脱敏审计；导出和隐私边界见 [CLIENT_DIAGNOSTICS](CLIENT_DIAGNOSTICS.md)。

## mpv.conf

0.1.1 启动日志记录 MPV_HOME、portable_config、Windows Known Folder 和 EXE 邻近目录中的候选配置是否存在及 SHA256，不输出实际私人路径，明确标记为 candidate-files-not-load-trace。存在性和候选搜索顺序不是 native 加载追踪，仍需结合 ready/playing 属性判断生效值。

隐藏窗口合成媒体首次超时；后续可见窗口已取得 ready/playing 诊断，并通过独立 libmpv 插件实例的播放推进、暂停、seek、恢复、停止测试。playing 的 current-vo=gpu-next、gpu-api/context=d3d11、hwdec=d3d11va、hwdec-current=no，video-out-params 为 64×64 YUV420P。此样本是原始 Y4M，不能证明压缩视频硬解或 HDR 效果。

首次测试只改 APPDATA，临时配置标记未出现。后续核对与本 DLL revision 对应的 [path-win.c](https://github.com/mpv-player/mpv/blob/dd5d17d328/osdep/path-win.c) 与 [options/path.c](https://github.com/mpv-player/mpv/blob/dd5d17d328/options/path.c)：Windows 默认路径通过 SHGetKnownFolderPath 获取；MPV_HOME 可覆盖配置目录，config-dir 优先于它，config=no 又优先于目录选项。

测试现已显式设置子进程 MPV_HOME 到唯一工作目录，实测 scale=bilinear、sub-font=ETE-CONFIG-PROBE，与测试文件完全对应；现有个人 mpv 配置不再作为此项测试的输入，也未被修改。测试不会修改系统环境变量，正式启动保留原生配置搜索行为。实际个人 shader 执行、字体渲染和 HDR 效果仍待真实媒体验收。

## 64 位缓存属性回报修复

在同一个真实 embed 中依次设置字符串形式的 900/2048/3072/4096/8192MiB。原 bridge 返回 943718400/-2147483648/-1073741824/0/0；让 mpv 自己以原始文本展开同一属性，得到 943718400/2147483648/3221225472/4294967296/8589934592。由此确认配置值在 native 中正确，截断发生在整数回传路径，不能通过给负数加 2^32 恢复所有值。

公开参考 [Kagami/mpv.js index.cc](https://github.com/Kagami/mpv.js/blob/master/index.cc) 的 INT64 → int32_t 转换与实测行为一致；该源码仅解释机制，尚未证明它精确对应 Carnival 二进制。

0.1.1 将缓存字节数用 `expand-properties set` 写入自有、非持久化 `user-data/emby-theater-enhanced/diagnostics/cache-bytes`，然后以字符串读取并验证为安全整数。每次先清空该槽，避免命令失败时读到旧值。它只改变一个诊断元数据槽，不更改缓存选项、播放 source 或 Session。标准属性接口见 [mpv 手册](https://mpv.io/manual/stable/#input-command-prefixes)。

新增日志将 `value=3221225472`、`transport=mpv-text` 与 `legacyValue=-1073741824` 同时记录；不支持文本路径时标记 unavailable，不伪造容量。实际内存分配峰值不是本测试范围，不能将配置容量直接解释为已占用内存。

`libmpv.js` 在播放时覆盖 appSettings 对应的 hwdec、vo、gpu-api、demuxer-max-bytes 等设置。当前不新增画质默认值，不强制 3GiB 缓存，不自动写入补丁中的个人 mpv 配置。
