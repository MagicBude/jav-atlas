# 使用 GitHub 项目网址

网站使用 GitHub Pages 托管，采集继续由 Collect atlas data 执行，两者可以共存。

## 首次开启

1. 打开仓库 Settings → Pages。
2. 在 Build and deployment 下，将 Source 选择为 GitHub Actions，无需配置域名或 gh-pages 分支。
3. 打开 Actions → Deploy atlas Pages → Run workflow，选择 main 后运行。
4. 等待 build 和 deploy 均成功，点击部署记录中的网址。

本仓库的预期项目网址为 https://magicbude.github.io/jav-atlas/ ，首次部署成功后才可访问。页面使用哈希路由，例如 `/jav-atlas/#/rankings`，可直接刷新。

## 后续更新

- main 上的前端或采集数据更新会触发部署。
- Collect atlas data 成功结束后也会触发部署，构建读取 main 最新数据。这样可以处理采集机器人提交不触发普通 push 工作流的情况。
- 采集失败时不会通过完成事件发布；线上保留最近成功部署的网站。
- 手动重建网站只运行 Deploy atlas Pages，不会启动采集。
- Check atlas web 仍用于独立检查和预览产物，不负责发布。

线上网站无需本地 pull 即可更新；本地开发目录仍需运行同步更新命令。收藏和个人编辑按浏览器、站点地址分别保存，本地开发地址的数据不会自动出现在 GitHub Pages，请从数据页导出备份后在正式站点导入。
