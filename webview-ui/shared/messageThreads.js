/*
 * Thread assembly and ordering for the messages view.
 *
 * Loaded after base.js and before messages.js; exposes
 * `window.ComputorWebview.messageThreads`. Pure (no DOM, no shared state) so
 * it can be unit-tested via CommonJS.
 *
 * Why this exists as its own module: ordering here is not cosmetic and has
 * been wrong twice.
 *
 * Threads used to sort on `updated_at || created_at`, so editing a
 * three-week-old message moved it to the bottom of the conversation, past
 * every reply written since. Order is now by when a message was *written*.
 *
 * And a conversation and an announcement board read in opposite directions.
 * A conversation goes forwards — oldest first, newest at the bottom next to
 * the composer. An announcement board goes backwards — the newest notice is
 * the one that matters, and being scrolled to the end shows you the oldest
 * one in the course. Replies always read forwards regardless, because a
 * thread only makes sense in the order it was written.
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (global && global.ComputorWebview) {
    global.ComputorWebview.messageThreads = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function compareWritten(a, b) {
    const aTime = a.created_at || '';
    const bTime = b.created_at || '';
    const byTime = aTime.localeCompare(bTime);
    // Same timestamp (bulk imports, or a coarse clock) — fall back to id so
    // the order is at least stable between renders.
    return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
  }

  /**
   * Group a flat message list into reply trees.
   *
   * @param {Array} messages
   * @param {{newestFirst?: boolean}} [options] newestFirst reverses the roots
   *   only — replies stay in the order they were written.
   * @returns {Array} root nodes, each with a `children` array
   */
  function buildThreads(messages, options) {
    const newestFirst = Boolean(options && options.newestFirst);
    const map = new Map();
    const roots = [];

    (messages || []).forEach((msg) => {
      map.set(msg.id, Object.assign({}, msg, { children: [] }));
    });
    map.forEach((node) => {
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id).children.push(node);
      } else {
        // A reply whose parent isn't in this page (filtered out, or on
        // another page) stands on its own rather than disappearing.
        roots.push(node);
      }
    });

    function sortNode(node) {
      node.children.sort(compareWritten).forEach(sortNode);
    }

    roots.sort(compareWritten).forEach(sortNode);
    if (newestFirst) {
      roots.reverse();
    }
    return roots;
  }

  /**
   * Flatten reply trees into the render order, stamping each node's depth.
   *
   * A root keeps its own stored `level` so a reply whose parent fell outside
   * the page still renders indented rather than jumping to the margin.
   */
  function flattenThreads(threads, depth) {
    const result = [];
    (threads || []).forEach((node) => {
      const d = depth === undefined || depth === null ? (node.level || 0) : depth;
      result.push(Object.assign({}, node, { level: d, children: [] }));
      if (node.children && node.children.length > 0) {
        result.push.apply(result, flattenThreads(node.children, d + 1));
      }
    });
    return result;
  }

  return {
    compareWritten: compareWritten,
    buildThreads: buildThreads,
    flattenThreads: flattenThreads
  };
});
