"""V3 验收 drill 的公共工具。

三条硬规则（计划第 7 节）：

1. 只连隔离环境：V3_TEST_BASE_URL 必须是本机回环地址；数据库只通过
   docker compose -f server/docker-compose.v3-test.yml 的 db 容器访问，
   所以本地开发库（8000/5432）不会被测试写脏。
2. 每个 drill 用自己的唯一前缀造数据，tearDownClass 必须清干净，失败也清。
3. 断言要能回答"数据库里到底发生了什么"，不能只看 HTTP 200。
"""
from __future__ import annotations

import os
import subprocess
import time
import uuid

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COMPOSE_FILE = os.path.join(REPO_ROOT, "server", "docker-compose.v3-test.yml")
TEST_PROJECT = os.environ.get("V3_TEST_PROJECT", "hikes-v3test")
DEFAULT_BASE_URL = "http://127.0.0.1:18000"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
PASSWORD = "V3DrillPassw0rd!2026"


def base_url() -> str:
    raw = os.environ.get("V3_TEST_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    url = httpx.URL(raw)
    if url.host not in LOOPBACK_HOSTS:
        raise RuntimeError(
            "V3 drill 只允许连本机回环地址，拒绝 " + raw +
            "；测试环境见 server/tests/README.md")
    return raw


# ==================== 数据库核对（只走隔离项目） ====================

def compose(*args: str, capture_stdin: str | None = None, combine: bool = False) -> str:
    cmd = ["docker", "compose", "-f", COMPOSE_FILE, *args]
    proc = subprocess.run(cmd, input=capture_stdin, capture_output=True,
                          text=True, cwd=REPO_ROOT)
    if proc.returncode != 0:
        raise RuntimeError("命令失败：" + " ".join(cmd) + "\n" + proc.stderr.strip())
    # 作业脚本把结果打在 stderr（logging），要一起看才看得到台账输出。
    return proc.stdout + proc.stderr if combine else proc.stdout


def psql(script: str, database: str = "hikes") -> str:
    """在隔离项目的 db 容器里执行 SQL，返回 psql 的表格输出。"""
    return compose("exec", "-T", "db", "psql", "-q", "-tA", "-F", "|",
                   "-v", "ON_ERROR_STOP=1", "-U", "hikes", "-d", database,
                   "-f", "-", capture_stdin=script)


def psql_may_fail(script: str, database: str = "hikes") -> tuple:
    """执行会故意违反约束的 SQL，返回 (返回码, stderr)；用于证明约束真的在拦。"""
    proc = subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "exec", "-T", "db", "psql",
         "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-U", "hikes", "-d", database,
         "-f", "-"],
        input=script, capture_output=True, text=True, cwd=REPO_ROOT)
    return proc.returncode, proc.stderr


def sql_rejected(script: str, database: str = "hikes") -> bool:
    """脚本被数据库拒绝返回 True，被接受返回 False。"""
    code, _ = psql_may_fail(script, database)
    return code != 0


# ==================== 数据库级操作（建库 / 恢复备份 / 跑迁移） ====================

def admin_psql(script: str) -> str:
    """连 postgres 维护库执行 SQL（建库、删库用）。"""
    return psql(script, "postgres")


def recreate_database(name: str) -> None:
    """重建一个空的验收用副本库；只允许在隔离项目里调用。"""
    if not name.startswith("v3"):
        raise RuntimeError("副本库名必须以 v3 开头，避免误删：" + name)
    admin_psql("DROP DATABASE IF EXISTS %s WITH (FORCE);\nCREATE DATABASE %s;" % (name, name))


def restore_dump(database: str, path: str) -> str:
    """把 pg_dump 自定义格式的备份恢复进副本库，返回 pg_restore 的 stderr。"""
    if not os.path.exists(path):
        raise RuntimeError("找不到备份文件：" + path)
    with open(path, "rb") as handle:
        proc = subprocess.run(
            ["docker", "compose", "-f", COMPOSE_FILE, "exec", "-T", "db",
             "pg_restore", "-U", "hikes", "-d", database,
             "--no-owner", "--no-privileges"],
            stdin=handle, capture_output=True, cwd=REPO_ROOT)
    if proc.returncode != 0:
        raise RuntimeError("pg_restore 失败：" + proc.stderr.decode("utf-8", "replace")[:600])
    return proc.stderr.decode("utf-8", "replace")


def alembic_upgrade(database: str, revision: str = "head") -> str:
    """对指定库跑 alembic upgrade（容器内工作目录 /srv，script_location=migrations）。"""
    return compose("run", "--rm",
                   "-e", "DATABASE_URL=postgresql+psycopg://hikes:hikes@db:5432/" + database,
                   "api", "alembic", "upgrade", revision)


