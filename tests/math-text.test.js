import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMathText, renderMathText } from '../renderer/site/math-text.js';

const jsx = (type, props, key) => ({ type, props, key });

test('isolates mixed Arabic and Latin equation in a study question', () => {
  const text = 'إذا ∂L/∂w = +4، شو بصير تقريبًا لو زدنا w بمقدار 0.01؟';
  const segments = splitMathText(text);
  assert.deepEqual(
    segments.filter((segment) => segment.kind === 'math').map((segment) => segment.value),
    ['∂L/∂w = +4', '0.01']
  );
  assert.equal(segments.map((segment) => segment.value).join(''), text);
  const rendered = renderMathText(text, jsx);
  assert.equal(rendered[1].type, 'bdi');
  assert.equal(rendered[1].props.dir, 'ltr');
  const children = rendered[1].props.children;
  assert.equal(children[0].type, 'math');
  assert.equal(children[0].props.children.type, 'mfrac');
  assert.equal(children[1], ' = +4');
});

test('keeps plain Arabic and English content unchanged', () => {
  for (const value of ['هذا شرح عربي من دون معادلات', 'No equations in this sentence.', '']) {
    assert.equal(renderMathText(value, jsx), value);
  }
});

test('shows both derivatives using MathML, and handles signed updates', () => {
  const input = '∂L/∂ŷ = +2 و ∂ŷ/∂w = -3';
  const rendered = renderMathText(input, jsx);
  const mathPieces = rendered.filter((x) => typeof x === 'object');
  assert.equal(mathPieces.length, 2);
  for (const piece of mathPieces) {
    assert.equal(piece.type, 'bdi');
    assert.equal(piece.props.children[0].type, 'math');
    assert.equal(piece.props.children[0].props.children.type, 'mfrac');
  }
});

test('retains original math/text roundtrip without HTML injection', () => {
  const input = 'w_new = w_old − ηg, <img src=x onerror=alert(1)> 0.01';
  const pieces = splitMathText(input);
  assert.equal(pieces.map((p) => p.value).join(''), input);
  assert.equal(pieces.some((p) => p.kind === 'text' && p.value.includes('<img')), true);
});
