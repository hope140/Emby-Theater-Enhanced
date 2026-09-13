# CloudDrive2 Resolver 调研与 V1 设计

更新时间：2026-09-13（UTC+8）

本轮目标是调研并设计下一阶段 CloudDrive2 Resolver。**本轮没有修改 Enhanced 产品源码，没有接入 CD2 播放，没有执行真实 refresh，也没有修改本机 CloudDrive2 配置。**

## 结论摘要

- ETLP beta 的 CD2 查询链路使用 Python `grpcio` + protobuf；查询结果不是 Windows 本地路径，而是由 CloudDrive2 返回的同源 HTTP 下载 URL 路径和 query。
- ETLP 的完整数据面同时包含本地 HTTP gateway。外置播放器先打开 `127.0.0.1:58000/cd2/<nonce>`，gateway 再按需解析 CD2 URL，并用 HTTP 307 转交给 CloudDrive2。
- 当前本机 CloudDrive2 运行态已通过真实只读检查。一个现有挂载和一个有限查找到的媒体样本均可访问，`FindFileByPath` 和 `GetDownloadUrlPath` 成功；实际返回 URL 的 `HEAD` 为 200，单字节 `Range` 为 206。
- ETLP 当前把 `path_map` 作为 Windows 本地路径进入 CD2 查询的前置条件。运行中的 ETLP 配置有一条映射，但对本轮从 CD2 挂载点发现的样本路径没有命中，具体路径不写入仓库。
- `refresh`、Range/临时 URL 生命周期、动态 header、gRPC 依赖和 PlaybackManager source replacement 之间存在跨层风险；后续 Sol High 评审已完成，结论见第 15 节。本轮仍不开始实现。

## 调研范围与证据边界

| 证据层 | 本轮结果 | 能证明什么 |
| --- | --- | --- |
| ETLP 静态源码 | 已审计 beta 分支快照 `54b2abae0537f1b4c65752edaac059d3cda4790e` | 函数、调用关系、配置语义、失败处理和测试设计 |
| 本机 CD2 运行态 | 服务运行，端口和配置已只读检查 | 当前本机服务状态、版本、挂载和 RPC 能力 |
| 真实只读 API | 已查询一个现有媒体样本 | 当前实例的请求格式、响应结构、URL 类型、Range 行为 |
| Enhanced 播放集成 | 未执行 | 不得把本轮结果写成 Enhanced 已支持 CD2 播放 |
| 真实 refresh | 未执行 | 不得把冷目录刷新效果、耗时或副作用写成实测结论 |

参考来源：

