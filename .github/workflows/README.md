# 采集工作流

collect.yml 使用统一入口选择来源和任务规模。顺序执行能够确保名册先建立，再进行资料回填，也避免多个定时任务并发提交同一数据目录。

首次推送后手动运行 Collect atlas data，选择 smoke。all 用于全流程；minnano/javdb 可分别排查网络，male 单独跑固定姓名种子。确认后手动运行 daily，再设置仓库变量 ENABLE_SCHEDULE=true 开启每日 05:30（北京时间）的定时任务。

无第三方依赖，不执行 npm install。每次采集前先检查语法和运行离线测试；失败会停止并上传 collected-data 供检查，不提交失败产物。代码尚未推送时，不能据本地测试宣称 Actions 已验证。
