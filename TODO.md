# 待办

- [x] 原归档哈希、解包、源码与 vendor 划分。
- [x] 项目知识库与当前状态。
- [x] 构建 portable runtime、复核输入文件。
- [x] 编译 setup.exe、解包并核对载荷。
- [x] 隔离 Electron Web UI 启动、播放器注册检查。
- [x] 播放链、Session/远控静态审计。
- [x] 禁用外置入口、添加容错诊断及测试。
- [x] Windows host 启动，以及可见窗口中的独立内嵌播放器合成媒体测试（分层验证）。
- [x] 执行授权独立目录 setup 安装、快捷方式启动、0.1.0→0.1.1 覆盖升级与卸载测试。
- [x] 真实 STRM 两集播放与 Item/MediaSource/PlaySession 验证；普通文件库内无样本，保留本地验证。
- [x] 真实服务器 Pause / Resume / Seek / Stop / Next 验收；WatchTogether 按用户确认的后台控制口径通过。
- [x] 配置加载规则、playing 属性及真实 gpu-next/d3d11va 硬解验证；HDR/画质效果样本未覆盖。
- [x] 查明缓存整数回传截断，修复精确诊断并验证 5 档容量；确认 Windows Known Folder 与 MPV_HOME 配置路径机制。
- [x] 本地 PlaybackManager → libmpv、播放报告和远控消息分派 fixture 集成验证，包含 NextTrack。
- [ ] 核对来源未明的 Web 资源和精确 native bridge 构建来源。
- [ ] 用户授权后初始化 Git 并按小范围提交。

第一轮按当前用户确认口径关闭。后续 Mount、CD2 和自动映射需另行确认范围，尚未进入实现。
