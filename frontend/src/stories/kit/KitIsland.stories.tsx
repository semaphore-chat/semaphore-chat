import type { JSX } from 'react';
import { Avatar, Card, IconButton, Island, Stack, Text } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

/**
 * The Lounge frame without content. Three columns cannot fit at 390 px, so below the phone
 * breakpoint the story shows only the middle island; the real phone layout is the shell's job.
 * (A story file may compute sizes from tokens, and a media query cannot read them, so the
 * breakpoint value is interpolated here.)
 */
const FRAME_CSS = `@media (max-width: ${tokens.breakpoint.phone}px) { .kit-island-side { display: none !important; } }`;

function LayoutBody(): JSX.Element {
  const side = (width: number) => ({
    width,
    flex: `0 0 ${width}px`,
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
  });
  return (
    <div style={{ flex: 1, display: 'flex', gap: tokens.layout.gutter, minHeight: 0, minWidth: 0 }}>
      <style>{FRAME_CSS}</style>
      <div className="kit-island-side" style={side(tokens.layout.leftColumn)}>
        <Island as="aside" label="Left island" scroll>
          <Text variant="section">Left island</Text>
          <Text variant="meta" tone="secondary">{tokens.layout.leftColumn} px column</Text>
        </Island>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Island as="main" label="Middle island" scroll>
          <Text variant="section">Middle island</Text>
          <Text variant="meta" tone="secondary">Flexible</Text>
        </Island>
      </div>
      <div className="kit-island-side" style={side(tokens.layout.rightColumn)}>
        <Island as="aside" label="Right island" scroll>
          <Text variant="section">Right island</Text>
          <Text variant="meta" tone="secondary">{tokens.layout.rightColumn} px column</Text>
        </Island>
      </div>
    </div>
  );
}

export const Layout = () => (
  <KitStage mode="dark">
    <LayoutBody />
  </KitStage>
);

export const LayoutLight = () => (
  <KitStage mode="light">
    <LayoutBody />
  </KitStage>
);

export const LayoutTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <LayoutBody />
  </KitStage>
);

const lines = Array.from({ length: 24 }, (_, index) => `Message ${index + 1}: the island scrolls, the page does not.`);

/** A fixed-height island with long content: the content scrolls inside it. */
export const Scrolling = () => (
  <KitStage mode="dark">
    <div style={{ height: 320, maxWidth: 420 }}>
      <Island scroll label="Messages">
        {lines.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Island>
    </div>
  </KitStage>
);

function FooterBody({ count }: { count: number }): JSX.Element {
  return (
    <div style={{ height: 360, width: tokens.layout.leftColumn, maxWidth: '100%' }}>
      <Island as="nav" label="Couch Co-op" padding="md" scroll
        footer={
          <Card>
            <Stack direction="row" gap="sm">
              <Avatar name="alexk" presence="online" />
              <Stack gap="xs" fill>
                <Text variant="name" truncate>alexk</Text>
                <Text variant="meta" tone="secondary" truncate>In Squad Up</Text>
              </Stack>
              <IconButton icon="Settings" label="Settings" size="sm" />
            </Stack>
          </Card>
        }
      >
        {lines.slice(0, count).map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Island>
    </div>
  );
}

/** `footer`: the user's card stays at the island's foot while the content above it scrolls; with little content it still sits at the foot. */
export const WithFooter = () => (
  <KitStage mode="dark">
    <Row label="long content: only the body scrolls">
      <FooterBody count={24} />
    </Row>
    <Row label="short content: the footer stays at the foot">
      <FooterBody count={3} />
    </Row>
  </KitStage>
);

/** The same, light. */
export const WithFooterLight = () => (
  <KitStage mode="light">
    <FooterBody count={24} />
  </KitStage>
);

/** The same, tinted. */
export const WithFooterTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <FooterBody count={24} />
  </KitStage>
);

export const Paddings = () => (
  <KitStage mode="dark">
    <Row label="padding none, md, lg">
      {(['none', 'md', 'lg'] as const).map((padding) => (
        <div key={padding} style={{ width: 160 }}>
          <Island padding={padding}>
            <Text variant="meta">{padding}</Text>
          </Island>
        </div>
      ))}
    </Row>
  </KitStage>
);
