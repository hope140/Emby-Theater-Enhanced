# STRM Playback Source Resolver

Resolver 运行在现有 `PlaybackManager → libmpv` 播放链内，只决定 Embedded libmpv 最终加载的 source，不创建播放器、Session 或 PlaySession。当前优先级为 CloudDrive2 same-origin HTTP → Mount → Native；DirectUrl 不在本阶段。

## Detection

满足以下任一条件即视为 STRM，比较大小写不敏感。

- `Item.Path` 是字符串且以 `.strm` 结尾。
- `MediaSource.Container` 为 `strm`。

普通媒体直接返回 native source，不进入本地路径推导。

## Context

Resolver 使用三个严格分离的路径字段。

| 字段 | 来源 | 含义 |
|---|---|---|
| `sidecarPath` | `Item.Path` | `.strm` sidecar identity |
| `sourcePath` | `MediaSource.Path` | sidecar 中保存的目标路径或 URL |
| `nativeSource` | `options.url` | PlaybackManager 已决定的最终原生播放 source |

`item`、`mediaSource`、`playMethod` 和完整 `streamInfo` 只作为现有播放上下文传入。Resolver 不修改这些对象。

## Resolver contract

同步 `resolve()` 保留原 Mount 契约；产品播放使用异步 `resolveAsync()`，CD2 成功可返回 URL，否则继续原 Mount/Native 契约。

```javascript
{
    type: 'native' | 'local' | 'url',
    source: '...',
    reason: '...',
    isStrm: true | false,
    localExists: true | false,
    fallback: true | false
}
```

`type: 'url'` 只表示已经由 main process 校验的 CD2 same-origin HTTP(S) source。CD2 resolver 不控制播放器，也不改变输入 context。

## CloudDrive2 rules

1. 复用 Mount Resolver 的确定性媒体候选，不扫描目录、不解析 provider opaque id。
2. main process 读取 `ETE_CD2_ENABLED`、`ETE_CD2_ORIGIN`、`ETE_CD2_TOKEN`、`ETE_CD2_LOCAL_PREFIX` 与 `ETE_CD2_CLOUD_PREFIX`；token 不进入 renderer、诊断或日志。
3. V1 仅支持一条 local prefix → POSIX cloud prefix mapping；drive/UNC 大小写不敏感，absolute POSIX 大小写敏感，均严格检查路径边界并拒绝 `..`。absolute POSIX `MediaSource.Path` 带 allowlisted 媒体后缀时是确定性 CD2 candidate；在 Windows client 上它不会进入 `existsSync` Mount 检查，只能由 CD2 命中，否则继续 native fallback。
4. 只调用 `FindFileByPath` 和 `GetDownloadUrlPath(preview=false, lazy_read=false, get_direct_url=false)`；只接受 regular file、完整 placeholder、HTTP(S) 与相同 scheme/host/port。
5. foreign host/port、DirectUrl、externalUrl、未知 scheme、空/目录/异常响应和 RPC failure 全部视为 CD2 miss，再走 Mount → Native。

## Mount rules

按以下顺序尝试，只有 `fs.existsSync(candidate) === true` 才命中。

1. sidecar stem 已含媒体扩展，例如 `Movie.mkv.strm → Movie.mkv`。
2. `sourcePath` 已是明确的 Windows 本地路径或 UNC 路径，例如 `C:\Media\Movie.mkv`、`\\server\share\Movie.mkv`。
3. 从 HTTP(S) `sourcePath` 的 URL pathname 提取明确文件名，并在 `sidecarPath` 所在目录尝试。
4. 从 URL 的 `name`、`filename` 或 `file_name` query 参数提取明确文件名，并在 sidecar 所在目录尝试。

可作为 Mount candidate 的扩展为：`mkv`、`mp4`、`m4v`、`avi`、`mov`、`ts`、`m2ts`、`mts`、`webm`、`mpg`、`mpeg`、`vob`、`wmv`、`flv`、`y4m`、`mp3`、`flac`、`m4a`、`aac`、`ogg`、`opus`、`wav`、`wma`、`ape`、`alac`。其他扩展即使文件存在也不命中。

URL pathname 使用 `URL` 解析，编码文件名使用安全解码。解码、URL 解析或文件系统检查异常均转为 native fallback。

第一版不进行模糊搜索、递归扫描、全盘搜索、父目录猜测、历史缓存、数据库或配置映射。

## Fallback and playback safety

- 非 STRM、缺少 `item`/`mediaSource`/任一三个路径字段、未知播放方式和任何 Resolver 异常都保留 `nativeSource`。
- `Transcode` 始终保留 `nativeSource`。
- `DirectPlay` 和 `DirectStream` 只有在确定性本地文件命中时才替换 source。
- renderer Resolver 只通过窄 IPC 请求 main-process CD2 service，不自行 seek，也不改变 resume offset、音轨、字幕、`MediaSourceId` 或 `PlaySessionId`。
- `libmpv.playInternal` 仅使用结果的 `source` 调用原有 `loadfile`；原始 `options` 继续用于字幕、音轨、上报和 Session 控制。
- PlaybackManager request id 与 libmpv generation 使新 Play/NextTrack/Stop/destroy 立即淘汰旧请求；旧 RPC、旧 `core-playing` listener 和旧 error recovery 不得影响新播放。

诊断只记录 `isStrm`、结果类型、reason、local exists 和 fallback，不记录完整媒体路径、URL、凭据、媒体名称或 Item 标识。当前 reason 包括 `mount_hit`、`mount_missing`、`mapping_miss`、`transport_error`、`not_strm`、`transcode_skip`、`invalid_context`、`parse_failed` 和 `native_fallback`。

## Known limitations

当前 unit/fake/frozen Electron 已覆盖 CD2 hit、transport reject → Mount/Native、CD2 miss → Mount/Native、POSIX candidate 不进入 Windows Mount、Transcode、timeout、Abort、cancel、late callback、双 NextTrack、libmpv Stop、PlaybackManager Stop-before-player.play 和旧 `core-playing` listener；PlaybackManager fixture 中 Item/MediaSource/PlaySessionId、控制与报告保持。独立真实 CD2 MKV 已观察 `core-playing`、`core-idle=false`、track list、cache state 与 time-pos 推进。2026-09-14 两个真实 Emby POSIX STRM 样本在同一条 ignored source-side mapping 下均返回 `cd2_hit`，source kind 为 CD2 URL，embedded libmpv/core-playing、Session/WebSocket/controls/reports 全部通过。DirectUrl、refresh、retry、多 mapping 与设置 UI 留待后续。
