# JAV Atlas

基于 minnano 与 JavDB 的演员资料采集与浏览项目，计划通过 GitHub Actions 自动更新，提供资料检索、多条件筛选和榜单浏览。

## 当前阶段：原版功能基线与注释整理

- tools/：迁自 javpaco-relay-main 的 10 个脚本，现已统一格式并补充中文 JSDoc，执行逻辑不变。
- .github/workflows/：4 个上游工作流，格式与注释已整理，触发和命令不变。
- relay/：数据输出目录，仅保留 .gitkeep，未复制任何旧 JSON 或头像。
- docs/：后续架构与流程文档。
- tests/：后续离线验证。
- web/：后续浏览界面。

本次仅整理代码格式及注释，不调整原版采集逻辑、路径或数据结构。使用 minnano ID 和 JavDB ID，暂不引入数据库及内部人物 ID。

阅读入口：[工具索引](tools/README.md)、[格式与注释约定](docs/code-style.md)。

## 后续工作

先适配无数据冷启动及修复已确认问题，再到 GitHub Actions 手动执行小规模采集，验证后开启定时任务，最后实现浏览界面。

**当前不是可直接运行的成品。** 原脚本部分依赖预置名册，且存在路径等问题；空数据目录下尚未跑通。原工作流包含定时触发，首次 push 前应在 GitHub 设置中暂时禁用 Actions，适配后再启用。

验证：原版脚本 Node 语法检查通过；本地 minnano 请求失败，未完成端到端验证。pending user acceptance。

来源目录未提供 LICENSE，本次不自行附加开源许可证。
