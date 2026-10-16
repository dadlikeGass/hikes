"""坐标清理作业的入口：到访满 30 天后清空原始坐标与精度。

用法（容器内，工作目录 /srv）：

    python /srv/jobs/purge_visit_coordinates.py

只清原始坐标，保留"这次定位校验通过了"这个结论（evidence_level）。
每次运行写一行 job_runs。
"""
import json
import logging
import pathlib
import sys

# 同 reconcile_efforts：直接按路径执行时要自己把 /srv 放进 sys.path。
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.maintenance import purge_visit_coordinates, run_job

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = run_job("purge_visit_coordinates", purge_visit_coordinates)
    logging.warning("[v3-jobs] purge_visit_coordinates → %s",
                    json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 1)
