import { afterEach, describe, expect, test } from 'bun:test';

import { render, type Rendered } from '../lib/test/render';
import { KpiTile } from './kpi-tile';
import { FeedbackBanner } from './feedback/banner';

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe('KpiTile (story 9-1 opt-ins)', () => {
  test('without the new props the markup is exactly the pre-9-1 tile', () => {
    view = render(<KpiTile label="Open transactions" value="—" delta="inventory" />);
    expect(view.container.innerHTML).toBe(
      '<div class="rounded-md border border-(--border) bg-(--card) p-4">' +
        '<div class="text-xs text-(--muted-foreground)">Open transactions</div>' +
        '<div class="kpi mt-1 text-(--card-foreground)">—</div>' +
        '<div class="mt-1 text-xs text-(--muted-foreground)">inventory</div></div>',
    );
  });

  test('href renders an "Open <screen>" link, the value caption shows, and the tile is named label plus value', () => {
    view = render(
      <KpiTile
        label="Ready to dispatch"
        value="3"
        valueCaption="Today (IST)"
        secondary="7 days: 9"
        href="/outbound?status=accepted"
        linkText="Open Outbound"
      />,
    );
    const group = view.container.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Ready to dispatch: 3');
    const link = view.container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/outbound?status=accepted');
    expect(link.textContent).toBe('Open Outbound');
    expect(link.getAttribute('aria-label')).toContain('Ready to dispatch: 3');
    expect(view.container.textContent).toContain('Today (IST)');
    expect(view.container.textContent).toContain('7 days: 9');
  });

  test('unavailable reads the word, hides the captions', () => {
    view = render(<KpiTile label="Pick lines" value="No data" secondary="7 days: No data" unavailable />);
    expect(view.container.textContent).toContain('Unavailable');
    expect(view.container.textContent).not.toContain('7 days');
    expect(view.container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Pick lines: Unavailable');
  });
});

describe('FeedbackBanner warning tone', () => {
  test('is a status with its action slot', () => {
    view = render(
      <FeedbackBanner tone="warning" word="Figures may be stale" reason="old" action={<button type="button">Refresh</button>} />,
    );
    const banner = view.container.querySelector('[role="status"]')!;
    expect(banner.getAttribute('data-tone')).toBe('warning');
    expect(banner.className).toContain('border-(--warning)');
    expect(banner.querySelector('button')!.textContent).toBe('Refresh');
  });

  test('the original tones are unchanged (no action → no extra node)', () => {
    view = render(<FeedbackBanner tone="rejected" word="Not saved" reason="why" />);
    const banner = view.container.querySelector('[role="alert"]')!;
    expect(banner.children.length).toBe(2);
  });
});
