/**
 * The marker a course-content row carries in the trees: a circle for a unit, a
 * square for an assignment, in the colour of its content type, with the test
 * and submission badge and the grading corner dot.
 *
 * Free of `vscode`, so the welcome page can draw its legend with the very
 * markup the tree shows (computor-org/issues#526); IconGenerator writes the
 * same SVG to a file for the tree.
 */

export type ContentIconShape = 'circle' | 'square';
export type ContentIconBadge = 'success' | 'success-submitted' | 'failure' | 'failure-submitted' | 'submitted' | 'none';
export type ContentIconCorner = 'corrected' | 'correction_necessary' | 'correction_possible' | 'none';

export function contentIconSvg(
  color: string,
  shape: ContentIconShape,
  badge: ContentIconBadge = 'none',
  corner: ContentIconCorner = 'none',
  unreviewed: boolean = false
): string {
  const size = 16;
  const padding = 2;
  const shapeSize = size - (padding * 2);

  let shapeElement: string;
  if (shape === 'circle') {
    const cx = size / 2;
    const cy = size / 2;
    const r = shapeSize / 2;
    shapeElement = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" />`;
  } else {
    shapeElement = `<rect x="${padding}" y="${padding}" width="${shapeSize}" height="${shapeSize}" fill="${color}" rx="2" />`;
  }

  // Main badge overlay (with black outline for contrast)
  let badgeElement = '';
  if (badge === 'success') {
    // Single checkmark - passed test, not submitted
    badgeElement = `
      <path d="M4 8.5 L7 11 L12 6" stroke="#000000" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 8.5 L7 11 L12 6" stroke="#7af595ff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    `;
  } else if (badge === 'success-submitted') {
    // Double checkmark - passed test AND submitted (diagonally aligned)
    badgeElement = `
      <path d="M2 6.5 L4.5 9 L8 5.5" stroke="#000000" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 6.5 L4.5 9 L8 5.5" stroke="#7af595ff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6.5 9.5 L9 12 L14 7" stroke="#000000" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6.5 9.5 L9 12 L14 7" stroke="#7af595ff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    `;
  } else if (badge === 'failure') {
    // Backslash - failed test, not submitted
    badgeElement = `
      <path d="M5 5 L11 11" stroke="#000000" stroke-width="3" stroke-linecap="round"/>
      <path d="M5 5 L11 11" stroke="#ff3f3fff" stroke-width="2" stroke-linecap="round"/>
    `;
  } else if (badge === 'failure-submitted') {
    // X (cross) - failed test AND submitted
    badgeElement = `
      <path d="M5 5 L11 11" stroke="#000000" stroke-width="3" stroke-linecap="round"/>
      <path d="M11 5 L5 11" stroke="#000000" stroke-width="3" stroke-linecap="round"/>
      <path d="M5 5 L11 11" stroke="#ff3f3fff" stroke-width="2" stroke-linecap="round"/>
      <path d="M11 5 L5 11" stroke="#ff3f3fff" stroke-width="2" stroke-linecap="round"/>
    `;
  } else if (badge === 'submitted') {
    // Purple checkmark - submitted but not tested
    badgeElement = `
      <path d="M4 8.5 L7 11 L12 6" stroke="#000000" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 8.5 L7 11 L12 6" stroke="#c084fcff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    `;
  }

  // Corner status dot (bottom-right)
  let cornerElement = '';
  if (corner !== 'none') {
    const cornerColor = corner === 'corrected' ? '#57cc5dff' : corner === 'correction_necessary' ? '#fc4a4aff' : '#fdba4dff';
    const cx = size - 3.5;
    const cy = size - 3.5;
    const r = 3;
    cornerElement = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cornerColor}" stroke="#ffffff" stroke-width="1.5" />`;
  }

  // Unreviewed indicator dot (top-left) - cyan/blue dot to indicate pending review
  let unreviewedElement = '';
  if (unreviewed) {
    const cx = 3.5;
    const cy = 3.5;
    const r = 3;
    unreviewedElement = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" />`;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${shapeElement}
  ${badgeElement}
  ${cornerElement}
  ${unreviewedElement}
</svg>`;
}