def alembic_current(database: str) -> str:
    return compose("run", "--rm",
                   "-e", "DATABASE_URL=postgresql+psycopg://hikes:hikes@db:5432/" + database,
                   "api", "alembic", "current").strip()


def run_in_api(*args: str) -> str:
    """在隔离环境的 api 容器里跑一段命令（脚本要用容器里的 sqlalchemy）。"""
    return compose("exec", "-T", "api", *args, combine=True)


def sql_rows(script: str, database: str = "hikes") -> list:
    return [line.split("|") for line in psql(script, database).splitlines() if line != ""]


def sql(script: str, database: str = "hikes") -> None:
    """执行写语句，不关心输出。"""
    psql(script, database)


def sql_one(script: str):
    rows = sql_rows(script)
    return rows[0] if rows else None


def value_in(database: str, script: str):
    rows = sql_rows(script, database)
    return rows[0][0] if rows else None


def sql_value(script: str):
    return value_in("hikes", script)


def int_in(database: str, script: str) -> int:
    value = value_in(database, script)
    return int(value) if value not in (None, "") else 0


def sql_int(script: str, database: str = "hikes") -> int:
    return int_in(database, script)


def lit(value) -> str:
    """把 Python 字符串变成 SQL 字面量（drill 只用于自己造的前缀）。"""
    return "'" + str(value).replace("'", "''") + "'"


def like(prefix: str) -> str:
    """前缀匹配字面量；前缀里不要出现 % 和 _。"""
    return lit(prefix) + " || '%'"


# ==================== HTTP 客户端与造号 ====================

def client(**kwargs) -> httpx.Client:
    kwargs.setdefault("timeout", 30.0)
    kwargs.setdefault("follow_redirects", True)
    # 本机 macOS 系统代理（127.0.0.1:7890）在 httpx 里也是"环境代理"，
    # 会让回环请求被塞进代理然后超时；drill 一律直连隔离环境。
    kwargs.setdefault("trust_env", False)
    return httpx.Client(base_url=base_url(), **kwargs)


def unique(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:10]


def action_uuid() -> str:
    """客户端动作编号：真实前端用 crypto.randomUUID()，drill 用标准 UUID。"""
    return str(uuid.uuid4())


def ok(response: httpx.Response, what: str) -> dict:
    if response.status_code >= 300:
        raise AssertionError("%s 失败：HTTP %s %s"
                             % (what, response.status_code, response.text[:400]))
    if not response.content:
        return {}
    try:
        return response.json()
    except Exception:  # noqa: BLE001
        return {}


def error_code(response: httpx.Response) -> str:
    """取错误码：FastAPI 的 HTTPException 会把 detail 再包一层。"""
    try:
        body = response.json()
    except Exception:  # noqa: BLE001
        return "<no-error-body>"
    for candidate in (body, body.get("detail") if isinstance(body, dict) else None):
        if isinstance(candidate, dict) and isinstance(candidate.get("error"), dict):
            return candidate["error"].get("code", "<no-code>")
    return "<no-error-body>"


def new_account(http: httpx.Client, prefix: str) -> dict:
    """注册一个唯一账号，返回 username / uid / token / headers。

    注册接口有 10 次/IP/小时的安全阈值，一份 drill 往往要造十几个身份：
    撞上 429 时清一次隔离环境的计数器再重试一次（清的是计数器，不是业务数据）。
    """
    username = unique(prefix)
    nickname = "drill-" + username[-10:]
    body = {"username": username, "password": PASSWORD, "nickname": nickname}
    response = http.post("/api/auth/register", json=body)
    if response.status_code == 429:
        reset_rate_limits()
        response = http.post("/api/auth/register", json=body)
    data = ok(response, "注册账号")
    uid = int(sql_int("SELECT id FROM users WHERE username = " + lit(username)))
    return {"username": username, "uid": uid, "nickname": nickname, "token": data["token"],
            "headers": {"Authorization": "Bearer " + data["token"]}}


def new_guest(http: httpx.Client, prefix: str = "drillguest") -> dict:
    data = ok(http.post("/api/guest", json={}), "领取游客身份")
    token = data["token"]
    nickname = unique(prefix)
    psql("UPDATE guests SET nickname = %s WHERE token = %s;" % (lit(nickname), lit(token)))
    return {"id": int(sql_int("SELECT id FROM guests WHERE token = " + lit(token))),
            "token": token, "nickname": nickname,
            "headers": {"X-Guest-Token": token}}


