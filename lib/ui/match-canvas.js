/**
 * MatchCanvas - SVG-based line drawing for transaction matching
 * Renders bezier curves between matched Fidelity and YNAB transactions
 */

class MatchCanvas {
  constructor(options = {}) {
    this.svg = null;
    this.fidelityColumn = null;
    this.ynabColumn = null;
    this.matches = new Map(); // fidelityIndex -> { ynabId, type: 'match' | 'create' }
    this.dragging = null;
    this.onMatchChanged = options.onMatchChanged || (() => {});

    this.boundHandlers = {
      onScroll: this.redraw.bind(this),
      onMouseMove: this.onMouseMove.bind(this),
      onMouseUp: this.onMouseUp.bind(this)
    };
  }

  init() {
    this.svg = document.getElementById('matchLines');
    this.fidelityColumn = document.getElementById('fidelityColumn');
    this.ynabColumn = document.getElementById('ynabColumn');

    if (!this.svg || !this.fidelityColumn || !this.ynabColumn) {
      console.warn('MatchCanvas: Required elements not found');
      return;
    }

    // Set up scroll listeners
    this.fidelityColumn.addEventListener('scroll', this.boundHandlers.onScroll);
    this.ynabColumn.addEventListener('scroll', this.boundHandlers.onScroll);

    // Set up drag handlers via delegation
    this.fidelityColumn.addEventListener('mousedown', (e) => this.onDragStart(e));
    document.addEventListener('mousemove', this.boundHandlers.onMouseMove);
    document.addEventListener('mouseup', this.boundHandlers.onMouseUp);

    // Initial draw
    this.redraw();
  }

  destroy() {
    if (this.fidelityColumn) {
      this.fidelityColumn.removeEventListener('scroll', this.boundHandlers.onScroll);
    }
    if (this.ynabColumn) {
      this.ynabColumn.removeEventListener('scroll', this.boundHandlers.onScroll);
    }
    document.removeEventListener('mousemove', this.boundHandlers.onMouseMove);
    document.removeEventListener('mouseup', this.boundHandlers.onMouseUp);
  }

  setMatches(matchesArray) {
    this.matches.clear();
    for (const { fidelityIndex, ynabId, type } of matchesArray) {
      this.matches.set(fidelityIndex, { ynabId, type: type || 'match' });
    }
    this.redraw();
  }

  getMatches() {
    return Array.from(this.matches.entries()).map(([fidelityIndex, data]) => ({
      fidelityIndex,
      ynabId: data.ynabId,
      type: data.type
    }));
  }

  setMatch(fidelityIndex, ynabId, type = 'match') {
    this.matches.set(fidelityIndex, { ynabId, type });
    this.redraw();
    this.onMatchChanged({ fidelityIndex, ynabId, type });
  }

  removeMatch(fidelityIndex) {
    this.matches.delete(fidelityIndex);
    this.redraw();
    this.onMatchChanged({ fidelityIndex, ynabId: null, type: null });
  }

  onDragStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;

    const index = handle.dataset.index;
    if (index === undefined || String(index).startsWith('before-')) return;

    e.preventDefault();
    this.dragging = {
      fidelityIndex: parseInt(index, 10),
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    };

    document.body.classList.add('dragging-match');
    this.redraw();
  }

  onMouseMove(e) {
    if (!this.dragging) return;
    this.dragging.currentX = e.clientX;
    this.dragging.currentY = e.clientY;
    this.redraw();

    // Highlight potential drop targets
    const target = this.getDropTarget(e.clientX, e.clientY);
    document.querySelectorAll('.ynab-item, .create-new-target').forEach(el => {
      el.classList.remove('drop-hover');
    });
    if (target) {
      target.classList.add('drop-hover');
    }
  }

  onMouseUp(e) {
    if (!this.dragging) return;

    const target = this.getDropTarget(e.clientX, e.clientY);
    if (target) {
      const ynabId = target.dataset.ynabId;
      const targetIndex = target.dataset.targetIndex;

      if (ynabId) {
        this.setMatch(this.dragging.fidelityIndex, ynabId, 'match');
      } else if (targetIndex !== undefined) {
        this.setMatch(this.dragging.fidelityIndex, `__CREATE_${targetIndex}__`, 'create');
      }
    }

    document.querySelectorAll('.ynab-item, .create-new-target').forEach(el => {
      el.classList.remove('drop-hover');
    });

    document.body.classList.remove('dragging-match');
    this.dragging = null;
    this.redraw();
  }

  getDropTarget(x, y) {
    const elements = document.elementsFromPoint(x, y);
    return elements.find(el =>
      el.classList.contains('ynab-item') ||
      el.classList.contains('create-new-target')
    );
  }

  redraw() {
    if (!this.svg) return;

    const containerRect = this.svg.parentElement.getBoundingClientRect();
    this.svg.setAttribute('width', containerRect.width);
    this.svg.setAttribute('height', containerRect.height);
    this.svg.innerHTML = '';

    // Draw existing matches
    for (const [fidelityIndex, data] of this.matches) {
      const fidelityEl = this.fidelityColumn.querySelector(`.fidelity-item[data-index="${fidelityIndex}"]`);
      if (!fidelityEl) continue;

      let targetEl;
      if (data.type === 'create') {
        const targetIndex = data.ynabId.replace('__CREATE_', '').replace('__', '');
        targetEl = this.ynabColumn.querySelector(`.create-new-target[data-target-index="${targetIndex}"]`);
      } else {
        targetEl = this.ynabColumn.querySelector(`.ynab-item[data-ynab-id="${data.ynabId}"]`);
      }

      if (!targetEl) continue;

      const color = data.type === 'create' ? '#22c55e' : '#3b82f6';
      this.drawConnection(fidelityEl, targetEl, containerRect, color);
    }

    // Draw dragging line
    if (this.dragging) {
      const fidelityEl = this.fidelityColumn.querySelector(`.fidelity-item[data-index="${this.dragging.fidelityIndex}"]`);
      if (fidelityEl) {
        this.drawDraggingLine(fidelityEl, containerRect);
      }
    }
  }

  drawConnection(fromEl, toEl, containerRect, color) {
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const startX = fromRect.right - containerRect.left;
    const startY = fromRect.top + fromRect.height / 2 - containerRect.top;
    const endX = toRect.left - containerRect.left;
    const endY = toRect.top + toRect.height / 2 - containerRect.top;

    const path = this.createBezierPath(startX, startY, endX, endY, color);
    this.svg.appendChild(path);

    // Add small circles at endpoints
    this.svg.appendChild(this.createCircle(startX, startY, color));
    this.svg.appendChild(this.createCircle(endX, endY, color));
  }

  drawDraggingLine(fromEl, containerRect) {
    const fromRect = fromEl.getBoundingClientRect();
    const startX = fromRect.right - containerRect.left;
    const startY = fromRect.top + fromRect.height / 2 - containerRect.top;
    const endX = this.dragging.currentX - containerRect.left;
    const endY = this.dragging.currentY - containerRect.top;

    const path = this.createBezierPath(startX, startY, endX, endY, '#9ca3af', true);
    this.svg.appendChild(path);
    this.svg.appendChild(this.createCircle(startX, startY, '#9ca3af'));
  }

  createBezierPath(x1, y1, x2, y2, color, isDashed = false) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const midX = (x1 + x2) / 2;

    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    if (isDashed) {
      path.setAttribute('stroke-dasharray', '4 4');
    }
    return path;
  }

  createCircle(x, y, color) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', color);
    return circle;
  }
}

if (typeof window !== 'undefined') window.MatchCanvas = MatchCanvas;
