/* 定位与打卡队列的协调层（计划 T3/T4）。

   它只做三件事：
   1. 拿定位（失败给能读懂的原因，不冒充成功）；
   2. 把一次打卡动作送上去，并把结果分类成"成功 / 可重试 / 明确拒绝"；
   3. 维护本机队列：按身份隔离、按状态重试、按规则退避，从不自动换身份上传。

   重试口径（计划 T4）：
   - 401：等同一个身份登录回来（status=blocked），队列不动；
   - 429：遵守 Retry-After；
   - 5xx / 网络中断：指数退避，最多 5 次退避档位；
   - 其它 4xx：服务器明确拒绝（比如不在打卡半径内）→ status=failed，
     保留原因，等用户自己决定重试，不做无限循环。
*/
(function (g) {
  var OFFLINE = g.HIKES_OFFLINE;
  var API = g.API;
  var BACKOFF_SECONDS = [30, 120, 600, 1800, 3600];
  var MAX_ATTEMPTS_BEFORE_SLOWDOWN = 5;

  function authToken() {
    try { return localStorage.getItem('hikes.auth.token'); } catch (e) { return null; }
  }
  function guestToken() {
    try { return localStorage.getItem('hikes.guest.token'); } catch (e) { return null; }
  }
  function identityKey(token) {
    if (token) {
      try {
        var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return 'u:' + JSON.parse(atob(part)).sub;
      } catch (e) { return 'u:unknown'; }
    }
    return 'g:' + (guestToken() || 'none');
  }

  /* 当前身份：登录优先，其次是游客。游客身份要先向服务器领一次令牌，
     领不到就返回 null —— 调用方据此把记录留在本机等联网。 */
  function currentIdentity() {
    return API.token().then(function (token) {
      if (token) return { key: identityKey(token), kind: 'user', token: token };
      return API.guestToken().then(function (guest) {
        if (!guest) return { key: identityKey(null), kind: 'guest', token: null };
        return { key: identityKey(null), kind: 'guest', token: guest };
      });
    });
  }

  function parseRetryAfter(response) {
    var raw = response.headers && response.headers.get('retry-after');
    if (!raw) return null;
    var seconds = Number(raw);
    if (!isNaN(seconds)) return Math.max(0, seconds) * 1000;
    var when = Date.parse(raw);
    return isNaN(when) ? null : Math.max(0, when - Date.now());
  }

  function bodyOf(response) {
    return response.json().catch(function () { return null; }).then(function (body) {
      var error = body && (body.error || (body.detail && body.detail.error));
      return {
        code: (error && error.code) || ('HTTP_' + response.status),
        message: (error && error.message) || ('服务器返回 ' + response.status)
      };
    });
  }

  /* 把一次打卡送回服务器。返回：
     {ok:true, visit} | {ok:false, retryable:bool, code, message, retryAfterMs} */
  function submit(record, identity) {
    var payload = JSON.stringify(record.payload);
    function pointId() {
      if (record.pointId) return Promise.resolve(record.pointId);
      return API.timedFetch('/api/points/' + encodeURIComponent(record.code))
        .then(function (response) {
          if (!response.ok) throw new Error('点位读不到（HTTP ' + response.status + '）');
          return response.json();
        })
        .then(function (detail) { return detail.pointId || detail.id; });
    }
    if (identity.kind === 'user') {
      return pointId().then(function (id) {
        if (!id) throw new Error('点位还没有编号，暂时无法同步');
        return API.timedFetch('/api/points/' + id + '/visit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + identity.token },
          body: payload
        });
      });
    }
    if (!identity.token) {
      return Promise.resolve({ ok: false, retryable: true, code: 'NO_IDENTITY',
                               message: '还没拿到游客身份，联网后再传', retryAfterMs: 15000 });
    }
    return API.timedFetch('/api/guest/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Token': identity.token },
      body: JSON.stringify(Object.assign({ code: record.code }, record.payload))
    });
  }

  function classify(response) {
    if (response.ok) {
      return response.json().then(function (visit) { return { ok: true, visit: visit }; });
    }
    return bodyOf(response).then(function (info) {
      var retryable = response.status === 429 || response.status >= 500;
      var status = response.status;
      return {
        ok: false, status: status, retryable: retryable,
        blocked: status === 401,
        code: info.code, message: info.message,
        retryAfterMs: status === 429 ? parseRetryAfter(response) : null
      };
    });
  }

  function nextAttemptAt(attempts, retryAfterMs) {
    var delayMs = retryAfterMs ||
      BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)] * 1000;
    return new Date(Date.now() + delayMs).toISOString();
  }

  /* 直接提交一次：成功的返回凭证；可重试的交给调用方决定是否入队。 */
  function sendNow(record) {
    return currentIdentity().then(function (identity) {
      return submit(record, identity).then(classify, function (error) {
        return { ok: false, retryable: true, code: 'NETWORK', message: error.message || '网络不通',
                 retryAfterMs: null };
      });
    });
  }

  function enqueue(record) {
    return OFFLINE.put(record);
  }

  /* 游客注册成功后，服务端已经把游客记录并进了这个账号：
     本机队列里属于这个游客身份的动作也要跟着改归同一个账号，否则那几条会永远送不上去。
     只允许"游客 → 刚合并它的账号"这一种改归；登录别人的账号不在此列。 */
  function rebind(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return Promise.resolve(0);
    return OFFLINE.all().then(function (items) {
      var mine = items.filter(function (item) { return item.identity === fromKey; });
      return mine.reduce(function (chain, item) {
        return chain.then(function () {
          return OFFLINE.update(item.clientUuid, { identity: toKey });
        });
      }, Promise.resolve()).then(function () { return mine.length; });
    });
  }

  /* 把队列里属于**当前身份**的记录送上去；别的身份的记录一律不碰。 */
  var running = null;

  /* 单飞：同一时刻只允许一轮同步在跑。
     否则"联网自动同步"和"用户点重试"会各跑一轮，两边都读不到对方的结果，
     用户就会看到"还在等重试时间"这种和事实相反的提示。 */
  function flush(options) {
    options = options || {};
    if (running) {
      if (!options.force) return running;
      return running.then(function () { return flush({ force: true }); });
    }
    running = runFlush(options).then(function (result) {
      running = null;
      return result;
    }, function (error) {
      running = null;
      throw error;
    });
    return running;
  }

  function runFlush(options) {
    return currentIdentity().then(function (identity) {
      return OFFLINE.all().then(function (items) {
        var queue = items.filter(function (item) {
          if (item.identity === identity.key) return true;
          // 还没领到游客令牌时先记在本机身份下，拿到令牌后跟着上传（计划 T4）
          return identity.kind === 'guest' && item.identity === 'g:none' && !!identity.token;
        });
        if (!queue.length) return { sent: 0, failed: 0, blocked: 0, waiting: 0 };
        var result = { sent: 0, failed: 0, blocked: 0, waiting: 0 };
        return queue.reduce(function (chain, item) {
          return chain.then(function () {
            if (!options.force && item.nextAttemptAt &&
                Date.parse(item.nextAttemptAt) > Date.now()) {
              result.waiting += 1;
              return null;
            }
            if (!options.force && item.status === 'failed') {
              result.failed += 1;          // 明确被拒的记录等用户手动重试
              return null;
            }
            return OFFLINE.update(item.clientUuid, { status: 'syncing' })
              .then(function () {
                if (item.identity !== identity.key) {
                  return OFFLINE.update(item.clientUuid, { identity: identity.key });
                }
                return null;
              })
              .then(function () { return submit(item, identity); })
              .then(classify, function (error) {
                return { ok: false, retryable: true, code: 'NETWORK',
                         message: error.message || '网络不通' };
              })
              .then(function (outcome) {
                var attempts = (item.attempts || 0) + 1;
                if (outcome.ok) {
                  result.sent += 1;
                  return OFFLINE.remove(item.clientUuid);
                }
                if (outcome.blocked) {
                  result.blocked += 1;
                  return OFFLINE.update(item.clientUuid, {
                    status: 'blocked', attempts: attempts, lastErrorCode: outcome.code,
                    lastError: outcome.message, nextAttemptAt: null });
                }
                if (outcome.retryable) {
                  result.waiting += 1;
                  return OFFLINE.update(item.clientUuid, {
                    status: 'pending', attempts: attempts, lastErrorCode: outcome.code,
                    lastError: outcome.message,
                    nextAttemptAt: nextAttemptAt(attempts, outcome.retryAfterMs) });
                }
                result.failed += 1;
                return OFFLINE.update(item.clientUuid, {
                  status: 'failed', attempts: attempts, lastErrorCode: outcome.code,
                  lastError: outcome.message, nextAttemptAt: null });
              });
          });
        }, Promise.resolve()).then(function () {
          // 跑完之后再看一眼本机还剩什么：UI 只有知道"还剩几条"才能给出
          // 和事实一致的提示（"都传完了" vs "还在等重试时间"）。
          return summary().then(function (remaining) {
            result.remaining = remaining;
            return result;
          });
        });
      });
    });
  }

  function summary() {
    return OFFLINE.all().then(function (items) {
      return items.reduce(function (acc, item) {
        if (item.status === 'failed') acc.failed += 1;
        else if (item.status === 'blocked') acc.blocked += 1;
        else acc.pending += 1;
        return acc;
      }, { pending: 0, failed: 0, blocked: 0, total: items.length });
    });
  }

  /* 页面打开、恢复联网、回到前台、手动点击都走这里；不依赖后台同步 API。 */
  function route() {
    if (!g.navigator.onLine) return Promise.resolve(null);
    return flush().catch(function () { return null; })
      .then(function (result) {
        if (result && result.sent) {
          g.dispatchEvent(new CustomEvent('hikes:checkin-synced', { detail: result }));
        }
        return result;
      });
  }

  function start() {
    g.addEventListener('online', route);
    g.addEventListener('focus', route);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) route();
    });
    setTimeout(route, 0);
  }

  g.HIKES_CHECKIN = {
    identityKey: identityKey,
    currentIdentity: currentIdentity,
    sendNow: sendNow,
    enqueue: enqueue,
    rebind: rebind,
    flush: flush,
    route: route,
    start: start,
    summary: summary,
    nextAttemptAt: nextAttemptAt,
    position: function () {
      if (!g.isSecureContext) {
        return Promise.reject(new Error('定位需要 HTTPS 安全连接，请改用扫码或手动输入编号'));
      }
      if (!g.navigator.geolocation) {
        return Promise.reject(new Error('这个浏览器拿不到位置，请改用扫码打卡'));
      }
      function locate(options) {
        return new Promise(function (resolve, reject) {
          g.navigator.geolocation.getCurrentPosition(function (position) {
            resolve({ lat: position.coords.latitude, lng: position.coords.longitude,
                      accuracyM: Math.ceil(position.coords.accuracy) });
          }, reject, options);
        });
      }
      /* 室内电脑的 GPS 经常在第一次高精度请求时超时。权限被拒就立即说清楚；
         超时/暂不可用再试一次不要求高精度的系统定位。精度仍由服务端把关，
         不会拿 Wi-Fi 粗定位冒充“已经到点位”。 */
      return locate({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
        .catch(function (first) {
          if (first && first.code === 1) {
            throw new Error('没有定位权限：请允许本站使用定位，或改用扫码打卡');
          }
          return locate({ enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 })
            .catch(function (second) {
              var code = (second && second.code) || (first && first.code);
              if (code === 2) {
                throw new Error('系统定位服务不可用：请在 macOS/Windows 设置中打开定位，并允许浏览器定位；也可以改用扫码');
              }
              throw new Error('定位超时：室内信号弱时可到窗边或户外重试，或改用扫码打卡');
            });
        });
    }
  };
})(window);
