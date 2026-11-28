/**
 * A hidden settings fixture (`/__lounge/settings` and `/__lounge/settings/:section`): the `settings` template with
 * the shell's pieces (the dock, the user's card, the call bar) around placeholder sections, until the first real
 * settings screen (U1) is registered. With the design off it is the old shell's not-found page.
 *
 * The list path shows the list on a phone and the first section beside it at compact and wide; a section's path shows
 * that section (Back on a phone returns to the list). "Notifications" has a switch whose change pins the
 * unsaved-changes bar (`useSettingsFooter`), so the footer slot is exercised.
 */
import { useState, type JSX } from 'react';
import { Button, ListRow, Stack, Switch, Text, useWidthRange } from '../../../kit';
import type { LoungeParams, LoungeScreenProps, SettingsScreen } from '../screen';
import { useSettingsFooter } from '../screen';
import { LOUNGE_SETTINGS_FIXTURE_PATH, loungeSettingsFixturePath } from '../../loungeRoutes';
import { FIXTURE_LINKS } from './fixtureLinks';

const SECTIONS = [
  { id: 'general', name: 'General' },
  { id: 'notifications', name: 'Notifications' },
  { id: 'appearance', name: 'Appearance' },
] as const;

function sectionOf(params: LoungeParams) {
  return SECTIONS.find((section) => section.id === params.section) ?? SECTIONS[0];
}

function FixtureNav({ params }: LoungeScreenProps): JSX.Element {
  const current = sectionOf(params);
  // The list path names no section: a phone shows only the list, so nothing is chosen; beside the first section
  // (compact and wide) that section is the chosen row.
  const phone = useWidthRange() === 'phone';
  const chosen = params.section !== undefined || !phone;
  return (
    <Stack gap="xs">
      <ListRow primary="Back to the app" href="#/" />
      {SECTIONS.map((section) => (
        <ListRow
          key={section.id}
          primary={section.name}
          href={`#${loungeSettingsFixturePath(section.id)}`}
          selected={chosen && section.id === current.id}
          chevron
        />
      ))}
    </Stack>
  );
}

/** A change pins the unsaved-changes bar; Reset and Save take it away. */
function NotificationsSection(): JSX.Element {
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState(false);
  const dirty = draft !== saved;
  // Gone (another section, or out of settings): the bar goes with it.
  const footer = useSettingsFooter(
    dirty ? (
      <>
        <Text tone="secondary">1 unsaved change</Text>
        <Button variant="ghost" onClick={() => setDraft(saved)}>
          Reset
        </Button>
        <Button onClick={() => setSaved(draft)}>Save changes</Button>
      </>
    ) : null,
  );
  return (
    <>
      <Switch checked={draft} onChange={setDraft} label="Mention sounds" description="Play a sound when someone mentions you." />
      {footer}
    </>
  );
}

function FixtureContent({ params }: LoungeScreenProps): JSX.Element {
  const section = sectionOf(params);
  return (
    <Stack gap="md">
      <Text variant="section" as="h2">
        {section.name}
      </Text>
      {section.id === 'notifications' ? (
        <NotificationsSection />
      ) : (
        <div data-testid="lounge-settings-fixture-section">
          <Text tone="secondary">{`The ${section.name.toLowerCase()} settings go here.`}</Text>
        </div>
      )}
    </Stack>
  );
}

/** The list path's screen: a phone shows the list. */
export const settingsFixtureListScreen: SettingsScreen = {
  template: 'settings',
  place: 'none',
  phonePane: 'nav',
  Nav: FixtureNav,
  Content: FixtureContent,
  phoneBackTo: () => LOUNGE_SETTINGS_FIXTURE_PATH,
  useTitle: () => 'Settings',
  links: FIXTURE_LINKS,
};

/** A section's screen: a phone shows the section, with Back to the list. */
export const settingsFixtureSectionScreen: SettingsScreen = {
  ...settingsFixtureListScreen,
  phonePane: 'content',
};

/** Used by the list path's route: the section path's route loads the same module (`settingsFixtureSectionScreen`). */
export default settingsFixtureListScreen;

