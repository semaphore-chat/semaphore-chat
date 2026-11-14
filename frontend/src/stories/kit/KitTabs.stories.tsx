import { useState } from 'react';
import { Tabs, type TabItem, type TabsProps } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

const BASIC: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'nothing', label: 'Nothing' },
];
const COUNTS: TabItem[] = [
  { id: 'all', label: 'All', count: 24 },
  { id: 'mentions', label: 'Mentions', count: 3 },
  { id: 'threads', label: 'Threads', count: 0 },
  { id: 'muted', label: 'Muted', disabled: true },
];
const MANY: TabItem[] = ['General', 'Voice', 'Members', 'Roles', 'Invites', 'Integrations', 'Moderation', 'Audit log'].map(
  (label) => ({ id: label, label }),
);

function Demo({ tabs, initial, ...rest }: { tabs: TabItem[]; initial: string } & Pick<TabsProps, 'variant' | 'fullWidth'>) {
  const [value, setValue] = useState(initial);
  return <Tabs label="Demo" tabs={tabs} value={value} onChange={setValue} {...rest} />;
}

/** Underline tabs. */
export const Underline = () => (
  <KitStage mode="dark">
    <Row label="underline">
      <Demo tabs={BASIC} initial="mentions" />
    </Row>
    <Row label="underline, full width">
      <div style={{ width: '100%' }}>
        <Demo tabs={BASIC} initial="all" fullWidth />
      </div>
    </Row>
  </KitStage>
);

/** Segmented control. */
export const Segmented = () => (
  <KitStage mode="dark">
    <Row label="segmented">
      <Demo tabs={BASIC} initial="mentions" variant="segmented" />
    </Row>
    <Row label="segmented, full width">
      <div style={{ width: '100%' }}>
        <Demo tabs={BASIC} initial="all" variant="segmented" fullWidth />
      </div>
    </Row>
  </KitStage>
);

/** Counts and a disabled tab, in both variants. */
export const WithCounts = () => (
  <KitStage mode="dark">
    <Row label="underline">
      <Demo tabs={COUNTS} initial="all" />
    </Row>
    <Row label="segmented">
      <Demo tabs={COUNTS} initial="mentions" variant="segmented" />
    </Row>
  </KitStage>
);

/** Eight tabs in a 320px box: the row scrolls inside the box. */
export const Overflow = () => (
  <KitStage mode="dark">
    <div style={{ width: 320 }}>
      <Demo tabs={MANY} initial="Roles" />
    </div>
    <div style={{ width: 320 }}>
      <Demo tabs={MANY} initial="Audit log" variant="segmented" />
    </div>
  </KitStage>
);

/** Both variants in light mode. */
export const SegmentedLight = () => (
  <KitStage mode="light">
    <Demo tabs={COUNTS} initial="all" />
    <Demo tabs={BASIC} initial="mentions" variant="segmented" />
  </KitStage>
);

/** Both variants in the tinted palette (teal, vibrant). */
export const SegmentedTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Demo tabs={COUNTS} initial="all" />
    <Demo tabs={BASIC} initial="mentions" variant="segmented" />
  </KitStage>
);
