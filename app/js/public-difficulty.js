(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PUBLIC_DIFFICULTY = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var LABELS = ['一般', '一般+', '中等', '中等+', '困难', '困难+', '极度困难'];
  var COLORS = { general: '#238b70', general_plus: '#399a75', moderate: '#8a771f',
    moderate_plus: '#a5681e', hard: '#c75b45', hard_plus: '#c83773', extreme: '#7c3255' };
  /* 七档的顺序就是图例的顺序；地图图例、坡度图底部色条都读这里，别再各写一套。 */
  var GRADE_KEYS = ['general', 'general_plus', 'moderate', 'moderate_plus',
    'hard', 'hard_plus', 'extreme'];
  var GRADES = GRADE_KEYS.map(function (key, index) {
    return { key: key, label: LABELS[index], color: COLORS[key] };
  });
  function directionFromHash(hash) {
    var query = String(hash || '').split('?')[1] || '';
    var params = new URLSearchParams(query);
    return params.get('direction') === 'reverse' ? 'reverse' : 'forward';
  }
  function withDirection(hash, direction) {
    var parts = String(hash || '#/').split('?'), params = new URLSearchParams(parts[1] || '');
    params.set('direction', direction === 'reverse' ? 'reverse' : 'forward');
    return parts[0] + '?' + params.toString();
  }
  function normalizeResponse(response) {
    if (!response || typeof response !== 'object') return null;
    function point(p) {
      if (!p) return null;
      return { pointId: p.pointId, stableKey: p.stableKey, name: p.name,
        pointType: p.pointType, forwardKm: p.forwardKm, displayKm: p.displayKm,
        latitude: p.latitude, longitude: p.longitude, elevationM: p.elevationM };
    }
    return {
      direction: response.direction === 'reverse' ? 'reverse' : 'forward',
      publicationVersion: response.publicationVersion,
      segmentationVersion: response.segmentationVersion,
      points: (response.points || []).map(point),
      activeAlerts: response.activeAlerts || [],
      segments: (response.segments || []).map(function (s) {
        return { segmentId: s.segmentId, stableKey: s.stableKey, displayOrder: s.displayOrder,
          forwardOrder: s.forwardOrder, reverseOrder: s.reverseOrder, fromKm: s.fromKm,
          toKm: s.toKm, trackFromKm: s.trackFromKm, trackToKm: s.trackToKm,
          distanceKm: s.distanceKm, ascentM: s.ascentM, descentM: s.descentM,
          fromPoint: point(s.fromPoint), toPoint: point(s.toPoint),
          grade: { key: s.grade.key, label: s.grade.label }, terrainTags: s.terrainTags || [] };
      })
    };
  }
  function colorForGrade(key) { return COLORS[key] || '#7c879b'; }
  return { LABELS: LABELS, COLORS: COLORS, GRADES: GRADES,
    directionFromHash: directionFromHash, withDirection: withDirection,
    normalizeResponse: normalizeResponse, colorForGrade: colorForGrade };
});