def checkin_account(http: httpx.Client, account: dict, point_id: int, **fields) -> httpx.Response:
    return http.post("/api/points/%d/visit" % point_id, json=fields,
                     headers=account["headers"])


def checkin_guest(http: httpx.Client, guest: dict, code: str, **fields) -> httpx.Response:
    body = {"code": code}
    body.update(fields)
    return http.post("/api/guest/visit", json=body, headers=guest["headers"])


# ==================== 造地理实体 ====================

def new_mountain(prefix: str, name: str) -> int:
    stable_key = unique(prefix + "m")
    psql("INSERT INTO mountains (stable_key, name, geom) VALUES (%s, %s, "
         "ST_SetSRID(ST_MakePoint(121.5,31.5),4326));" % (lit(stable_key), lit(name)))
    return int(sql_int("SELECT id FROM mountains WHERE stable_key = " + lit(stable_key)))


def new_point(prefix: str, *, kind: str = "peak", lat=None, lng=None,
              mountain_id=None, status: str = "published", name=None) -> dict:
    # 点位编号在真实数据里是大写，且 /api/guest/visit 会 upper() 后再查，
    # 所以 drill 造的编号也必须是大写，否则测的是"大小写不匹配"而不是业务逻辑。
    code = unique(prefix + "p").upper()
    geom = ("ST_SetSRID(ST_MakePoint(%f,%f),4326)" % (lng, lat)) if lat is not None else "NULL"
    psql("INSERT INTO points (code, type, status, name, mountain_id, geom) "
         "VALUES (%s, %s, %s, %s, %s, %s);" % (
             lit(code), lit(kind), lit(status), lit(name or code),
             mountain_id if mountain_id is not None else "NULL", geom))
    pid = int(sql_int("SELECT id FROM points WHERE code = " + lit(code)))
    return {"id": pid, "code": code, "lat": lat, "lng": lng, "kind": kind}


def new_short_link(code: str, point_id: int) -> None:
    """把点位接上短链（真实二维码就是这条记录），让 /p/{code} 与 /api/qr 可用。"""
    psql("INSERT INTO short_links (code, point_id) VALUES (%s, %d) "
         "ON CONFLICT (code) DO NOTHING;" % (lit(code), point_id))


def new_course(prefix: str, mountain_id: int, start_point_id: int, end_point_id: int,
               *, ranking_enabled: bool = True, min_duration_s: int = 300,
               name=None) -> dict:
    course_name = name or unique(prefix + "c")
    psql("INSERT INTO ascent_courses (mountain_id, start_point_id, end_point_id, name, "
         "min_duration_s, ranking_enabled) VALUES (%d,%d,%d,%s,%d,%s);" % (
             mountain_id, start_point_id, end_point_id, lit(course_name),
             min_duration_s, "TRUE" if ranking_enabled else "FALSE"))
    cid = int(sql_int("SELECT id FROM ascent_courses WHERE name = " + lit(course_name)))
    return {"id": cid, "name": course_name}


# ==================== 清理 ====================

CLEANUP_SQL = """
DELETE FROM segment_efforts
 WHERE course_id IN (SELECT id FROM ascent_courses WHERE name ILIKE {p})
    OR user_id IN (SELECT id FROM users WHERE username ILIKE {p})
    OR guest_id IN (SELECT id FROM guests WHERE nickname ILIKE {p})
    OR start_visit_id IN (SELECT v.id FROM visits v JOIN points pt ON pt.id=v.point_id
                          WHERE pt.code ILIKE {p})
    OR end_visit_id IN (SELECT v.id FROM visits v JOIN points pt ON pt.id=v.point_id
                        WHERE pt.code ILIKE {p});
DELETE FROM visit_submission_receipts
 WHERE (identity_type='user'
        AND identity_id IN (SELECT id FROM users WHERE username ILIKE {p}))
    OR (identity_type='guest'
        AND identity_id IN (SELECT id FROM guests WHERE nickname ILIKE {p}));
DELETE FROM letters WHERE user_id IN (SELECT id FROM users WHERE username ILIKE {p});
DELETE FROM visits
 WHERE user_id IN (SELECT id FROM users WHERE username ILIKE {p})
    OR guest_id IN (SELECT id FROM guests WHERE nickname ILIKE {p})
    OR point_id IN (SELECT id FROM points WHERE code ILIKE {p});
-- 路线也要按端点归属清：drill 有时会给路线起个不带前缀的名字（比如截图用的演示路线），
-- 只按名字清会留下引用点位的路线行，接着删点位就被外键挡住。
DELETE FROM ascent_courses
 WHERE name ILIKE {p}
    OR start_point_id IN (SELECT id FROM points WHERE code ILIKE {p})
    OR end_point_id IN (SELECT id FROM points WHERE code ILIKE {p});
DELETE FROM points WHERE code ILIKE {p};
DELETE FROM mountains WHERE name ILIKE {p};
DELETE FROM guests WHERE nickname ILIKE {p};
DELETE FROM users WHERE username ILIKE {p};
"""


