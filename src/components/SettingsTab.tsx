import { ACCENTS, type Accent } from '../accent';
import { LANGS, useT, type Lang, type MsgKey } from '../i18n';
import type { NotificationSetting } from '../useNotificationSetting';
import { MoonIcon, SunIcon } from './icons';

/**
 * Pestaña "Ajustes": versión de página completa de lo que antes eran los
 * menús desplegables "Ver" (ítems de datos: recurrentes/plantillas/
 * etiquetas/calendarios) y "⋮" (todo lo demás) en el header. Mismos
 * handlers/estado que ya vivían en App.tsx — esto es solo presentación.
 */
export default function SettingsTab({
  theme,
  onToggleTheme,
  accent,
  onChooseAccent,
  lang,
  onSetLang,
  soundsEnabled,
  onToggleSounds,
  notifications,
  carryOverAuto,
  onToggleCarryOverAuto,
  showWeekend,
  onToggleWeekend,
  pomodoroEnabled,
  onTogglePomodoro,
  onOpenTimerSettings,
  onOpenRecurring,
  onOpenTemplates,
  onOpenTags,
  onOpenFeeds,
  onOpenBackup,
  multiFile,
  onOpenContextOrder,
  isAdmin,
  onOpenAdmin,
  onRefresh,
  refreshing,
  onFocusMode,
  authEmail,
  onLogout,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  accent: Accent;
  onChooseAccent: (a: Accent) => void;
  lang: Lang;
  onSetLang: (l: Lang) => void;
  soundsEnabled: boolean;
  onToggleSounds: () => void;
  notifications: NotificationSetting;
  carryOverAuto: boolean;
  onToggleCarryOverAuto: () => void;
  showWeekend: boolean;
  onToggleWeekend: () => void;
  pomodoroEnabled: boolean;
  onTogglePomodoro: () => void;
  onOpenTimerSettings: () => void;
  onOpenRecurring: () => void;
  onOpenTemplates: () => void;
  onOpenTags: () => void;
  onOpenFeeds: () => void;
  onOpenBackup: () => void;
  multiFile: boolean;
  onOpenContextOrder: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onFocusMode: () => void;
  authEmail: string | null;
  onLogout: () => void;
}) {
  const t = useT();

  const notificationsState =
    notifications.permission === 'denied'
      ? t('menu.notificationsBlocked')
      : notifications.enabled
        ? t('common.yes')
        : t('common.no');

  return (
    <div className="stats-tab">
      <div className="stats-tab-header">
        <h2>{t('nav.settings')}</h2>
      </div>

      <Section title={t('settings.appearance')}>
        <Row label={t('app.toggleTheme')} onClick={onToggleTheme}>
          <span className="settings-row-state">
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </span>
        </Row>
        <Row label={t('menu.language')} onClick={() => onSetLang(lang === 'es' ? 'en' : 'es')} state={LANGS.find((l) => l.code === lang)?.label} />
      </Section>

      <div className="settings-section">
        <div className="settings-section-title">{t('menu.accent')}</div>
        <div className="accent-row" role="group" aria-label={t('menu.accent')}>
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={accent === a.key ? 'accent-swatch is-on' : 'accent-swatch'}
              data-accent={a.key}
              title={t(`accent.${a.key}` as MsgKey)}
              aria-label={t(`accent.${a.key}` as MsgKey)}
              aria-pressed={accent === a.key}
              onClick={() => onChooseAccent(a.key)}
            />
          ))}
        </div>
      </div>

      <Section title={t('settings.behavior')}>
        <Row label={t('menu.sounds')} onClick={onToggleSounds} state={soundsEnabled ? t('common.yes') : t('common.no')} />
        {notifications.permission !== 'unsupported' && (
          <Row
            label={t('menu.notifications')}
            onClick={() => void notifications.toggle()}
            disabled={notifications.permission === 'denied'}
            state={notificationsState}
          />
        )}
        <Row label={t('menu.carryOverAuto')} onClick={onToggleCarryOverAuto} state={carryOverAuto ? t('common.yes') : t('common.no')} />
        <Row label={t('menu.showWeekend')} onClick={onToggleWeekend} state={showWeekend ? t('common.yes') : t('common.no')} />
        <Row label={t('menu.usePomodoro')} onClick={onTogglePomodoro} state={pomodoroEnabled ? t('common.yes') : t('common.no')} />
        {pomodoroEnabled && <Row label={t('menu.pomodoroSettings')} onClick={onOpenTimerSettings} />}
        <Row label={t('menu.focusMode')} onClick={onFocusMode} />
      </Section>

      <Section title={t('settings.data')}>
        <Row label={t('menu.recurring')} onClick={onOpenRecurring} />
        <Row label={t('menu.templates')} onClick={onOpenTemplates} />
        <Row label={t('menu.tags')} onClick={onOpenTags} />
        <Row label={t('menu.feeds')} onClick={onOpenFeeds} />
        {multiFile && <Row label={t('menu.contextOrder')} onClick={onOpenContextOrder} />}
        <Row label={t('menu.backup')} onClick={onOpenBackup} />
        <Row label={t('app.refresh')} onClick={onRefresh} disabled={refreshing} />
      </Section>

      <Section title={t('settings.account')}>
        {isAdmin && <Row label={t('menu.approveUsers')} onClick={onOpenAdmin} />}
        <Row label={t('menu.logout')} onClick={onLogout} danger />
      </Section>

      {authEmail && <p className="settings-user">{authEmail}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      <div className="settings-list">{children}</div>
    </div>
  );
}

function Row({
  label,
  onClick,
  state,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  state?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={danger ? 'settings-row settings-row--danger' : 'settings-row'}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{label}</span>
      {children ?? (state != null && <span className="settings-row-state">{state}</span>)}
    </button>
  );
}
