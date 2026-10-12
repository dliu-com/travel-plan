'use strict';

// Assign simultaneous events separate lanes; disconnected groups reclaim the full width.
(function (root) {
  function minutes(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
  function layout(events) {
    const items = events.map(event => {
      const start = minutes(event.time);
      return { event, start, end: Math.min(1440, event.endTime ? minutes(event.endTime) : start + 30) };
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    let group = [], ends = [], until = -1;
    const flush = () => { for (const item of group) item.lanes = ends.length; group = []; ends = []; };
    for (const item of items) {
      if (item.start >= until) flush();
      let lane = ends.findIndex(end => end <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.end;
      item.lane = lane;
      group.push(item);
      until = Math.max(...ends);
    }
    flush();
    return items;
  }
  const api = { layout };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PlanCalendar = api;
})(typeof window === 'undefined' ? globalThis : window);
