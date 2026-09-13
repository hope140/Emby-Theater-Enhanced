# 构建与打包

## 公开基线限制

`v0.1.1-baseline` 是用于源码治理和审计的公开基线，并非独立可构建的发行源码包。公开仓库刻意不包含完整离线 Web snapshot、冻结 Electron/runtime、native binary、Carnival 输入或综合补丁输入；本地构建仍需要这些已锁定但未公开的输入。缺少这些内容时，`prepare.ps1` 或 `build.ps1` 不能完成是预期行为，不应视为公开仓库缺陷。

在逐项确认来源、再分发许可和 GPL 对应源码义务前，不发布 setup.exe 或其他二进制产物。

## 已实际使用的工具

- Windows PowerShell 5.1 执行所有 ps1，脚本内容保持 ASCII；读取含中文的 JSON 显式 UTF8。
- 本地开发 Node + 固定 `node-unrar-js 2.0.2`，根 package-lock.json 锁定。
- Inno Setup 6.7.3。官方安装 EXE Authenticode 验证有效，签名者 Pyrsys B.V.；只用项目内 innounp 解包，没有安装或修改系统 PATH。
- Python 仅用于可选 DLL 身份 probe，无 pip 新依赖。

工具来源及哈希见 `vendor/toolchain-manifest.json`。构建不自动下载工具；`package.ps1 -Compiler` 支持用户已安装或自行准备的 ISCC.exe。

## 两阶段

```powershell
npm ci --ignore-scripts
powershell -NoProfile -ExecutionPolicy Bypass -File tools/prepare.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1
```

prepare 核对两个输入归档的 SHA256，解包到 vendor。build 核对 manifest 中每个 vendor 文件 → 复制原目录 → 用 src/electronapp 覆盖应用层 → 替换指定 libmpv → 写 Enhanced package 元数据、独立 ProgramDataPath、启动入口与 build-manifest。mpv.conf、shader、字体不写入个人目录。

保留实际布局 `Emby.Theater.exe`、`electronapp/libmpv/x64`、`x64/electron`。任务书中的 runtime/libmpv/plugins 分拆仅是示意；现有宿主和 Pepper 注册依赖相对路径，首期迁移目录会增加无关风险。

package 校验 build-manifest 中的全部载荷及额外文件，调用 Inno 编译到 `dist/EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe`。当前 runtime 为 `dist/EmbyTheaterEnhanced-0.1.1-final-win-x64`，传 `-RuntimeName` 选择。安装目标独立于 Carnival，安装器保留稳定 AppId；显式可选桌面快捷方式，开始菜单入口使用 Start-Enhanced.ps1。卸载不删除个人 mpv 配置和 Enhanced 用户数据。

## 可重复性

第一轮两次分别构建到不同输出目录，1013 个文件（含 build-manifest）SHA256 全部相同。这里的可重复是 runtime 载荷一致，未声称 setup.exe 位级确定性或 native binary 源码重建。

build 拒绝覆盖已有目录；重复构建使用 `-OutputName`。package 同样拒绝覆盖已有 setup。旧产物应由用户保留或在明确范围内处理，脚本不执行递归删除。

0.1.1 安装包已用 innounp 解包，build-manifest 中 1012 个载荷文件哈希全部一致。随后在用户授权独立目录实际安装 0.1.0、覆盖升级 0.1.1，每次均验证全部载荷与安装记录；快捷方式实际启动成功，卸载后目录、安装记录、桌面/开始菜单快捷方式均移除。保留 Enhanced profile 与个人 mpv 配置。当前提权环境未覆盖 UAC 提示交互或 Program Files ACL。

## 启动与配置

Portable 用 `Start-Enhanced.cmd`；安装后的快捷方式调用同一 PS 启动器。首次启动仅在 `%APPDATA%\EmbyTheaterEnhanced` 下创建缺失的 system.xml 和 CEC cancel 标记，保留基线的自动更新关闭设置，避免 legacy host 发起驱动安装。原 Windows host 接着启动 Electron。直接运行 Emby.Theater.exe 可能绕过这一步初始化，首选包装入口。

第一轮已运行 frozen Electron 加载输出目录 main.js；另用 `tools/test-host.ps1` 在唯一测试副本中将 ProgramDataPath 指向测试目录，实际启动 Emby.Theater.exe，10 秒后原 host 存活、4 个 Electron 子进程存在、诊断日志已生成。测试只停止该副本内的进程。此测试证明原 Windows host 可启动输出应用，不能替代完整 installer/升级验收。

Electron profile 已隔离；0.1.1 的媒体测试显式设置子进程 MPV_HOME，并已验证 native 读取独立配置。正式用户启动不设置 MPV_HOME、不修改个人配置。详见 LIBMPV_RUNTIME。
