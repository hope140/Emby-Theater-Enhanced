# STRM Mount Resolver

本阶段实现一个最小的 STRM Mount Resolver。它运行在现有 `PlaybackManager → libmpv` 播放链内，只决定 Embedded libmpv 最终加载的 source，不创建播放器、Session 或 PlaySession。

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

成功或 fallback 都返回一个同步结果。

```javascript
{
    type: 'native' | 'local',
    source: '...',
    reason: '...',
    isStrm: true | false,
    localExists: true | false,
    fallback: true | false
}
```

本阶段不产生 `type: 'url'`。该类型为未来 CD2 Resolver 预留。

## Mount rules

按以下顺序尝试，只有 `fs.existsSync(candidate) === true` 才命中。

1. sidecar stem 已含媒体扩展，例如 `Movie.mkv.strm → Movie.mkv`。
2. `sourcePath` 已是明确的 Windows 本地路径或 UNC 路径，例如 `C:\Media\Movie.mkv`、`\\server\share\Movie.mkv`。
3. 从 HTTP(S) `sourcePath` 的 URL pathname 提取明确文件名，并在 `sidecarPath` 所在目录尝试。
4. 从 URL 的 `name`、`filename` 或 `file_name` query 参数提取明确文件名，并在 sidecar 所在目录尝试。

URL pathname 使用 `URL` 解析，编码文件名使用安全解码。解码、URL 解析或文件系统检查异常均转为 native fallback。

第一版不进行模糊搜索、递归扫描、全盘搜索、父目录猜测、历史缓存、数据库或配置映射。

## Fallback and playback safety

- 非 STRM、缺少 `item`/`mediaSource`/任一三个路径字段、未知播放方式和任何 Resolver 异常都保留 `nativeSource`。
- `Transcode` 始终保留 `nativeSource`。
- `DirectPlay` 和 `DirectStream` 只有在确定性本地文件命中时才替换 source。
- Resolver 不执行网络请求、不等待远端、不自行 seek，也不改变 resume offset、音轨、字幕、`MediaSourceId` 或 `PlaySessionId`。
- `libmpv.playInternal` 仅使用结果的 `source` 调用原有 `loadfile`；原始 `options` 继续用于字幕、音轨、上报和 Session 控制。

诊断只记录 `isStrm`、结果类型、reason、local exists 和 fallback，不记录完整媒体路径、URL、凭据、媒体名称或 Item 标识。当前 reason 包括 `mount_hit`、`mount_missing`、`not_strm`、`transcode_skip`、`invalid_context`、`parse_failed` 和 `native_fallback`。

## Known limitations

当前已通过 Node 单元测试和隔离 frozen Electron 的 PlaybackManager/libmpv 夹具。夹具覆盖普通媒体、无 Mount 的 STRM fallback、Mount 文件命中以及 Session/control 状态保持；真实 Emby 服务器上的 Mount 命中、不同媒体编码、字幕/音轨差异和长时间稳定性仍需实机验收。CD2 不在本阶段范围内。

未来解析优先级为 `CD2 → Mount → native`。CD2 应在不改变本契约和 PlaybackManager 生命周期的前提下作为更高优先级 source resolver 接入。
