/*
 * The image editor.
 *
 * The picture is already in the document as a data URI — there is no fetch
 * here on purpose, see ImagePreviewPanel.ts. All this does is fit it, zoom it
 * and say how big it is.
 */
(function () {
  'use strict';

  const { registerActions } = window.ComputorWebview;
  const vscode = window.vscodeApi;

  const state = window.__INITIAL_STATE__ || {};

  const canvasNode = document.getElementById('imageCanvas');
  const imageNode = document.getElementById('imageStage');
  const metaNode = document.getElementById('imageMeta');
  const zoomNode = document.getElementById('imageZoom');
  const errorNode = document.getElementById('imageError');

  const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 12, 20];
  const MIN_ZOOM = ZOOM_LEVELS[0];
  const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  /* Above this the point is to inspect pixels, so stop smoothing them. */
  const PIXELATION_THRESHOLD = 3;

  /** 'fit', or a number as a factor of the image's natural size. */
  let zoom = 'fit';
  let loaded = false;

  /* No image to show: say why, and take the zoom controls away rather than
     leave buttons that cannot do anything. */
  function showError(message) {
    errorNode.textContent = message;
    errorNode.classList.remove('hidden');
    canvasNode.classList.add('hidden');
    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.classList.add('hidden');
    });
  }

  if (state.error || !state.src) {
    showError(state.error || 'This file could not be shown.');
    metaNode.textContent = state.name || '';
    return;
  }

  function describe() {
    const parts = [];
    if (loaded && imageNode.naturalWidth) {
      parts.push(imageNode.naturalWidth + ' × ' + imageNode.naturalHeight);
    }
    if (state.sizeLabel) {
      parts.push(state.sizeLabel);
    }
    metaNode.textContent = parts.join(' · ');
    metaNode.title = state.name || '';
  }

  /** What "fit" currently works out to, so stepping off it starts from there. */
  function fittedScale() {
    if (!imageNode.naturalWidth || !imageNode.clientWidth) {
      return 1;
    }
    return imageNode.clientWidth / imageNode.naturalWidth;
  }

  function render() {
    const zoomed = zoom !== 'fit';
    canvasNode.classList.toggle('zoomed', zoomed);

    if (zoomed) {
      imageNode.style.width = Math.max(1, Math.round(imageNode.naturalWidth * zoom)) + 'px';
      imageNode.style.height = Math.max(1, Math.round(imageNode.naturalHeight * zoom)) + 'px';
      imageNode.classList.toggle('pixelated', zoom >= PIXELATION_THRESHOLD);
      zoomNode.textContent = Math.round(zoom * 100) + '%';
    } else {
      imageNode.style.width = '';
      imageNode.style.height = '';
      imageNode.classList.remove('pixelated');
      zoomNode.textContent = 'Fit';
    }

    // Clicking the picture is the quick way between the two, so the cursor has
    // to say which way it will go.
    canvasNode.classList.toggle('can-zoom-in', !zoomed);
    canvasNode.classList.toggle('can-zoom-out', zoomed);

    if (vscode) {
      vscode.setState({ zoom: zoom });
    }
  }

  function setZoom(next) {
    zoom = next === 'fit' ? 'fit' : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    render();
  }

  function step(direction) {
    const current = zoom === 'fit' ? fittedScale() : zoom;
    if (direction > 0) {
      setZoom(ZOOM_LEVELS.find(function (level) { return level > current + 0.001; }) || MAX_ZOOM);
    } else {
      const below = ZOOM_LEVELS.filter(function (level) { return level < current - 0.001; });
      setZoom(below.length ? below[below.length - 1] : MIN_ZOOM);
    }
  }

  registerActions({
    zoomIn: function () { step(1); },
    zoomOut: function () { step(-1); },
    toggleZoom: function () { setZoom(zoom === 'fit' ? 1 : 'fit'); }
  });

  imageNode.addEventListener('click', function () {
    setZoom(zoom === 'fit' ? 1 : 'fit');
  });

  // Ctrl/Cmd + wheel is the zoom gesture everywhere else in the editor, and a
  // trackpad pinch arrives as exactly this. Without preventDefault the browser
  // would zoom the whole webview instead.
  canvasNode.addEventListener('wheel', function (event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    step(event.deltaY > 0 ? -1 : 1);
  }, { passive: false });

  imageNode.addEventListener('load', function () {
    loaded = true;
    describe();
    render();
  });

  imageNode.addEventListener('error', function () {
    // A data URI the browser refuses is a broken or truncated file, not a
    // missing one — say so rather than leave an empty frame.
    showError('This image could not be decoded. The file may be incomplete.');
  });

  // A re-running test rewrites its figure and the whole document is rebuilt,
  // so without this a student zoomed into a plot is thrown back to Fit every
  // couple of seconds.
  const restored = vscode && vscode.getState();
  if (restored && restored.zoom) {
    zoom = restored.zoom;
  }

  describe();
  render();
  imageNode.src = state.src;
})();