- [hope140/embyToLocalPlayer beta 源码快照](https://github.com/hope140/embyToLocalPlayer/tree/54b2abae0537f1b4c65752edaac059d3cda4790e)
- [ETLP beta 的 CloudDrive2 client](https://github.com/hope140/embyToLocalPlayer/blob/54b2abae0537f1b4c65752edaac059d3cda4790e/utils/clouddrive2_client.py)
- [ETLP beta 的 CloudDrive2 gateway](https://github.com/hope140/embyToLocalPlayer/blob/54b2abae0537f1b4c65752edaac059d3cda4790e/utils/clouddrive2_gateway.py)
- [CloudDrive2 gRPC API 开发者指南](https://www.clouddrive2.com/api/CloudDrive2_gRPC_API_Guide.html)
- [CloudDrive2 官方帮助文档](https://www.clouddrive2.com/en/help.html)

## 1. ETLP 当前 CD2 架构与完整调用链

本轮按用户要求优先审计 `beta`。`stable` 也包含 CD2 client、gateway 和 proto，但 beta 快照是指定的测试频道，且相对 stable 的 CD2 相关差异包含最新 gateway 测试和配置调整；没有切换到其他分支。

完整链路如下：

```text
Emby PlaybackInfo
  ↓ user_script 拦截并补齐 Item / MediaSources / Episodes
dealWithPlaybackInfo()
  ↓ POST JSON，X-ETLP-Protocol: 1
ETLP 本地 HTTP 服务 :58000
  ↓ parse_received_data_emby()
Item.Path + MediaSource.Path
  ↓ strm_local_media_path()
  ↓ translate_path_by_ini()：服务器路径 → 本地/挂载路径
  ↓ maybe_register_strm_cd2_url()
CloudDrive2Gateway：登记短期 nonce
  ↓ 外置播放器先打开 /cd2/<nonce>
CloudDrive2Gateway.send_cd2_file()
  ↓ CloudDrive2Client.resolve_download_url()
FindFileByPath（gRPC）
  ↓ miss 时可选父目录 refresh（本轮未执行）
GetDownloadUrlPath（gRPC）
  ↓ 展开 {SCHEME}/{HOST}/{PREVIEW}，校验同源 HTTP(S)
HTTP 307 Location: CloudDrive2 download URL
  ↓ 播放器继续请求 CD2 HTTP source
HTTP Range / media bytes
```

具体入口和职责：

1. `user_script/embyToLocalPlayer.user.js:965-1115` 拦截 Emby 的 `PlaybackInfo`，`dealWithPlaybackInfo()` 并行取得 PlaybackInfo、Item 信息和剧集信息，然后把原始播放上下文发给 `/embyToLocalPlayer/`。
2. `embyToLocalPlayer.py:26-43` 启动配置、后台任务和 `utils.http_server.run_server()`。
3. `utils/http_server.py:342-380` 调用 `parse_received_data_emby()`，之后按 ETLP 原有播放/下载模式分派。服务默认监听回环 `127.0.0.1:58000`。
4. `utils/data_parser.py:58-115` 的 `strm_local_media_path()` 根据 STRM sidecar 和 source path 推导本地媒体文件名。
5. `utils/data_parser.py:160-325` 是 Emby 主解析路径。它分离 `file_path`、`source_path`、`stream_url`，完成本地路径转换，并在 `use_strm_local_path` 成立时调用 `maybe_register_strm_cd2_url()`。
6. `utils/data_parser.py:596-1009` 为播放列表中的每一集重复相同的 STRM 本地路径和 CD2 gateway 登记逻辑。
7. `utils/clouddrive2_gateway.py:126-238` 读取 CD2 配置、检查 token 和 path mapping，登记本地路径与 fallback URL，返回只包含随机 nonce 的 gateway URL。
8. `utils/http_server.py:662-887` 处理 `/cd2/<nonce>`。它按 CD2 → 本地媒体 → 当前播放的非本地 URL → sibling `.strm` pointer 的顺序决定最终路由，并在可用时返回 307。
9. `utils/clouddrive2_client.py:184-365` 执行 gRPC 文件查询和下载 URL 查询；`367-488` 是缺失文件时的有限父目录 refresh；`500-522` 校验返回 URL。
10. `utils/http_server.py:993-1082` 将 `media_path` 交给播放器。`utils/players.py:451-552` 的 mpv 启动参数直接使用该路径；`use_strm_cd2_url` 只改变外置播放器的 HTTP/读盘参数判断，不创建第二个播放器或第二个会话。

## 2. ETLP CD2 transport、API 与依赖

### 2.1 ETLP 使用 HTTP、gRPC，还是两者都有

答案是两者都有，但职责不同。

| 层 | Transport | 用途 |
| --- | --- | --- |
| CD2 控制/文件查询 | gRPC | `FindFileByPath`、`GetSubFiles`、`GetDownloadUrlPath` |
| CD2 媒体数据面 | HTTP | CloudDrive2 返回的下载 URL，实际承载媒体和 Range |
| ETLP 本地桥接 | HTTP | `127.0.0.1:58000/cd2/<nonce>`、浏览器到本地服务 |
| ETLP 与 CD2 的 JSON REST 查询 | 未发现 | beta 源码没有用 HTTP JSON API 查询 CD2 文件 |

`origin` 是 CD2 本机 API 地址，默认形态为 `http://127.0.0.1:19798`，不是 Emby 地址。默认 gRPC channel 使用 `grpc.insecure_channel(host:port)`；HTTPS origin 则使用 gRPC secure channel。

### 2.2 RPC 调用

beta 使用 `third_party/clouddrive2/clouddrive.proto` 生成的 Python protobuf/gRPC 模块：

1. `FindFileByPathRequest(parentPath="", path=<cloud_path>)` → `CloudDriveFile`。
2. 若首次查询是 missing，按有限规则调用 `GetSubFiles(ListSubFileRequest(path=<directory>, forceRefresh=True, checkExpires=True))`，消费 server-stream 到 EOF，再只重查一次目标。
3. 文件存在且不是目录后调用 `GetDownloadUrlPathRequest(path=<cloud_path>, preview=False, lazy_read=False, get_direct_url=False)` → `DownloadUrlPathInfo`。

`CloudDriveFile` 返回 `fullPathName`、`size`、`fileType`、`isDirectory` 等元数据。它不返回 Windows 本地文件路径。

`DownloadUrlPathInfo` 可能包含：

- `downloadUrlPath`：下载 URL 的 path 和 query，可能带 `{SCHEME}`、`{HOST}`、`{PREVIEW}` 占位符。
- `expiresIn`：可选的有效期。
- `directUrl`：可选的云厂商直链。
- `userAgent`、`additionalHeaders`：访问直链时可用的附加信息。

ETLP 当前明确设置 `get_direct_url=False`，并拒绝 `directUrl`、`externalUrl`、外部 host、外部端口和不支持的 scheme。它只接受拼回 CD2 origin 后仍同源的 HTTP(S) URL。

### 2.3 鉴权

gRPC metadata 使用：

```text
authorization: Bearer <token>
```

proto 注释将文件操作和运行信息列为 authorized methods。`GetSystemInfo` 可以无 token 查询；本机实测 `GetRuntimeInfo`、`GetMountPoints`、`FindFileByPath` 和 `GetDownloadUrlPath` 需要有效 Bearer token。

ETLP beta 配置支持环境变量 `ETLP_CLOUDDRIVE2_TOKEN`，否则回退 `[clouddrive2] api_token`。真实 token 不应进入源码、日志、证据或本文档。

### 2.4 gRPC native dependency 与 Enhanced 兼容性

ETLP 当前要求和打包方式如下：

- `grpcio==1.80.0`。
- `protobuf==6.33.6`。
- beta 发布包带有 `grpcio-1.80.0-cp39-cp39-win32.whl` 和 `protobuf-6.33.6-cp39-cp39-win32.whl`。
- `utils/dependency_bootstrap.py` 只针对 Windows、CPython 3.9、32-bit 解释器解包这些 wheel；`grpcio` 是带 native 扩展的 Python 依赖。
- `third_party/clouddrive2/clouddrive.proto` 的文件版本声明为 `1.0.13`，本机运行时 RPC 返回 `CloudAPIVersion=1.0.15`。本轮使用的基础 RPC 兼容，但 proto/runtime 版本漂移是实际存在的绑定风险。

这套 `cp39-win32` Python wheel 不能直接由 Enhanced 当前的 Node 16 / Electron 18 x64 runtime 加载，也不能当作 Node native module 使用。当前 Enhanced 没有 Node gRPC 依赖；`package.json` 只有构建工具和 `node-unrar-js`，没有现成 CD2 transport。

如果最终由 Electron 进程直接访问 CD2，需要另行评估 JS gRPC 实现、proto 生成、Electron 18/Node 16 打包和证书/HTTP2 兼容性。当前 ETLP 的 Python native wheel 不能直接迁移。该评估已在第 15 节完成。

## 3. STRM → CD2 路径推导

### 3.1 ETLP 的 identity 分离

`parse_received_data_emby()` 保留以下差异：

| 字段 | ETLP 来源 | 语义 |
| --- | --- | --- |
| `file_path` | `mainEpInfo.Path`，或直播特殊分支的 source path | Emby Item/STRM sidecar 身份 |
| `source_path` | 选定 `MediaSource.Path` | STRM 内部文本、服务器路径或 URL |
| `stream_url` | 由 ItemId、MediaSourceId、PlaySessionId 和服务器地址构造 | Emby 原生网络 fallback |
| `media_path` | 本地路径、原生 URL 或 CD2 gateway URL | 最终传给外置播放器的 source |

这和 Enhanced 当前的 `Item.Path`、`MediaSource.Path`、`options.url` 三分原则一致。未来 CD2 只能改变最终 source，不得把 CD2 的路径结果写回 Item、MediaSource 或 Session 身份。

### 3.2 `strm_local_media_path()` 支持的输入

当前等价函数是 `utils/data_parser.py:strm_local_media_path()`，规则顺序如下。

| 输入/规则 | 当前行为 | 分类 | Enhanced V1 建议 |
| --- | --- | --- | --- |
| `Film.mkv.strm` 的 sidecar stem | 直接得到 `Film.mkv` | 通用、确定性 | 保留，沿用当前 Mount allowlist |
| source path 本身是明确的本地路径并带媒体后缀 | 取后缀并保留 sidecar 目录/基名 | 通用，但必须有 allowlist | 保留为已有 Mount 规则的输入，不新增模糊推导 |
| HTTP URL pathname 的明确媒体文件名 | 取 pathname 后缀，保留 sidecar 目录/基名 | 通用、确定性 | 保留，当前 Mount Resolver 已覆盖 |
| query 第一个 `?` 后的 path-like 文件名 | 兼容 `/d/opaque-id?/Source.mkv` 一类格式 | 旧 CMS/历史格式 | 延后，除非实际库证明硬依赖 |
| query 的 `name`、`filename`、`file_name` | 只读取这些显式字段的媒体后缀 | provider-compatible，风险可控 | 当前 Mount Resolver 已覆盖，可复用规则，不再扩展 key |
| `pickcode` 或其他 opaque ID 自身 | 不读取 opaque ID 的后缀 | 安全边界 | 不迁移 |
| `strm_local_fallback_ext` | 由配置猜测后缀 | 配置特例，可能误命中 | 不进入 V1 |
| 多版本 source 替换、标题版本偏好、playlist 版本过滤 | 在 parser/playlist 层处理 | ETLP 外置播放器策略 | 不放入 Resolver |

ETLP 的视频后缀集合比 Enhanced 当前明确 allowlist 更宽，包含 ISO、RMVB 等扩展。第一版继续以 Enhanced 已确认的音视频 allowlist 为边界，避免因为“能推导出后缀”就把非预期文件交给 libmpv。

### 3.3 STRM 路径推导结论

应迁移的是确定性候选生成和 identity 分离，不应迁移完整 ETLP parser。对于 Enhanced，建议 CD2 Resolver 接收现有 STRM Resolver 已确认的 `sidecarPath`、`sourcePath`、`nativeSource`，先得到确定性本地候选，再经过显式 local→cloud prefix mapping；不要直接把 opaque URL、pickcode 或 server path 当作 CD2 cloud path。

## 4. Path Mapping

### 4.1 ETLP 有两层 mapping

1. `[src]` / `[dst]`：`utils/tools.py:263-287` 的 `translate_path_by_ini()` 把 Emby/Jellyfin 显示的服务端前缀替换成本地或挂载前缀。它按配置顺序检查 `startswith`，是字符串前缀替换；可配置多条同名键，是否检查文件存在由 `path_check` 控制。
2. `[clouddrive2] path_map`：`utils/clouddrive2_client.py:135-158` 和 `219-235` 把本地路径转换为 CD2 POSIX cloud path。内部支持最长前缀优先、大小写不敏感和路径边界检查，不使用正则。映射在 CD2 `FindFileByPath` 之前发生。

典型抽象关系为：

```text
Emby server path
  -- [src]/[dst] --> local or mounted Windows path
  -- [clouddrive2] path_map --> CD2 POSIX cloud path
  -- FindFileByPath --> CD2 file metadata
```

### 4.2 多规则和存储位置

- `[src]` / `[dst]` 是成对配置，ETLP 当前运行配置各有一条有效规则。
- `CloudDrive2Client._parse_path_map()` 对 Python sequence 支持多条规则；但 production INI 通过 `ConfigParser` 读成一个字符串，当前 `[clouddrive2] path_map` 实际只解析一条 `local=>cloud` 规则。
- 当前运行中的 ETLP 配置启用 CD2、存在一条 `path_map`、存在 token，`refresh_parent_levels=3`，`strm_local_by_file_path=yes`。
- 本轮从 CD2 自己的已挂载 drive-letter mount 中有限找到一个媒体文件。该 drive letter 与 ETLP `path_map` 的 drive letter 一致，但更深的 local prefix 没有命中，因此 ETLP client 对该样本返回 mapping miss；这不是 CD2 文件查询失败。
- CD2 运行态的 mount 是一个已挂载的 Windows drive-letter mount，`localMount=true`、`autoMount=true`、`readOnly=false`。源目录深度为 1；真实盘符、源目录、媒体路径和文件名不写入本文档。

### 4.3 V1 判断

对于 ETLP 当前“本地挂载路径 → CD2 cloud path”的路线，mapping 是 basic resolver 的硬依赖。没有 mapping 时，Windows drive/UNC 路径不能安全地被当成 CD2 cloud path；ETLP gateway 也会主动阻止这种请求。

建议 V1 只支持一条明确的 prefix mapping，放在一个小的配置/纯函数边界中；复杂多实例、正则、自动发现和历史映射库留到后续独立设计。严格来说，mapping 可以作为独立小 PR，但不能在“ETLP 风格 Windows 路径”模式中从 V1 完全移除。

## 5. Refresh

### 5.1 静态源码行为

`CloudDrive2Client._resolve()` 的行为是：

```text
FindFileByPath(target)
  ├─ found file → GetDownloadUrlPath(target)
  ├─ found directory → reject
  ├─ error/timeout/auth error → fail，不 refresh
  └─ missing
       ↓
     查找有限的父目录链
       ↓
     GetSubFiles(parent, forceRefresh=True, checkExpires=True)
       ↓ consume server-stream 到 EOF
     只重查一次 target
       ↓
     found → GetDownloadUrlPath
     otherwise → fail
```

当前参数和边界：

- `refresh_parent_levels` 默认 3，配置值限制在 1–8。
- 默认 3 层时，代码按 `category → show → season` 的顺序 refresh；更深层使用 `ancestorN` 标签。
- 每次 refresh 需要消费 unary-stream 到 EOF，不能只发起 RPC 就返回。
- 一个 refresh guard 串行化并发请求；target/directory cooldown 为 5 秒。
- refresh 成功后只有一次 target recheck，没有无限 retry。
- 初始查询出错时不会 refresh；目录、无效响应和 URL 校验失败都直接进入 gateway fallback。

按代码推断，默认 `request_timeout_seconds=2` 时，缺失路径的最坏等待量级约为初始查询、最多 3 层 refresh 预算和一次 recheck 的总和，约 10 秒量级；实际耗时取决于每个 RPC 是否快速失败。本数字是静态上限量级推断，不是本机实测。

### 5.2 本轮实际状态

本轮没有调用 `GetSubFiles`，所以没有真实 refresh 证据。`Refresh tested: no`。

### 5.3 V1 判断

warm cache 的单次 `FindFileByPath + GetDownloadUrlPath` 已足以完成核心功能；不实现 refresh 时，主要损失是 cold directory 的命中率，不影响已经被 CD2 索引的文件。实际下降比例 unknown，不能从本轮一个样本推算。

建议 V1 暂不迁移父目录 refresh/retry/cooldown。若用户要求 cold mount 必须首播成功，应单独批准真实 refresh 测试，并由 Sol High 评估延迟、并发和流消费生命周期。

## 6. Headers、Range、鉴权与 URL 生命周期

### 6.1 静态实现结论

- gRPC 查询需要 Bearer metadata。
- ETLP 不把 Emby 的 `Authorization`、Cookie、Referer 或浏览器 headers 转发给 CD2。
- ETLP 请求 `get_direct_url=False`，因此核心路径只使用 CD2 自己的 HTTP download endpoint。
- `directUrl`、foreign URL、外部 host/port、非 HTTP(S) scheme 和未替换的 placeholder 都会被拒绝。
- ETLP 当前没有消费 `expiresIn`，也没有实现动态 `userAgent` 或 `additionalHeaders` 传递。
- gateway 对最终 CD2 URL 使用 307 和 `Cache-Control: no-store`；成功决策按 nonce 缓存 10 秒，失败决策缓存 1.5 秒，nonce 默认最长 6 小时。
- gateway 的本地 fallback 支持单一 RFC 7233 byte range、suffix range、EOF clipping；非法或不可满足范围返回 416。

### 6.2 本机真实只读结果

本轮对一个现有媒体样本完成：

| 检查 | 结果 |
| --- | --- |
| `FindFileByPath` | found，非目录，size 非负 |
| `GetDownloadUrlPath` | 成功，返回 `downloadUrlPath` |
| `directUrl` | absent；没有走云厂商外部直链 |
| `userAgent` | absent |
| `additionalHeaders` | 空 |
| `expiresIn` | absent |
| 返回 source | 同源 HTTP URL，query 存在；完整 URL 不写入仓库 |
| HTTP `HEAD` | 200 |
| HTTP `GET Range: bytes=0-0` | 206，返回 1 byte |
| `Content-Type` | `video/x-matroska` |
| `Accept-Ranges` | `bytes` |
| `Content-Range` | Range 响应存在 |
| 302/307 | 本次 CD2 URL 请求未发生重定向 |
| HTTP Authorization | 未发送；URL 自身的 query 足以完成本次访问 |
| Cookie/Referer | 未发送 |

这证明当前本机样本可以由支持 Range 的 HTTP 播放器读取，但不能证明所有 provider、所有文件或所有版本都不需要动态 header。`expiresIn` 未返回而 URL query 含有 opaque token，实际有效期语义仍应按潜在临时 URL 处理。

### 6.3 Enhanced 风险判断

如果 V1 只接收“同源 HTTP URL，凭 URL 自带 query 鉴权，播放器自行处理 Range”，可以保持 Resolver changes source only。

如果 CD2 返回 external/direct URL，且必须由播放器动态设置 `User-Agent`、Cookie、Referer、Authorization 或其他 headers，则不能只替换 source 就保证语义。该场景涉及 libmpv HTTP 参数、临时 URL 生命周期和重连/seek；第 15 节已经完成评审，本轮不实现。

## 7. CD2 返回 source 与外置播放器交接

ETLP 的最终 source 不是 Windows path：

1. `CloudDrive2Client` 返回同源 HTTP download URL。
2. `CloudDrive2Gateway` 保留 local path 和 fallback URL 在进程内存，只向播放器暴露随机 nonce。
3. 外置播放器首先打开本地 gateway URL。
4. gateway 解析成功则 307 到 CD2 HTTP URL；播放器后续对 CD2 URL 发起 Range 请求。
5. CD2 失败时，gateway 可以直接服务已存在的本地媒体文件，或 307 到本次播放的 Emby stream URL；若这些都不可用才返回 404。

`utils/http_server.py:1008-1013` 在 CD2 URL 模式下把 `mount_disk_mode` 仅用于播放器参数判断，`utils/players.py:497-507` 仍使用原播放器启动和 HTTP 逻辑。ETLP 的进度、远控和退出处理仍由 `PlayerManager`、`RemoteControlClient`、`EmbyApiThin` 等既有链路负责。

这部分不能直接等价迁移到 Enhanced。Enhanced 的目标是由现有 `PlaybackManager → libmpv` 决定 Session、PlaySession、subtitle/audio、offset 和报告，再只替换最终 source。CD2 不能创建播放器、伪造 Session、接管 WebSocket、重写 MediaSourceId 或自行 seek。

## 8. Fallback 矩阵

| 失败/边界 | ETLP 当前处理 | Enhanced 目标处理 |
| --- | --- | --- |
| 非 STRM | 不登记 CD2，按普通模式 | 不进入 CD2，保留 native |
| CD2 disabled | gateway 不登记 | CD2 返回失败，再走 Mount → native |
| 缺 token / path_map | gateway 不登记 | CD2 fail，不阻断 Mount/native |
| 缺播放上下文或路径无法推导 | 不生成 CD2 URL | CD2 fail，不修改原生 source |
| origin 非法 | client 不可用，软失败 | CD2 fail，不抛出到播放入口 |
| CD2 未运行 / connection refused | gRPC client 软失败 | CD2 fail → Mount → native |
| timeout | 软失败；错误不触发 refresh | 短 timeout，继续 Mount → native |
| 404 / NOT_FOUND / missing | 有限 refresh 后重查一次，否则 fallback | V1 默认不 refresh，继续 Mount → native |
| 500 / UNAVAILABLE / 其他 RPC error | 软失败，不把错误抛给播放器 | CD2 fail → Mount → native |
| invalid JSON | 当前 gRPC 查询不适用；若未来增加 HTTP/JSON adapter，应视为 bad response | fake adapter 测试覆盖，继续 fallback |
| empty result / missing `fullPathName` | missing，进入 refresh/fallback | response validation fail，继续 fallback |
| directory result | 拒绝下载 URL | response validation fail，继续 fallback |
| invalid/foreign/direct URL | 拒绝 URL | 只接受明确允许的 source 类型，继续 fallback |
| URL query token 失效 | HTTP 播放失败；gateway 可在新请求时重新解析 | 不缓存超出设计生命周期，失败回到 Mount/native |
| local media 不存在 | 依次尝试当前播放 URL、sibling `.strm`，否则 404 | Mount miss 后回 native |
| refresh 失败 | local media / non-local URL / pointer / 404 | V1 不主动 refresh，保持 fallback |
| Transcode | ETLP parser 没有 Enhanced 的播放方式保护契约 | 必须保留 native，不能交给 CD2 |

核心不变量是：

```text
CD2 fail
  ↓
Mount fail
  ↓
Native source
```

CD2 的异常、超时、无效响应和鉴权失败都不能让原生 STRM 失去播放能力。

## 9. 可复用逻辑与禁止迁移逻辑

### 9.1 可复用

- `Item.Path` sidecar identity、`MediaSource.Path` source identity、native source 三者分离。
- 已有 Mount Resolver 的确定性媒体文件名推导和 allowlist。
- prefix mapping 的边界检查、最长前缀优先和 POSIX cloud path 规范化。
- gRPC response 的空值、目录、size、scheme、host、port 和 placeholder 校验思路。
- 短 timeout、错误软失败和只记录状态枚举的安全诊断。
- source replacement 后保留 PlaybackManager、Item、MediaSource、PlaySession、字幕/音轨、offset、WebSocket 和远控。
- fake transport、Range、307 fallback 和 CD2 → Mount → native 的测试模型。

### 9.2 不迁移

以下能力属于 ETLP 外置播放器产品，不是 Enhanced CD2 Resolver：

- Python 本地服务 `127.0.0.1:58000` 及其通用动作路由。
- Tampermonkey / browser hook / `fetch`、`XMLHttpRequest` 拦截。
- 外置播放器启动、进程管理、播放器参数拼接和 player-specific playlist API。
- `RemoteControlClient`、`EmbySessionApi` 的外置播放器补偿逻辑。
- 外置播放器实时进度、退出后 progress compensation 和独立控制会话。
- Jellyfin、Plex、Plex token、provider-specific 大量兼容逻辑。
- 目录扫描、历史路径数据库、自动学习、自动发现 CD2、多 CD2 实例。
- ETLP gateway 的完整 nonce lease、HTTP server、缓存预热和 player reconnect 管理。

这些代码即使在 ETLP 中已经存在，也不能因为“能工作”就绕过 Enhanced 的 PlaybackManager 或 libmpv 生命周期。

## 10. 本机真实 CloudDrive2 调研结果

以下只记录脱敏状态，不记录 token、cookie、账号、完整私人路径、真实媒体名或可复用临时 URL。

```text
Local CD2 detected: yes
CD2 version: runtime RPC 1.0.15, Build 26-08-24; registry display is only 1.0
Running process/service: CloudDrive2 service Running, Automatic; clouddrive.exe processes present
Detected transport: local gRPC for authorized RPC; HTTP for management and media data
Detected endpoint type: 127.0.0.1:19798 HTTP + gRPC; configured HTTPS 19799 was not listening at probe time
Authentication required: yes for authorized RPC; local ETLP token accepted as Bearer
Existing mount available: yes, one Windows drive-letter mount, mounted/local/auto-mount
Real read-only query tested: GetSystemInfo, GetRuntimeInfo, GetMountPoints, FindFileByPath, GetDownloadUrlPath
Real response source type (`get_direct_url=false`): same-origin HTTP download URL with query; not a Windows local path and not directUrl
115 direct-link response (`get_direct_url=true`): provider/external HTTPS directUrl present; userAgent present; additionalHeaders empty; expiresIn minutes-scale
Redirect behavior: CD2 URL HEAD/Range had no redirect; ETLP gateway design uses 307 to hand off source
Range behavior: HEAD 200; GET Range bytes=0-0 returned 206 and one byte; Accept-Ranges=bytes
Headers required: same-origin URL needs no extra HTTP headers; directUrl needs its returned userAgent; gRPC Bearer metadata required
Authentication: ETLP running config has a token; exact value was used only in memory and not recorded
Refresh tested: no
```

其他只读状态：

- `http://127.0.0.1:19798/` 返回管理页面 200。
- CD2 配置显示 HTTP 19798、HTTPS 19799，且 `enable_https=true`；但本轮端口检查中 19799 未监听，不能把配置值当作可用 TLS 证据。
- Windows core service 的配置目录遵循 system account 的 `Waytech/CloudDrive2` 位置；本文不写入本机用户路径。目录中存在 `config.toml`、`systemsettings.json`、mount metadata 和 token metadata 文件。
- CD2 proto source version 为 1.0.13，而运行时 RPC 版本为 1.0.15；基础只读调用兼容，但应在实现前固定 proto/runtime 兼容策略。
- 运行中的 ETLP Python 服务占用本地 58000，命令行识别为 `embyToLocalPlayer`。本轮没有通过它进行 Enhanced 集成播放。

## 11. Enhanced CD2 V1 建议

### 11.1 推荐目标结构

```text
src/electronapp/resolvers/
    strm-resolver.js
    cd2-resolver.js
    mount-resolver.js
```

调用关系保持为：

```text
strmResolver.resolve()
  ↓ detected STRM + DirectPlay/DirectStream
cd2Resolver.resolve()
  ├─ url hit → { type: 'url', source, reason: 'cd2_hit' }
  └─ fail
       ↓
mountResolver.resolve()
  ├─ local hit → { type: 'local', source, reason: 'mount_hit' }
  └─ fail → { type: 'native', source: options.url, reason: ... }
```

契约继续使用小对象：

```javascript
{
    type: 'url' | 'local' | 'native',
    source: '...',
    reason: '...'
}
```

### 11.2 V1 最小范围

建议只纳入：

1. 明确的 CD2 enable/config、origin、token 来源和一条 local→cloud prefix mapping。
2. 复用现有 STRM 确定性路径推导，不引入 provider-specific opaque ID 解析。
3. 一次逻辑 CD2 lookup，即 `FindFileByPath` + `GetDownloadUrlPath`；短 timeout；不做目录扫描。
4. response validation：非空文件、非目录、非负 size、允许的 HTTP(S) scheme、明确 origin/host/port、没有未替换 placeholder。
5. 只返回 `type: 'url'` 的同源 HTTP source；不使用 direct URL、动态 headers 或 external redirect。
6. CD2 失败后透明落到现有 Mount，再落到 native。
7. 限定诊断字段：enabled、lookup state、response state、result type、fallback reason；不记录路径、URL、token 或 Item 标识。

### 11.3 关于 gRPC 与 mapping 的明确判断

- 当前 CD2 的文件查询在 ETLP 中只有 gRPC 证据；HTTP 19798 是管理/媒体数据面，不足以证明存在可替代的 REST 文件查询。因此 gRPC transport 不能简单以“V2”名义删除，否则 basic CD2 resolver 没有查询入口。
- 但是 ETLP 的 Python `grpcio` wheel 不能直接放进 Enhanced。Node 侧使用何种 gRPC JS 实现、如何生成 proto、如何适配 Electron 18/Node 16，必须先经过 Sol High review。
- path mapping 对 Windows 路径是硬依赖。可以把复杂 mapping 延后，但 V1 至少需要一条明确、可测试、边界安全的 prefix mapping；本机当前 map 对测试样本未命中，不能据此宣称 ETLP 实际 gateway 已命中。

### 11.4 默认延后到 V2

除非用户明确要求且 Sol High review 证明必要，否则延后：

- 父目录 refresh、retry、cooldown、复杂异步和缓存。
- 正则 mapping、多条自动学习规则、历史路径数据库和自动发现。
- directUrl、User-Agent/Cookie/Referer/Authorization 注入以及高级 libmpv HTTP 参数。
- 多 CD2 实例、跨机器 CD2、WebDAV 替代、目录扫描和预热策略。
- 设置 UI、自动生成 token、token 管理和发布包自动配置。
- provider-specific 大量兼容、旧 CMS query 猜测和任意 fallback extension。

## 12. 测试方案

### 12.1 Unit

至少覆盖：

- 非 STRM。
- CD2 disabled、缺 token、缺 mapping、缺上下文。
- 确定性路径推导成功和失败。
- CD2 unavailable、connection refused、timeout、UNAVAILABLE、404/NOT_FOUND、500/内部错误。
- `FindFileByPath` 空结果、目录结果、负 size、invalid response。
- `GetDownloadUrlPath` 空 URL、invalid scheme、foreign host/port、未替换 placeholder、direct URL、external URL。
- CD2 success URL；若未来支持本地 source，再单独覆盖 local source，不把它与当前 CD2 实际返回混为一谈。
- CD2 fail → Mount；Mount fail → Native。
- Transcode protection。
- 原始 Item、MediaSource、PlaySessionId、MediaSourceId、subtitle/audio index、offset 和 report context 未被 Resolver 改写。

### 12.2 Fake CD2

当前真实控制 transport 是 gRPC，所以 fake 重点应是内存 gRPC stub 或本地 fake gRPC server：

- `FindFileByPath` 返回 found、directory、missing、NOT_FOUND、UNAVAILABLE、deadline exceeded、空消息。
- `GetDownloadUrlPath` 返回 valid download path、empty、foreign URL、direct URL、headers、expiresIn 和异常。
- `GetSubFiles` 仅在专门 refresh 测试中模拟 server-stream、迟延、未到 EOF、异常和 cancel。

返回的下载 URL 应指向 `127.0.0.1` 随机端口 fake HTTP server，覆盖：

- HEAD/GET 200。
- Range 206、无 Range、416。
- 404、500、timeout。
- 302/307 redirect。
- 不同 Content-Type 和 Content-Range。

`invalid JSON` 不属于当前 gRPC 查询 transport；如果未来另加 HTTP/JSON adapter，再增加 invalid JSON/empty JSON 测试，不能把它误写成当前 CD2 API 行为。

### 12.3 Resolver/PlaybackManager 集成

在现有隔离 runtime 中增加 CD2 fake 结果，不接本机真实 CD2：

1. DirectPlay STRM + CD2 URL hit，检查最终 `loadfile` source 是 URL。
2. DirectStream STRM + CD2 URL hit，确认 Transcode 保护仍生效。
3. CD2 fail + Mount hit，检查只替换 source。
4. CD2 fail + Mount fail，检查原始 native source。
5. Pause/Seek/Unpause/NextTrack/Stop 和报告链路保持现有 Session/PlaySession 语义。
6. 多次 Range/reconnect 不重复创建 Session，不改变 MediaSourceId，不丢字幕/音轨/offset。

### 12.4 Real CD2

允许的真实测试仅限：

- 已有实例的只读 RPC。
- 已有挂载中的单个样本。
- `HEAD` 和最小 Range 读取。

不依赖真实 CD2 作为自动测试环境，不执行 refresh、不接 Enhanced 实际播放、不修改配置/挂载/账号/缓存、不刷新整个媒体库。

## 13. 风险、Need user information 与下一任务

### Risks

1. Python gRPC native wheel 是 CPython 3.9 x86，和 Enhanced Node 16/Electron 18 x64 不兼容；直接复制依赖不可行。
2. proto source 1.0.13 与本机 runtime 1.0.15 存在版本漂移；当前基础 RPC 虽兼容，未来字段和 URL 行为不能盲信。
3. `GetDownloadUrlPath` 的 direct URL、headers、User-Agent 和 expiresIn 是可选字段；本轮 115 样本触发了 DirectUrl、User-Agent 和分钟级 expiresIn，但不能宣称全 provider 统一。
4. ETLP 的 refresh 是 server-stream + 多层父目录查询，可能把首次播放延迟扩大到秒级；本轮没有实测冷目录。
5. gateway 307、Range、nonce binding、URL cache 和 local fallback 共同组成数据面；把它们压缩成单个同步 URL 函数可能破坏 seek/reconnect 或 fallback。
6. 本机 ETLP 当前 mapping 对本轮 CD2 mount sample 未命中；在没有用户确认真实 server→local→cloud mapping 前，不能验收 CD2 hit。
7. 本机 CD2 配置显示 HTTPS enabled，但 19799 当前未监听；不要根据配置值直接选择 TLS transport。

### Sol High review

```text
Need Sol High review: completed
Result: `@grpc/grpc-js` 可行；115 DirectUrl 为 Level B，但专用 User-Agent 与分钟级有效期使其不进入 V1；异步接入必须增加 PlaybackManager/libmpv generation 防护。完整结论见第 15 节。
```

### Need user information

实现前仍需要用户确认或本机提供：

1. 一个专用于 Enhanced 的 API token，以及 token 在 Enhanced 中的存储方式；若 CD2 支持权限范围，则使用最小必要权限。token 不应通过聊天、Git 或日志传递。
2. 目标 Emby STRM 的脱敏路径形态和一条准确的 local prefix → CD2 cloud prefix mapping。当前运行配置的 mapping 对本轮样本没有命中。

### Recommended implementation task

待主线程审核后，下一任务应拆成：

1. 用户确认一条可命中的 mapping 和 token 处理方式。
2. 按第 15 节范围实现 main-process gRPC、单次 lookup、URL 校验和 generation 防护；PR #2 只接受 same-origin URL。
3. 不迁移 ETLP Python service、外置播放器、Session compensation、DirectUrl 或 refresh。
4. 先通过 fake gRPC/HTTP 和隔离 PlaybackManager runtime，再安排真实 CD2 只读 smoke，最后才讨论真实 Emby 播放。

本建议不代表已确认的产品决策，本轮停止于调研和设计。

## 14. 本轮执行记录

```text
Model Tier: 1
Model: GPT-5（当前 Codex 会话）
Escalated: no
Reason: research contract, scope and evidence boundaries were explicit; no product implementation was started
```

已执行：

- repo-local Git identity 设置为项目要求的 `hope140` 身份；未使用 `--global`。
- `git fetch origin`；Enhanced 当前 `main` 与 `origin/main` 同步，`7670d42` 存在。
- clone 并审计 ETLP beta 快照；未修改该研究副本后再写回项目源码。
- 读取 CD2 service、runtime version、config schema、mount metadata 和运行端口；没有修改任何 CD2 配置。
- 通过现有运行 ETLP 配置的 token 只在内存中完成真实只读 RPC 和一个媒体样本的 HEAD/Range 检查；未输出 token、URL、路径、账号或媒体名。
- ETLP beta 的 `tests.test_strm_media_path`、`tests.test_clouddrive2_client`、`tests.test_clouddrive2_gateway` 通过；测试使用 fake/stub，不依赖本机 CD2。

## 15. Sol High 架构评审结论

本节是上一轮调研的架构评审结果。验证继续使用一个现有 115 媒体样本，只读取本机既有 ETLP/CD2 token；没有输出或保存 token、完整 URL、query、媒体名、账号、Item 标识或私人路径，没有修改 CD2 配置、mount、缓存或网盘数据，也没有执行 refresh。

### 15.1 115 DirectUrl 真实验证

对同一文件分别调用 `GetDownloadUrlPath(get_direct_url=false)` 与 `GetDownloadUrlPath(get_direct_url=true)`：

| 字段 | `false` | `true` |
| --- | --- | --- |
| `downloadUrlPath` | present，string | present，string |
| `directUrl` | absent | present，string，HTTPS，provider/external host |
| `userAgent` | absent | present，string |
| `additionalHeaders` | map，0 项 | map，0 项 |
| `expiresIn` | absent | present，integer，分钟级 |

网络结果：

| Source / headers | HEAD | `GET Range: bytes=0-0` | Redirect | 最终 host |
| --- | --- | --- | --- | --- |
| CD2 same-origin URL | 200；`Accept-Ranges: bytes`；`Content-Length` present | 206；`Content-Range` present；`Content-Length=1` | 无 | CD2 origin |
| DirectUrl，不使用返回的 User-Agent | 403 | 403；交叉顺序复测仍为 403 | 无 | provider/external |
| DirectUrl，使用返回的 User-Agent | 403 | 206；交叉顺序复测两次均为 206；`Accept-Ranges: bytes` | 无 | provider/external |

因此该样本属于 **Level B**：DirectUrl 与 Range 可用，但必须使用 CD2 返回的 per-source User-Agent。HEAD 不是该 provider 的能力判据，实际单字节 Range 才能证明媒体读取成功。`additionalHeaders` 本次为空，不能由此推导未来 provider 或其他文件不返回额外 header。

分钟级 `expiresIn` 对首次立即播放通常足够，但不足以证明长时间播放安全。mpv 可能在长片后段、晚 seek、连接重建或长时间暂停后重新发起 HTTP 请求；此时旧直链可能过期。NextTrack 必须重新查询，不能复用上一集 URL。本轮没有等待真实过期，也不把“已打开连接”推断成整个播放周期都安全。

### 15.2 DirectUrl 的 libmpv 边界与 V1 决定

当前 `mpv-win32-x64.node` 对 `command` 消息逐项执行 `Var.AsString()` 后调用 `mpv_command`，因此不能从 JavaScript 直接把 `MPV_FORMAT_NODE_MAP` 作为 `loadfile` options 传入。当前 mpv 0.41 的 `loadfile <url> <flags> <index> <options>` 支持 file-local options，文件结束时会恢复旧值；理论上可用字符串参数传入 `user-agent` / `http-header-fields`。但这条 bridge 路径尚未对任意 header 的转义、逗号、冒号和敏感值做隔离 runtime 验收。

不能先设置全局 `user-agent`，发送 `loadfile` 后立即清理。`loadfile` 在实际文件开始加载前就可能返回，立即清理存在竞态；播放期间保留全局值又会污染 NextTrack、native 或 CD2 HTTP fallback。未来若启用 DirectUrl，应只使用 `loadfile` 的 file-local options，采用可复核的固定长度转义，并验证文件结束、Stop、错误、NextTrack 与 native fallback 后均无残留。任意 `additionalHeaders` 在完成结构化/转义和 bridge 实机测试前均判为 `directUrl unsafe`。

**V1 决定：DirectUrl 暂缓。** 虽然当前 115 样本满足 Level B 的 Range 能力，但专用 User-Agent、分钟级 URL 生命周期和尚未验收的 bridge file-local options 共同构成实际风险。PR #2 先使用已经真实验证的 CD2 same-origin HTTP URL。未来 capability check 只有同时满足 scheme、Range、header 可表达性、per-file 隔离和生命周期策略时，才允许自动优先 DirectUrl；不写 provider 特判。

参考：

- [mpv 0.41 `loadfile` command](https://github.com/mpv-player/mpv/blob/v0.41.0/DOCS/man/input.rst)
- [mpv network options](https://mpv.io/manual/stable/#network)

### 15.3 gRPC transport

推荐在 **Electron main process** 使用精确锁定的 `@grpc/grpc-js@1.14.4` 与 `@grpc/proto-loader@0.8.1`：

- 两者及已检查的依赖闭包均为 JavaScript，不需要 native addon、`node-gyp`、Python sidecar 或 ETLP 风格 localhost bridge。
- 当前包的 engine 分别为 Node `>=12.10.0` 与 `>=6`，满足 frozen Electron 18.3.15 / Node 16.13.2。
- 已用随包 Electron 的 Node 16.13.2、上述固定版本、repo proto 1.0.13 对本机 CD2 runtime 1.0.15 执行真实只读 smoke；Bearer metadata、unary RPC、1.5 秒 deadline 与 insecure localhost HTTP/2 均成功，进程未加载 `.node` runtime addon。
- renderer 的 `nodeIntegration=false`，且 token 不应进入 Web UI。main process 持有配置、token、channel 和 RPC call；preload 只暴露窄化的 request/cancel IPC，不暴露 token、stub 或任意 metadata。
- V1 origin 只接受 loopback。`http://127.0.0.1` / `http://localhost` 使用 `createInsecure()` 是本机明文 transport 的明确选择；HTTPS 使用 `createSsl()` 并保持证书校验。非 loopback 的明文 origin、内嵌用户名/密码、query 和 fragment 均拒绝，不能通过关闭 TLS 校验兼容。
- `grpc-web` 使用不同于原生 gRPC/HTTP2 的 wire protocol，通常需要 Envoy 或等价代理；当前 CD2 没有 gRPC-Web endpoint 证据，因此不采用。
- 直接用 Node `http2` + protobufjs 自行实现 gRPC framing、trailers、status、metadata、deadline 和 cancel 会复制成熟库能力，没有收益。

当前 `tools/build.ps1` 只复制 vendor runtime 与 `src/electronapp`，不会自动把根 `node_modules` 放进 frozen runtime。PR #2 必须显式把锁定后的纯 JS runtime dependency closure 放入 `electronapp/node_modules` 或产出等价 bundle，并在重复构建、安装包载荷和 frozen runtime smoke 中验证；不执行 native rebuild。

V1 可直接以 `@grpc/proto-loader` 运行时加载已提交的 `.proto`，不要求构建期生成正式 client。若后续改为 codegen，生成 JS 可以提交，但必须同时固定 generator 版本、proto SHA256、生成命令，并验证可重复输出。

参考：

- [grpc-node 纯 JavaScript 实现](https://github.com/grpc/grpc-node)
- [`@grpc/grpc-js` README](https://github.com/grpc/grpc-node/blob/master/packages/grpc-js/README.md)
- [gRPC-Web 官方说明](https://github.com/grpc/grpc-web)
- [gRPC-Web wire protocol](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md)

### 15.4 Proto 版本策略

repo proto 1.0.13 已真实兼容 runtime RPC 1.0.15 的 `GetRuntimeInfo`、`GetMountPoints`、`FindFileByPath` 和 `GetDownloadUrlPath`。protobuf binary wire format按 field number 解析；新增未知字段可被旧客户端忽略，前提是服务端没有复用或改变既有 field number/type，客户端也不把响应转成 JSON 后再回写。

建议在 PR #2 前优先取得官方、许可清楚且与 runtime 1.0.15 接近的 proto，并先做 descriptor/field-number diff；不能只为版本号一致而替换。若官方 1.0.15 proto 不可取得，允许固定当前 1.0.13 的文件与 SHA256，只调用已实测稳定的两个文件 RPC，验证必需字段存在，并把未知/缺失字段作为 capability miss 进入 fallback。升级 proto 应独立评审，禁止改动或复用既有 field number。

参考：[Protocol Buffers compatibility and unknown fields](https://protobuf.dev/programming-guides/proto3/#updating)

### 15.5 异步播放与 late-response 防护

当前 `libmpv.play()` 在等待 `core-playing` 的 Promise 内调用 `playInternal(options)`，但没有 await 或关联 `playInternal` 的 Promise。同步 Mount Resolver 不受影响；CD2 lookup 一旦异步化，旧调用可在 A→B、NextTrack、Stop 或 timeout fallback 后继续执行旧 `loadfile`。此外 `core-playing` 是实例级无 request id 事件，A 的监听器可能被 B 的开始事件错误满足；PlaybackManager 的旧 `player.play(streamInfo).then(...)` 也可能在 B 之后执行旧 `onPlaybackStarted`。

V1 使用一个单调递增的 **play generation id**，不需要复杂任务系统：

1. PlaybackManager 在每次新 Play/NextTrack/setCurrentPlaylistItem 进入播放器前生成 request id，并把它记录为该 player 的 current request；Stop 和 destroy 立即使其失效。
2. libmpv 在 `self.play()` 最开头同步递增 generation，创建本次 `AbortController`，并取消前一次 lookup/wait listener。generation 必须在任何 OSD、display、embed 或 RPC await 之前建立。
3. main-process IPC 另带唯一 request id；取消时调用 grpc-js `ClientUnaryCall.cancel()`，每个 RPC同时使用 absolute deadline。
4. 每个 await 后、Mount/native fallback 前、注册/处理 `core-playing` 时、最终 `loadfile` 前都检查 generation 与 PlaybackManager request id。旧结果只返回 `stale`，不允许调用 `loadfile`、设置 `currentSrc`、onPlaybackStarted 或触发播放错误恢复。
5. `core-playing` listener 必须按 generation 可撤销；B 开始、Stop、destroy 或 timeout 时移除 A 的 listener，不能让 B 的事件完成 A 的 Promise。
6. Timeout 后先标记本次 CD2 request terminal，再取消 RPC，并仅在 generation 仍为 current 时继续 Mount/native；late callback 即使到达也只能被丢弃。

这同时关闭四个场景：A 的 late response 不能覆盖 B；连续 NextTrack 只有最新 request 可 load；Stop 后旧 lookup 不能重启；timeout fallback 后 late gRPC 不能替换已经选择的 source。仅有 `AbortController` 或 deadline 不够，generation check 才是正确性边界。

### 15.6 Timeout、缓存与 mapping

建议 localhost V1 采用一个 **750ms absolute lookup budget**，不重试、不 refresh：

| 阶段 | 上限 |
| --- | --- |
| 初次 channel readiness / connect | 200ms；可与首个 RPC deadline 重叠 |
| `FindFileByPath` | 最多 350ms，包含连接时间 |
| `GetDownloadUrlPath` | 最多 300ms，且不得超过总 budget 剩余时间 |
| 总 lookup | 750ms，从 resolver request 创建起计算 |

client/channel 可在 main process 内复用；proto 只加载一次。任何 connection refused、deadline、UNAVAILABLE、鉴权、missing、目录、无效字段或 URL 校验失败都立即进入 Mount → Native，不做 retry。时间值应在 fake delay 与本机 frozen runtime 中测量后再微调，但不得退回 ETLP 的多层 refresh 秒级最坏路径。

URL 不持久缓存、不跨播放缓存，也不建立数据库。一次 generation 内只保留 lookup 结果到 `loadfile`；NextTrack、显式 replay 和错误后的新播放请求均重新查询。seek/reconnect 原则上由 mpv 对当前 URL 处理；这也是分钟级 DirectUrl 暂缓的原因。V1 不执行 refresh。

V1 mapping 结构为一个对象：

```text
localPrefix
cloudPrefix
```

Windows local path 先统一分隔符和 drive/UNC 形式，比较大小写不敏感；只有 path 等于 prefix 或下一字符为路径分隔符才命中，拒绝 `..` 穿越。cloud path 使用 `/`、保证前导 `/` 并做 POSIX normalize。V1 只有一条规则；如果未来扩展为多条，必须按规范化后最长 local prefix 优先，长度相同按配置顺序。禁止 regex、自动学习、目录扫描和 provider-specific mapping。

### 15.7 最终 source 优先级、缓存与 PR #2

长期 capability-based 架构保留以下形态：

```text
STRM DirectPlay / DirectStream
  ↓ mapping + gRPC lookup
safe DirectUrl?
  ├─ yes → Direct
  └─ no → safe CD2 same-origin HTTP?
             ├─ yes → CD2 HTTP
             └─ no → Mount → Native

Transcode → Native
```

当前 115 DirectUrl 因专用 User-Agent、分钟级过期和 bridge 未验收而判为 `direct unsafe`。因此 **PR #2 的实际 V1 优先级是 `CD2 same-origin HTTP → Mount → Native`**。任何 CD2 exception、timeout、invalid response、auth failure 或 mapping miss 都不得阻断原生 STRM。

Direct 模式的数据链为 `libmpv → provider`，绕过 CD2 的文件内容缓存。CD2 HTTP 模式为 `libmpv → CD2 → provider`，CD2 的既有内容缓存可能参与，但本轮没有读取命中率或修改设置，不能保证每个 Range 都命中磁盘；Enhanced 不实现自己的媒体缓存。

推荐 PR #2 只包含：main-process grpc-js transport 与窄 IPC、专用 token 的安全读取、单条 prefix mapping、proto 固定、`FindFileByPath + GetDownloadUrlPath(get_direct_url=false)`、same-origin URL 校验、750ms budget、generation/cancel/late-response 防护、CD2 → Mount → Native fallback、Transcode protection，以及 unit/fake gRPC+HTTP/frozen Electron/PlaybackManager 回归。排除 DirectUrl、refresh、provider 特判、设置 UI、复杂缓存、自动 mapping 和真实配置修改。

实现前仍需确认一条真实 Emby local prefix → CD2 cloud prefix mapping，以及 Enhanced token 的本地存储边界。token 应专用于 Enhanced；若 CD2 支持权限范围，则使用最小必要权限。

```text
Model Tier: 2
Model: GPT-5.6 Sol
Thinking: High
Escalated: yes, from the prior Tier 1 research because this review spans gRPC packaging, PlaybackManager/libmpv async lifecycle, HTTP header isolation and native fallback.
Recommended model for implementation: GPT-5.6 Sol High
```
