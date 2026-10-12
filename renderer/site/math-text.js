// Display mathematics inside Arabic and English cards without altering saved content.
// Never interpret card content as HTML: all expressions remain React text nodes.
const derivative = '∂[\\p{L}]+\\/∂[\\p{L}]+';
const atom = '(?:' + derivative + '|[A-Za-z\\u00c0-\\u02ff\\u0370-\\u03ff][A-Za-z0-9_\\u00c0-\\u02ff\\u0370-\\u03ff]*|[+\\u2212-]?\\d+(?:\\.\\d+)?)';
const operator = '(?:=|≈|≠|≤|≥|×|·|\\/|\\+|\\u2212|-)';
const inlineMath = new RegExp(
  '(?:' + derivative + ')(?:[ \\t]*(?:=|≈|≠|≤|≥)[ \\t]*[+\\u2212-]?\\d+(?:\\.\\d+)?)?' +
  '|' + atom + '(?:[ \\t]*' + operator + '[ \\t]*' + atom + ')+' +
  '|(?<![\\w.])\\d+(?:\\.\\d+)?',
  'gu'
);
const fractions = /∂([\p{L}]+)\/∂([\p{L}]+)/gu;

export function splitMathText(value) {
  if (typeof value !== 'string' || !value) return [{ kind: 'text', value }];
  const parts = [];
  let cursor = 0;
  for (const match of value.matchAll(inlineMath)) {
    if (match.index > cursor) parts.push({ kind: 'text', value: value.slice(cursor, match.index) });
    parts.push({ kind: 'math', value: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push({ kind: 'text', value: value.slice(cursor) });
  return parts.length ? parts : [{ kind: 'text', value }];
}

function fraction(numerator, denominator, label, jsx) {
  const row = (symbol) => jsx('mrow', {
    children: [jsx('mo', { children: '∂' }), jsx('mi', { children: symbol })],
  });
  return jsx('math', {
    display: 'inline',
    'aria-label': label,
    children: jsx('mfrac', { children: [row(numerator), row(denominator)] }),
  });
}

function renderExpression(value, jsx) {
  const children = [];
  let cursor = 0;
  for (const match of value.matchAll(fractions)) {
    if (match.index > cursor) children.push(value.slice(cursor, match.index));
    children.push(fraction(match[1], match[2], match[0], jsx));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) children.push(value.slice(cursor));
  return children.length === 1 ? children[0] : children;
}

export function renderMathText(value, jsx) {
  if (typeof value !== 'string') return value;
  const parts = splitMathText(value);
  if (parts.length === 1 && parts[0].kind === 'text') return value;
  return parts.map((part, index) => part.kind === 'math'
    ? jsx('bdi', {
      className: 'recall-inline-math',
      dir: 'ltr',
      children: renderExpression(part.value, jsx),
    }, index)
    : part.value);
}
