import type { MsgKey } from '../i18n';
import { AgendaIcon, SettingsIcon, StatsIcon, TodayIcon } from './icons';

export type NavTab = 'today' | 'agenda' | 'stats' | 'settings';

export const NAV_ITEMS: {
  key: NavTab;
  labelKey: MsgKey;
  Icon: (props: { active?: boolean }) => React.JSX.Element;
}[] = [
  { key: 'today', labelKey: 'nav.today', Icon: TodayIcon },
  { key: 'agenda', labelKey: 'nav.agenda', Icon: AgendaIcon },
  { key: 'stats', labelKey: 'nav.stats', Icon: StatsIcon },
  { key: 'settings', labelKey: 'nav.settings', Icon: SettingsIcon },
];
