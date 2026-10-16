"""配对补偿作业的入口：重扫近期到访，把漏掉的成绩补上。

用法（容器内，工作目录 /srv）：

    python /srv/jobs/reconcile_efforts.py

退出码 0 表示成功、1 表示失败；每次运行都会写一行 job_runs，
所以"上次成功/失败是什么时候"可以直接查库回答。
"""
import json
import logging
import pathlib
import sys

# 直接 `python /srv/jobs/xxx.py` 时 sys.path[0] 是 /srv/jobs，导不到 app 包；
# 生产入口就是这么调的，所以在脚本里显式把 /srv 放进 sys.path。
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.maintenance import reconcile_recent_efforts, run_job

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = run_job("reconcile_efforts", reconcile_recent_efforts)
    # 输出成 JSON：日志里能直接 grep 到 ok / failures，也方便运维脚本解析。
    logging.warning("[v3-jobs] reconcile_efforts → %s", json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 1)
