# 外置播放器禁用审计

第一轮只禁用入口，保留原实现。与外部字幕、网页链接和 Emby Remote Control 相关的 shared 能力不在禁用范围。

| 位置 | 用途 | 第一轮处理 |
|---|---|---|
| www/app.js，原约 2102 行 | Electron 初始化注册 externalplayer/plugin | 注册条件固定禁用 |
| www/modules/externalplayer/plugin.js | 读取 externalplayers 设置、选择播放器、play 调 shell.exec、设置路由 | 构造函数最前提供禁用接口并返回；旧实现留在后面 |
| externalplayer.html / externalplayers.html 及控制器 | 编辑路径、参数、媒体类型 | 不再由插件注册设置路由；文件保留 |
| electronapp/shell.js | canExec、exec、close 的平台协议适配 | 保留 shared shell，未全局封锁 |
| main.js 的 mpvPosEvent / named pipe | Carnival 外置 MPV 进度辅助 | 暂留，不随外置插件自动触发 |
| external/、vendor 中相关 BAT | 旧打包与播放器辅助资源 | 保留审计，Enhanced 入口不调用 |
| PlaybackManager 与 embedded libmpv | 播放队列、source、字幕、事件 | 保留原有行为 |

防护分两层：取消自动注册；即使直接加载旧插件模块，也只能返回 canPlayMediaType=false、canPlayItem=false、空设置路由，play 返回拒绝且不启动进程。既有 externalplayers 值不会被删除。

自动测试已验证禁用模块不读取历史配置、不执行 shell.exec。隔离启动的实际 pluginManager 列表中没有 externalplayer，存在 libmpvmediaplayer 和 remoteplayer。尚未验证所有普通视频最终均选中 libmpv，也没有进行真实客户端配置迁移。

后续只有在真实播放和控制验收关闭后，才讨论删除 legacy 实现；当前不以删除代码作为完成条件。
