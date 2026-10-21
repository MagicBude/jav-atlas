# 采集工作流

collect.yml 使用统一入口选择来源和任务规模。顺序执行能够确保名册先建立，再进行资料回填，也避免多个定时任务并发提交同一数据目录。

首次推送后手动运行 Collect atlas data，选择 smoke。all 用于全流程；minnano/javdb 可分别排查网络，male 单独跑固定姓名种子。确认后手动运行 daily，再设置仓库变量 ENABLE_SCHEDULE=true 开启每日 05:30（北京时间）的定时任务。

无第三方依赖，不执行 npm install。每次采集前先检查语法和运行离线测试；失败会停止并上传 collected-data 供检查，不提交失败产物。代码尚未推送时，不能据本地测试宣称 Actions 已验证。

## 人物目录发现

手动选择 mode=daily、source=directory。directory_pages 是本轮所有五十音分组共享的页数预算，默认20，允许1至2000；smoke固定只读1页。每组按原始minnano ID合并，并保存独立检查点，重复触发可续跑。该来源不下载所有人物详细资料和头像，定时all也不隐式包含目录发现。

源站普通目录的深页存在约5000人边界，页面报告总数与可翻页范围不一致，因此directory采用公开五十音分组。partitionCompleted仅表示本轮计划中的分组已遍历；没有读音分类的人物可能缺失，仍需结合其他公开入口核查覆盖。
