/* 模糊定位（2026-10-25）
 *
 * 申请 GPS（粗定位）→ 坐标先在本地网格化（0.05° ≈ 5.5 km）→ 问后端 /api/locate
 * 最近点位的省市 → 存 localStorage。坐标不上传原始精度，后端也不存位置。
 */
(function (g) {
  var KEY = 'dcyy.region';
  var GRID = 0.05;
  function round(v) { return Math.round(v / GRID) * GRID; }
  function get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function detect() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('no geolocation')); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = round(pos.coords.latitude), lng = round(pos.coords.longitude);
        fetch('/api/locate?lat=' + lat + '&lng=' + lng).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (d) {
          if (!d || (!d.province && !d.city)) throw new Error('no region');
          var v = { province: d.province || null, city: d.city || null, at: Date.now() };
          set(v);
          resolve(v);
        }).catch(reject);
      }, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
    });
  }
  g.HIKES_LOC = { get: get, set: set, clear: clear, detect: detect, key: KEY };
})(window);
