# STRM 智能解析设置

本页记录 `feat/strm-resolver-settings` 已实现的设置、持久化和解析规则契约。实现运行在当前 Windows frozen Electron / embedded libmpv runtime 中，仍遵守 `Resolver changes source only`。

## 配置文件与 secret boundary

Electron main process 在应用 `userData` 下维护：

```text
%APPDATA%\EmbyTheaterEnhanced\config\strm-resolver.json
%APPDATA%\EmbyTheaterEnhanced\config\strm-resolver-secrets.json
```

配置文件是 schema version `1` 的 authoritative source。secret 文件只保存 CloudDrive2 token，renderer 只会从 `enhanced-strm-config-get` 得到 `tokenConfigured: true/false`，不会得到旧 token。设置新 token、清除 token 和读取设置均通过受信任的 main-process IPC handler 完成。

以下内容不会进入 renderer 返回值、resolver 日志或 acceptance evidence：

- token、Bearer metadata、raw gRPC client 和 authorization header；
- DirectUrl query、完整敏感 URL 和用户凭据；
- secret 文件中的原始内容。

设置保存会立即写入文件，但当前 CD2 service 生命周期不做 hot reload。页面会提示重启后播放链生效；重启时由持久化配置重新创建 service。

## Schema

公开配置语义如下，`tokenConfigured` 是运行时派生字段，不会写入配置文件：

```json
{
  "version": 1,
  "enabled": true,
  "cd2": {
    "enabled": true,
    "origin": "http://127.0.0.1:19798",
    "tokenConfigured": true,
    "directUrlEnabled": true
  },
  "rules": [
    {
      "id": "rule-main",
      "sourcePrefix": "/media/115",
      "mountPrefix": "X:\\115",
      "cloudPrefix": "/115",
      "storageType": "cloud-mount",
      "strategy": "cloud-first",
      "order": ["direct-url", "cd2-http", "mount", "native"],
      "originState": "USER",
      "enabled": true
    }
  ]
}
```

`sourcePrefix`、`mountPrefix` 和 `cloudPrefix` 是三个不同的 identity。`mountPrefix`、`cloudPrefix` 可以为空，允许保存只具备部分确定事实的规则；`sourcePrefix` 必须是绝对 Windows/UNC/POSIX 路径。规则校验拒绝相对路径、`.`、`..`、重复 id、重复自定义 stage 和缺少 `native` 的自定义顺序。

`storageType` 当前为 `local-nas` 或 `cloud-mount`。`strategy` 当前为 `cloud-first`、`mount-first` 或 `custom`。`order` 始终是四个 stage 的完整数组，便于未来扩展完整排序；当前 UI 对自定义顺序使用四个可键盘操作的顺位选择框。

## 最长前缀匹配

播放前先在启用的规则中选择与 `MediaSource.Path` 匹配的最长 `sourcePrefix`；当 source path 不是可识别的绝对路径时，再用 `Item.Path` sidecar identity 作为匹配输入。规则执行严格目录边界：

```text
/media/115       匹配 /media/115/Movies/Dune.mkv
/media/115       不匹配 /media/1150/Dune.mkv
/media/115/4K    覆盖 /media/115
```

Windows drive 和 UNC 比较大小写不敏感，POSIX 比较大小写敏感。路径替换保留 suffix，并按目标路径类型使用分隔符。Windows client 不会对 server-side absolute POSIX candidate 直接调用本地 `existsSync`。

## 策略顺序

规则命中后按 `order` 执行：

| 策略 | 实际顺序 |
|---|---|
| `cloud-first` | `DirectUrl → CD2 HTTP → Mount → Native` |
| `mount-first` | `Mount → DirectUrl → CD2 HTTP → Native` |
| `custom` | 使用规则自身的 `order` |

`DirectUrl` 与 `CD2 HTTP` 共享一个 main-process service。renderer 通过窄请求模式区分 `direct` 和 `same-origin`，不会复制两套 gRPC service。一次规则解析的 CD2 stages 共享 750ms absolute deadline；`FindFileByPath` 结果在 direct/same-origin 连续尝试间复用。DirectUrl 继续沿用已验证的 file-local User-Agent、expiry safety、additional headers fail-closed 和 Native fallback。

