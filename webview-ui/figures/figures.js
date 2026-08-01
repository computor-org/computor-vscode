/*
 * The "Figures" panel: a strip of thumbnails over the selected figure in full.
 *
 * Images arrive as data URIs and are only resent when they actually changed,
 * so this keeps the ones it already has and updates in place. Rebuilding the
 * strip wholesale would make a republishing figure — an animation, a
 * `plt.ion()` session — flicker on every frame.
 */
(function () {
  'use strict';

  const { el, onCommand, post, registerActions } = window.ComputorWebview;

  const emptyNode = document.getElementById('figuresEmpty');
  const stageNode = document.getElementById('figuresStage');
  const stageTitleNode = document.getElementById('figuresStageTitle');
  const stageMetaNode = document.getElementById('figuresStageMeta');
  const stageImageNode = document.getElementById('figuresStageImage');
  const stripNode = document.getElementById('figuresStrip');

  /** number -> { title, source, image } as last received. */
  const figures = new Map();
  /** number -> the thumbnail element showing it. */
  const thumbnails = new Map();
  let order = [];
  let selected = null;

  function merge(incoming) {
    const seen = new Set();
    order = [];
    for (const figure of incoming) {
      seen.add(figure.number);
      order.push(figure.number);
      const known = figures.get(figure.number);
      figures.set(figure.number, {
        title: figure.title,
        source: figure.source,
        revision: figure.revision,
        // A null image means "unchanged": the panel skipped resending it.
        image: figure.image || (known && known.image) || ''
      });
    }
    for (const number of Array.from(figures.keys())) {
      if (!seen.has(number)) {
        figures.delete(number);
      }
    }
  }

  function createThumbnail(number) {
    const image = el('img', { className: 'figures-thumb-image', alt: '' });
    const label = el('span', { className: 'figures-thumb-label' });

    // Two sibling buttons in a wrapper rather than a close button nested in
    // the thumbnail: a button inside a button is invalid, and the browser
    // takes the inner one out of the tab order.
    const open = el('button', {
      className: 'figures-thumb-open',
      type: 'button',
      dataset: { action: 'select', number: String(number) }
    }, [image, label]);
    const close = el('button', {
      className: 'figures-thumb-close',
      type: 'button',
      title: 'Close this figure',
      dataset: { action: 'close', number: String(number) }
    }, '×');

    const node = el('div', { className: 'figures-thumb' }, [open, close]);
    node.__image = image;
    node.__label = label;
    node.__open = open;
    return node;
  }

  function renderStrip() {
    for (const [number, node] of Array.from(thumbnails)) {
      if (!figures.has(number)) {
        node.remove();
        thumbnails.delete(number);
      }
    }

    for (const number of order) {
      const figure = figures.get(number);
      let node = thumbnails.get(number);
      if (!node) {
        node = createThumbnail(number);
        thumbnails.set(number, node);
      }
      // An empty src would resolve against the page and request the document
      // itself; leave the element blank until a real image arrives.
      if (figure.image && node.__image.getAttribute('src') !== figure.image) {
        node.__image.setAttribute('src', figure.image);
      }
      node.__label.textContent = figure.title;
      node.__open.title = figure.title;
      node.classList.toggle('selected', number === selected);
      // appendChild moves a node that is already in the strip, so this both
      // inserts new thumbnails and keeps them all in figure order.
      stripNode.appendChild(node);
    }

    stripNode.classList.toggle('hidden', order.length < 2);
  }

  function renderStage() {
    const figure = selected === null ? undefined : figures.get(selected);
    emptyNode.classList.toggle('hidden', !!figure);
    stageNode.classList.toggle('hidden', !figure);
    if (!figure) {
      // Drop the image so a closed figure cannot flash back when the next one
      // opens the stage again.
      stageImageNode.removeAttribute('src');
      return;
    }

    stageTitleNode.textContent = figure.title;
    stageMetaNode.textContent = 'Figure ' + selected + ' · ' + figure.source;
    if (figure.image && stageImageNode.getAttribute('src') !== figure.image) {
      stageImageNode.setAttribute('src', figure.image);
    }
    stageImageNode.alt = figure.title;
  }

  function render() {
    renderStage();
    renderStrip();
  }

  onCommand('figuresUpdate', (data) => {
    merge((data && data.figures) || []);
    const wanted = data && data.selected !== null && data.selected !== undefined ? data.selected : null;
    selected = wanted !== null && figures.has(wanted) ? wanted : (order.length ? order[order.length - 1] : null);
    render();
  });

  registerActions({
    select: (dataset) => {
      selected = Number(dataset.number);
      post('select', { number: selected });
      render();
    },
    close: (dataset) => {
      post('close', { number: Number(dataset.number) });
    },
    closeSelected: () => {
      if (selected !== null) {
        post('close', { number: selected });
      }
    },
    closeAll: () => {
      post('closeAll');
    }
  });

  post('ready');
})();
