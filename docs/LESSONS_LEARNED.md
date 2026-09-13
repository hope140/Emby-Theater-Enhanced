# 已确认经验

1. 本地 SFX 可直接解包为 1009 个文件，未发现加密条目；无须逆向安装器。
2. `electronapp/package.json` 声明 Electron ^9.4.0，但本地 `x64/electron/electron.exe` 文件版本是 18.3.15。运行时版本需要实测，不可从开发依赖推断。
3. 原 `libmpv.js` 在播放时根据 appSettings 设置 hwdec、vo、demuxer-max-bytes 等；mpv.conf 中对应设置可能随后被覆盖。
4. 原桥接 getProperty 在无回复时不会结束；新增诊断必须有超时并移除监听器，不能阻塞播放。
5. Windows 自带 tar 不能解压本包所声明的字典大小；固定 node-unrar-js 2.0.2 解包成功。
6. 隐藏窗口的合成播放器测试未收到 ready；可见窗口能收到 ready/playing 并通过 5 项动作。测试没有画面时不能仅靠延长隐藏窗口等待宣称播放正常。
7. 未登录情况下直接调用已经注册到 PlaybackManager 的插件会触发需要服务器 API client 的回调。合成单元级播放测试应实例化独立插件；真实 Session 测试必须有服务器上下文。
8. Windows native mpv 通过 Known Folder 获取默认配置目录；只改 APPDATA 不会改变该路径。已验证子进程 MPV_HOME 能加载独立配置标记，正式用户配置不需要修改。
9. 900/2048/3072/4096/8192MiB 同 handle 实验确认 native 属性正确、bridge 的数值回传截断到 int32。0.1.1 使用 mpv 文本快照取得准确值，不能用负数加 2^32 的方法修正任意容量。
10. 本地 PlaybackManager fixture 需要提供完整 endpoint 能力；将 HTTP 源错误标为不受支持的 remote 会走 DirectStream 并请求错误的模拟 URL。修正 fixture 后 DirectPlay、消息分派与上报集成通过；未改变产品能力判断。
11. GitHub 上显示 GPL-2.0 的仓库及其 GPL v2 文本本身不足以证明 “or later”；只有明确的版权/许可通知才能扩大该授权。公开派生维护层应保守使用 GPL-2.0-only，并将来源未确认资产留在版本控制之外。
12. 播放与 Session 的当前验收状态必须集中以 `LIVE_ACCEPTANCE.md` 为准；静态审计文档只能描述其证据边界，不能保留与真实验收冲突的旧结论。
13. Alameda 为 `file://` 模块加载相对依赖时不会可靠地为带协议的模块 ID 补 `.js`；新增相对 AMD 依赖应显式写扩展名，并用隔离 runtime 验证实际插件注册。
14. renderer 侧现有安全边界只通过 preload 暴露 `window.fs`，Mount 检查应使用同步 `existsSync` 和有限路径规则，不应引入服务器请求、递归扫描或不确定映射。
15. `embedded.play` 收到的 `options.url` 必须继续是 PlaybackManager 形成的 native source；验证换源结果应检查插件的 `currentSrc` 或最终 `loadfile`，不能把原始播放上下文误当成已替换 source。
16. Electron runtime 夹具必须串行启动并单独核对进程；UI 启动超时、插件加载失败和实际媒体播放失败要分别记录，不能用其中一项替代另外两项证据。