以下输入仍保持原有行为：

- non-STRM 直接使用 native source；
- Transcode 直接使用 native source；
- Abort 或 superseded 终止请求，不进入 fallback；
- 普通 resolver miss 继续走 Native；
- PlaybackManager、Session、PlaySessionId、WebSocket、报告和 embedded libmpv ownership 不被设置层绕过。

## AUTO / USER / DISABLED

- `AUTO` 只能由 legacy bootstrap 或确定性的 discovery suggestion 产生。自动更新只能改 `AUTO`。
- 用户新建规则，或保存时修改 `AUTO` 的任意映射、策略、顺序或 enabled 字段后，规则变为 `USER`。之后 discovery 不得覆盖。
- 用户禁用/删除自动规则后保留 `DISABLED` tombstone 和 mapping suppression。相同 mapping 的后续 discovery 不会重新创建。
- `USER` 或 `DISABLED` 只有用户主动点击“恢复自动配置”才转为 `AUTO`，不会隐式恢复。

当前实现提供可测试的 `applyDiscovery` store contract，但不做全盘扫描、递归猜测或 provider 特判。信息不足时只允许保存 source-only 的待完善规则，不能伪造 mount/cloud mapping。

## Legacy env migration

首次没有 persistent config 时，读取已有：

```text
ETE_CD2_ENABLED
ETE_CD2_ORIGIN
ETE_CD2_TOKEN
ETE_CD2_LOCAL_PREFIX
ETE_CD2_CLOUD_PREFIX
ETE_CD2_DIRECT_URL
```

有效值会 bootstrap 为 `AUTO` rule，并将 token 写入 main-process-only secret 文件。bootstrap 后 persistent config 优先级为：

```text
USER persistent config
> AUTO persistent config
> legacy env bootstrap
> defaults
```

legacy env 不会在每次启动覆盖 USER 配置；main 启动完成 bootstrap 后会清除 CD2 legacy env，避免 token 继承到 renderer。test-only runtime harness 如需复现旧环境，会显式注入隔离的 synthetic env，不改变产品 precedence。

## Settings route and IPC

`libmpv.getRoutes()` 在 `Playback` category 注册：

```text
path: mpvplayer/strm.html
controller: mpvplayer/strm.js
title: STRM 智能解析
```

页面沿用现有 Emby settings view、`emby-input`、`emby-select`、`emby-checkbox` 和 `emby-button`，提供 CloudDrive2 连接测试、路径规则测试、添加规则、恢复自动配置和禁用规则。动态路径只写入 input value/textContent，不通过 HTML 字符串拼接。

当前 main-process channels：

```text
enhanced-strm-config-get
enhanced-strm-config-save
enhanced-strm-token-set
enhanced-strm-token-clear
enhanced-strm-cd2-test-connection
enhanced-strm-rule-test
enhanced-strm-rule-restore-auto
enhanced-strm-rule-disable
```

所有 handler 都校验当前 `BrowserWindow.webContents`。连接测试只返回 `ok`、`auth_failed`、`connection_failed` 或 `incomplete` 等安全枚举；规则测试只返回映射状态和挂载存在性，不启动播放。

## Verification boundary

本分支已用 Node unit/targeted tests 覆盖 config store、secret redaction、IPC trust boundary、legacy bootstrap、rule validation、path semantics、longest prefix、AUTO/USER/DISABLED、strategy order、mount replacement、CD2 direct/same-origin、Native fallback 和 Abort。

当前 synthetic frozen runtime 已覆盖 persistent config bootstrap 后的 DirectUrl/CD2 fake pipeline、CD2 miss fallback、PlaybackManager/Session/controls/reporting/cleanup。真实 settings page 手工 native-window automation 和真实服务器 cloud-first/mount-first playback 不在本轮可宣称范围内。
