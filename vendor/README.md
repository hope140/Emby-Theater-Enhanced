# Vendor 输入

`runtime-manifest.json` 记录 1009 个 Carnival 文件、51 个补丁文件、两个归档及关键二进制的来源、角色、版本、SHA256 和维护状态。

原归档保留在项目根目录，解包内容位于 `vendor/carnival/`、`vendor/patch/`，均被 .gitignore 排除。不得编辑这些目录。`tools/prepare.ps1` 验证原归档后提取；`tools/build.ps1` 每次验证全部 vendor 文件。

`src/electronapp/` 保存可编辑应用与 Web 资源；它覆盖 vendor 中同名文件。libmpv 从综合补丁的 `payload/libmpv/mpv-1.dll` 单独选取。综合补丁的 mpv.conf、字体和 shader 作为参考输入保留，不自动写入个人配置。

分类 A 表示与官方参考逐字节相同；B 表示可辨识的明文定制/差异，但并不自动证明每行修改者；C 是第三方依赖；D 是 native/managed binary；E 是暂不能确认精确上游来源。完整分类和证据在 [审计文档](../docs/CARNIVAL_BASELINE.md)。

源码可用不等于精确二进制可复现。当前构建是已锁定 vendor 的可重复组装，尚不是全部 native binary 从源码构建。保留随包许可证；各组件再分发条件及 E 类来源没有全面核验，当前产物用于本地开发验收。
