# STRM Playback Source Resolver

Resolver 运行在现有 `PlaybackManager → libmpv` 播放链内，只决定 Embedded libmpv 最终加载的 source，不创建播放器、Session 或 PlaySession。规则命中后按 `cloud-first`、`mount-first` 或 `custom` order 尝试 safe CloudDrive2 DirectUrl、CloudDrive2 same-origin HTTP、Mount 和 Native。

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

`type: 'url'` 表示已经由 main process 校验的 DirectUrl 或 CD2 same-origin HTTP(S) source；`sourceKind` 区分 `direct-url` 与 `cd2-url`。只有 DirectUrl 可以携带受限的 `requestOptions.userAgent`，并由 libmpv 作为 file-local `loadfile` option 传递。CD2 resolver 不控制播放器，也不改变输入 context。

## CloudDrive2 rules

1. 复用 Mount Resolver 的确定性媒体候选，不扫描目录、不解析 provider opaque id。
2. main process 以 persistent schema version 1 配置为 authoritative source；首次启动且没有持久化配置时才读取 `ETE_CD2_ENABLED`、`ETE_CD2_ORIGIN`、`ETE_CD2_TOKEN`、`ETE_CD2_LOCAL_PREFIX` 与 `ETE_CD2_CLOUD_PREFIX` 做 AUTO bootstrap。token 不进入 renderer、诊断或日志。
3. 每条命中规则独立执行 source prefix → POSIX cloud prefix mapping，并保留 source/mount/cloud 三种路径语义；drive/UNC 大小写不敏感，absolute POSIX 大小写敏感，均严格检查路径边界并拒绝 `..`。absolute POSIX `MediaSource.Path` 带 allowlisted 媒体后缀时是确定性 CD2 candidate；在 Windows client 上它不会进入 `existsSync` Mount 检查，只能由 CD2 命中，否则继续下一 stage。
4. 先调用 `GetDownloadUrlPath(... get_direct_url=true)`；只有安全 HTTP(S) DirectUrl、空 additionalHeaders、受限可打印 ASCII User-Agent 与有效 expiry 才可直连。任意 additionalHeaders、控制字符、逗号/反斜杠 UA、无效/近过期 URL 均优先 same-origin。
5. `direct-url` 与 `cd2-http` 通过同一 main service 的窄 mode 区分；DirectUrl miss/unsupported/transport failure 后按当前规则的下一 stage 取得同源 URL。连续 CD2 stages 复用 Find 结果并共享 750ms absolute budget。Abort/superseded 不进入 fallback。

## Mount rules

按以下顺序尝试，只有 `fs.existsSync(candidate) === true` 才命中。

1. sidecar stem 已含媒体扩展，例如 `Movie.mkv.strm → Movie.mkv`。
2. `sourcePath` 已是明确的 Windows 本地路径或 UNC 路径，例如 `C:\Media\Movie.mkv`、`\\server\share\Movie.mkv`。
3. 从 HTTP(S) `sourcePath` 的 URL pathname 提取明确文件名，并在 `sidecarPath` 所在目录尝试。
4. 从 URL 的 `name`、`filename` 或 `file_name` query 参数提取明确文件名，并在 sidecar 所在目录尝试。

可作为 Mount candidate 的扩展为：`mkv`、`mp4`、`m4v`、`avi`、`mov`、`ts`、`m2ts`、`mts`、`webm`、`mpg`、`mpeg`、`vob`、`wmv`、`flv`、`y4m`、`mp3`、`flac`、`m4a`、`aac`、`ogg`、`opus`、`wav`、`wma`、`ape`、`alac`。其他扩展即使文件存在也不命中。

URL pathname 使用 `URL` 解析，编码文件名使用安全解码。解码、URL 解析或文件系统检查异常均转为 native fallback。

Mount 规则命中时，会将 candidate 按 `sourcePrefix → mountPrefix` 做确定性前缀替换，再执行 `existsSync`。没有 `mountPrefix` 的规则不会猜测本地路径。

第一版不进行模糊搜索、递归扫描、全盘搜索、父目录猜测、历史缓存、数据库或 provider 特判。

## Fallback and playback safety

- 非 STRM、缺少 `item`/`mediaSource`/任一三个路径字段、未知播放方式和任何 Resolver 异常都保留 `nativeSource`。
- `Transcode` 始终保留 `nativeSource`。
- `DirectPlay` 和 `DirectStream` 只有在确定性本地文件命中时才替换 source。
- renderer Resolver 只通过窄 IPC 请求 main-process CD2 service，不自行 seek，也不改变 resume offset、音轨、字幕、`MediaSourceId` 或 `PlaySessionId`。
- `libmpv.playInternal` 仅使用结果的 `source` 调用原有 `loadfile`；原始 `options` 继续用于字幕、音轨、上报和 Session 控制。
- PlaybackManager request id 与 libmpv generation 使新 Play/NextTrack/Stop/destroy 立即淘汰旧请求；旧 RPC、旧 `core-playing` listener 和旧 error recovery 不得影响新播放。

诊断只记录 `isStrm`、结果类型、reason、local exists 和 fallback，不记录完整媒体路径、URL、凭据、媒体名称或 Item 标识。当前 reason 包括 `mount_hit`、`mount_missing`、`mapping_miss`、`transport_error`、`not_strm`、`transcode_skip`、`invalid_context`、`parse_failed` 和 `native_fallback`。

## Known limitations

当前 unit/fake/frozen Electron 已覆盖 DirectUrl + file-local UA、unsafe UA/header → same-origin、known-expiry bounded reacquire、transport reject/timeout → same-origin、规则策略顺序、source/mount/cloud prefix replacement、最长前缀、AUTO/USER/DISABLED、CD2 miss → Mount/Native、POSIX candidate 不进入 Windows Mount、Transcode、Abort、cancel、late callback、双 NextTrack、libmpv Stop、PlaybackManager Stop-before-player.play 和旧 `core-playing` listener。真实 settings UI 的 native-window 自动化和真实服务器 cloud-first/mount-first playback 未在本分支宣称；HTTP-error-triggered refresh、任意 additionalHeaders 和 active full-directory discovery 仍不支持。
