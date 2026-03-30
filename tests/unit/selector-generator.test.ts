/**
 * Unit tests: Selector Generator
 */

import { generateSelectors, type ElementDescriptor } from '../../src/selector-engine/generator';

describe('generateSelectors', () => {
  it('returns sorted candidates by resilience descending', () => {
    const element: ElementDescriptor = {
      tag: 'button',
      role: 'button',
      ariaLabel: 'Run Now',
      visibleText: 'Run Now',
      id: 'btnRunNow'
    };

    const candidates = generateSelectors(element);
    expect(candidates.length).toBeGreaterThan(0);

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.resilience).toBeGreaterThanOrEqual(candidates[i]!.resilience);
    }
  });

  it('generates ARIA role selector as top candidate for buttons with labels', () => {
    const element: ElementDescriptor = {
      tag: 'button',
      role: 'button',
      ariaLabel: 'Submit Form',
      visibleText: 'Submit'
    };

    const candidates = generateSelectors(element);
    const top = candidates[0];
    expect(top!.strategy).toBe('role');
    expect(top!.resilience).toBeGreaterThanOrEqual(0.90);
  });

  it('generates test ID selector with resilience 0.90 when data-test present', () => {
    const element: ElementDescriptor = {
      tag: 'button',
      visibleText: 'Cancel',
      testAttributes: { 'data-test': 'cancel-btn', 'data-testid': null, 'data-qa': null, 'data-cy': null, 'data-automation-id': null, 'data-e2e': null }
    };

    const candidates = generateSelectors(element);
    const testIdCandidate = candidates.find(c => c.strategy === 'testId');
    expect(testIdCandidate).toBeDefined();
    expect(testIdCandidate!.resilience).toBe(0.90);
  });

  it('includes CSS selector as last resort', () => {
    const element: ElementDescriptor = {
      tag: 'div',
      nthOfType: 3,
      depth: 4
    };

    const candidates = generateSelectors(element);
    const css = candidates.find(c => c.strategy === 'css');
    expect(css).toBeDefined();
    expect(css!.resilience).toBe(0.30);
  });

  it('deduplicates identical selectors', () => {
    const element: ElementDescriptor = {
      tag: 'a',
      role: 'link',
      visibleText: 'Go',
      ariaLabel: 'Go'
    };

    const candidates = generateSelectors(element);
    const selectors = candidates.map(c => c.selector);
    const unique = new Set(selectors);
    expect(selectors.length).toBe(unique.size);
  });

  it('respects maxCandidates config', () => {
    const element: ElementDescriptor = {
      tag: 'button',
      role: 'button',
      ariaLabel: 'Test',
      visibleText: 'Test',
      id: 'testBtn',
      name: 'test',
      testAttributes: { 'data-test': 'test-btn', 'data-testid': null, 'data-qa': null, 'data-cy': null, 'data-automation-id': null, 'data-e2e': null }
    };

    const candidates = generateSelectors(element, { maxCandidates: 2 });
    expect(candidates.length).toBeLessThanOrEqual(2);
  });
});
