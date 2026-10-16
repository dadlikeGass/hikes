/* 打卡队列的本机存储（IndexedDB）。

   一条记录长这样（计划 T4 要求把"动作 UUID / 创建它的身份 / 点位快照 /
   现场时间与证据 / 状态 / 错误与重试次数"都留下）：

   {clientUuid, code, pointId, pointSnapshot: {code, name, kind, checkinRadiusM},
    identity, payload: {source, clientUuid, occurredAt, lat, lng, accuracyM},
    status: 'pending' | 'blocked' | 'failed', attempts, lastError, lastErrorCode,
    nextAttemptAt, createdAt, updatedAt}

   两条硬规则：
   1. 写失败必须让调用方知道 —— 页面上不许出现"已保存"而库里没有。
   2. 只存点名、编号、坐标结论这些自己生成的东西；不缓存 /api/me、令牌与信件。
*/
(function (g) {
  var DB_NAME = 'hikes-checkins-v1';
  var STORE = 'pending';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!g.indexedDB) { reject(new Error('这个浏览器不支持本机存储')); return; }
      var request = g.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'clientUuid' });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('本机存储打不开')); };
    });
    // 失败不要把 promise 卡住：下次调用重新尝试打开
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, work) {
    return open().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE, mode);
        var store = transaction.objectStore(STORE);
        var outcome;
        try {
          outcome = work(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = function () { resolve(outcome && outcome.result); };
        transaction.onabort = function () { reject(transaction.error); };
        transaction.onerror = function () { reject(transaction.error); };
      });
    });
  }

  g.HIKES_OFFLINE = {
    put: function (record) {
      var copy = Object.assign({}, record, { updatedAt: new Date().toISOString() });
      return tx('readwrite', function (store) { return store.put(copy); });
    },
    get: function (uuid) {
      return tx('readonly', function (store) { return store.get(uuid); });
    },
    all: function () {
      return tx('readonly', function (store) { return store.getAll(); })
        .then(function (rows) { return rows || []; });
    },
    update: function (uuid, patch) {
      // 读改写放在同一个事务里，避免两个标签页同时改同一条时互相覆盖
      return open().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(STORE, 'readwrite');
          var store = transaction.objectStore(STORE);
          var request = store.get(uuid);
          request.onsuccess = function () {
            if (!request.result) { return; }
            store.put(Object.assign({}, request.result, patch,
                                    { updatedAt: new Date().toISOString() }));
          };
          transaction.oncomplete = function () { resolve(true); };
          transaction.onerror = function () { reject(transaction.error); };
          transaction.onabort = function () { reject(transaction.error); };
        });
      });
    },
    remove: function (uuid) {
      return tx('readwrite', function (store) { return store.delete(uuid); });
    },
    count: function () {
      return tx('readonly', function (store) { return store.count(); });
    }
  };
})(window);
