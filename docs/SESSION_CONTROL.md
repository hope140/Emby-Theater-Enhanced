# Session 与远程控制审计

当前代码沿用 Emby Web 的认证、API client、WebSocket、PlaybackManager 与播放器事件。第一轮未重写这些生命周期。

## 身份和会话

`electronapp/main.js` 的 loadStartInfo 构造 app name/version、deviceName/deviceId 与插件列表，apphost 提供给 Web 层。ApiClient 使用这些身份及用户认证访问服务器；Session 由服务器识别客户端活动创建/维护，不能将客户端获取 PlaybackInfo 等同于本地自己创建服务器 Session。

`www/modules/emby-apiclient/apiclient.js` 的 capabilities 上报路径是 `Sessions/Capabilities`（约 1932 行）；WebSocket 携带同一客户端身份。PlaySessionId 来自 PlaybackInfo 响应，是一次播放的上下文标识，与 Session.Id 不同。

## 播放上报

`playbackmanager.js` 的 reportPlayback（约 40 行）从当前播放状态组织 ItemId、PositionTicks、PlaySessionId、MediaSourceId、暂停状态、队列和流索引。`onPlaybackStarted`（约 1382 行）启动上报及进度定时器。

| API client 方法 | 请求 |
|---|---|
| reportPlaybackStart，约 3181 行 | POST Sessions/Playing |
| reportPlaybackProgress，约 3196 行 | POST Sessions/Playing/Progress |
| reportPlaybackStopped，约 3292 行 | POST Sessions/Playing/Stopped |

综合补丁在开始和进度上报时调用 ensureWebSocket。已有定时进度节流与异常吞掉行为被保留；网络/API 问题必须从真实验收确认，不能只看函数存在。

## 控制下行

`www/modules/common/input/api.js` 为压缩单行模块，处理 API client 的 message 事件。Play 请求进入 playbackManager.play；Playstate 分派如下。

| 服务端命令 | Web 输入 | 内嵌播放器 |
|---|---|---|
| Pause | inputmanager.trigger('pause') | setProperty({pause:true}) |
| Unpause | inputmanager.trigger('play') | setProperty({pause:false}) |
| Seek | playbackManager.seek(SeekPositionTicks) | 转为毫秒，再发 mpv seek 秒值 |
| Stop | inputmanager.trigger('stop') | sendCommand('stop') + stopped 事件 |
| NextTrack | inputmanager.trigger('next') | 原播放队列切换后再播放 |

GeneralCommand 同样经该模块进入命令分派，DisplayMessage 进入 toast/alert。Remote Control 插件是控制其他 Emby 客户端的原生能力，应保留，不能因为它含 remote 字样与外置进程播放器一并禁用。

## 状态上行

`plugins/libmpv.js` 的 message(recv) 处理 property_change：time-pos 转 ticks → _onTimeUpdate；pause → _onPlayPause；eof-reached → _onStopped；volume/mute/duration 同步 playerState。相应 events 由 PlaybackManager 监听并汇总为状态和进度。

EmbyWatchTogether 兼容性的必要条件是身份、Item、PlaySession、WebSocket、Pause/Seek/Stop 与 PositionTicks 连续一致。Resolver 仅替换交给内嵌播放器的 source，不创建第二播放器、不自行伪造上报或 Session。2026-09-13 的真实验收已证明后台控制链正常；双客户端同步精度尚未测试，当前状态以 `docs/LIVE_ACCEPTANCE.md` 为准。

## 待验收

0.1.1 已新增客户端集成验证：真实 PlaybackManager 与 ApiClient 报告序列化处理普通视频和 STRM fixture，真实 input/api.js 消息分派触发 Pause/Unpause/Seek/Stop/NextTrack。报告保留 ItemId、MediaSourceId、PlaySessionId，开始/进度/结束均存在，Next 正常换项。API 回应、报告递送和消息投递均为内存 fixture，因此不将该结果写成真实服务器 Session 或真实 WebSocket 已通过。

2026-09-13 已完成真实非管理员账号验收：两集 STRM 的开始/进度/停止请求成功，Pause/Seek/Unpause/NextTrack/Stop 经真实服务器和 WebSocket 到达，客户端及服务器状态正确。每项 MediaSourceId、PlaySessionId 关联一致。用户确认全库 STRM、WatchTogether 只要求后台控制正常，本轮按此口径通过；不声称双端同步精度已测试。详见 LIVE_ACCEPTANCE.md。