def purge(prefix: str) -> None:
    """删除本 drill 造的全部数据；先删引用方，避免 FK RESTRICT 挡住。"""
    psql(CLEANUP_SQL.format(p=like(prefix)))


# ==================== 故意注错（验证"故障不影响主流程"） ====================

FAILURE_FUNCTION = "v3drill_fail_effort"
FAILURE_TRIGGER = "v3drill_fail_effort_trg"


def create_effort_failure_trigger(course_id: int) -> None:
    """给某条路线的成绩写入挂一个必然失败的触发器。

    用来验证计划 3.4 那句"排行榜故障或配对失败不使打卡失败"：
    配对真的炸掉时，到访仍要写实，之后再靠补偿作业补出成绩。
    """
    psql("""
        CREATE OR REPLACE FUNCTION %(fn)s() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'v3-drill: injected effort failure for course %%', NEW.course_id;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS %(trg)s ON segment_efforts;
        CREATE TRIGGER %(trg)s BEFORE INSERT ON segment_efforts
          FOR EACH ROW WHEN (NEW.course_id = %(course)d)
          EXECUTE FUNCTION %(fn)s();
        """ % {"fn": FAILURE_FUNCTION, "trg": FAILURE_TRIGGER, "course": int(course_id)})


def drop_effort_failure_trigger() -> None:
    psql("DROP TRIGGER IF EXISTS %s ON segment_efforts; DROP FUNCTION IF EXISTS %s();"
         % (FAILURE_TRIGGER, FAILURE_FUNCTION))


# ==================== 环境守卫 ====================

def assert_isolated_env(http: httpx.Client) -> None:
    """确认 HTTP 那一侧的 API 和 psql 那一侧的库是同一个隔离实例。

    做法：往隔离库里插一个临时点位，看 HTTP 侧的 /health 点位数是否同步变化。
    两边对不上就说明 V3_TEST_BASE_URL 指到了别的环境，立刻停手。
    刻意不用注册接口做守卫：注册有 10 次/IP/小时的安全阈值，
    守卫本身不该被限流挡住，也不该消耗真实身份的额度。
    """
    health = http.get("/health")
    if health.status_code != 200:
        raise RuntimeError("隔离环境未就绪：%s/health 返回 %s；见 server/tests/README.md"
                           % (base_url(), health.status_code))
    before = int(health.json()["points"])
    marker = unique("V3GUARD").upper()
    psql("INSERT INTO points (code, type, status, name) "
         "VALUES (%s,'peak','published','guard');" % lit(marker))
    after = int(http.get("/health").json()["points"])
    psql("DELETE FROM points WHERE code = " + lit(marker) + ";")
    if after != before + 1:
        raise RuntimeError(
            "V3_TEST_BASE_URL(%s) 指向的 API 与隔离数据库不是同一个实例："
            "往隔离库插一条点位后 /health 的点位数没有变化（%s → %s）。"
            % (base_url(), before, after))


def reset_rate_limits() -> None:
    """清空限流计数桶。

    注册（10/IP/小时）和领游客身份（30/IP/小时）是写死在代码里的安全阈值，
    不是业务行为；drill 一份用例要造十几个身份，不清零就会把自己挡住，
    测出来的失败与产品无关。只能由 prepare_env() 调用：它紧接着做环境守卫，
    而这里清掉的只是计数器，不动任何业务数据。
    """
    psql("DELETE FROM auth_rate_limits;")


def prepare_env(http: httpx.Client) -> None:
    """drill 的 setUpClass 统一入口：清空限流计数 + 环境守卫。"""
    wait_for_api()          # 容器重启后 /health 会短暂不可用，先等它回来
    reset_rate_limits()
    assert_isolated_env(http)


def wait_for_api(timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    last = None
    with client() as http:
        while time.time() < deadline:
            try:
                response = http.get("/health")
                if response.status_code == 200:
                    return
                last = response.status_code
            except Exception as exc:  # noqa: BLE001
                last = exc
            time.sleep(1.0)
    raise RuntimeError("等不到隔离环境 /health 就绪：%s" % (last,))
