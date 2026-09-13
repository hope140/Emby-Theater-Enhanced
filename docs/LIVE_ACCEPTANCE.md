# 第一轮真实运行验收

日期：2026-09-13（UTC+8）；产品版本：0.1.1。

用户已自行登录，账号非管理员。用户允许使用库内任意影视，并说明全库均为 STRM；WatchTogether 本轮以后台控制正常为验收标准，不要求额外双客户端测试。

## 实际结果

选择两个不同的 STRM 样本（STRM Sample A、STRM Sample B）。两项均 Item.Path 以 .strm 结尾、单 MediaSource。通过现有 PlaybackManager 调用内嵌 libmpv，播放方式为原生 DirectStream。样本名称、内部 ItemId、MediaSourceId 和 PlaySessionId 不进入公开仓库。

| 检查 | 结果 |
|---|---|
| 账号与 Session | 非管理员；自己的 Session 可见；SupportsRemoteControl=true；WebSocket 已连接 |
| 播放与进度 | 客户端进度推进，服务器显示正确 Item 与对应进度 |
| Pause | 服务端 POST 接受，真实 WebSocket Playstate 到达；客户端与服务器均暂停 |
| Seek | 后台跳转至 60 秒；客户端、服务器 PositionTicks 均为 600000000 |
| Unpause | 后台恢复，客户端继续推进到 62 秒以上 |
| NextTrack | Sample A 停止、Sample B 开始，换为新的 PlaySessionId |
| Stop | 服务端接受、WebSocket 到达、客户端停止；服务端 NowPlayingItem 清空 |
| 上报一致性 | 两个不同 Item 各对应一个 MediaSource 和 PlaySession；真实开始/过程/停止请求全部成功 |
| 画面与 native 属性 | 实际查看动画画面；gpu-next 输出、d3d11va 硬解，缓存字节值 3221225472 |

完整控制测试包含 10 条实际发送的播放报告，全部接受。另一次约 20 秒画面检查完成后通过服务器 Stop 停止。测试没有修改服务端配置、权限或媒体文件；正常播放会留下样本观看进度，未额外回写重置。原始证据文件仅保存在本地忽略目录。

## 工具与证据边界

`tools/accept-live.ps1 -AuthorizedLivePlayback` 启动项目专用验收入口，复用现有 Enhanced profile，不复制凭据、不启动调试监听端口。使用真实 ApiClient 发送控制到服务器自己的 Session，观察真实 WebSocket 消息、播放器状态和 Sessions 回读。上报观察位于 ajax 层，仅记录实际发送请求的白名单字段，不替换传输、不模拟结果。

验收启动入口加载相同产品 main.js 和资源；不经过 .NET host 的本轮播放测试与此前 Windows host/安装启动验证分别记录。普通启动方式在测试后恢复。

初次脚本使用 npm 包名 `emby-theater-enhanced`，登录时 token 对应产品名称 `Emby Theater Enhanced`，导致可远控的 WebSocket Session 与 HTTP Session 不一致。把验收入口 app name 修正为 productName 后，账号无需权限变化，完整远控通过。没有因此修改产品能力声明或服务器设置。

## 结论

第一轮运行验收按用户更新口径通过。普通文件因全库 STRM 无实服样本，保留本地/模拟证据；HDR、大码率长时间稳定性、所有编码、插件双端同步精度不在这两个样本的证明范围。本验收阶段当时尚未执行 Git 提交或发布；后续公开基线状态以 `PROJECT_STATUS.md` 为准。当前产品构建与安装包无需重新生成。
