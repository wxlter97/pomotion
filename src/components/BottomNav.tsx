import { useT } from '../i18n';
import { PlusIcon } from './icons';
import { NAV_ITEMS, type NavTab } from './navItems';

/**
 * Tab bar inferior (mobile): Hoy / Agenda / + (FAB) / Stats / Ajustes.
 * Oculta en desktop y en modo foco vía CSS (ver .bottom-nav en styles.css).
 */
export default function BottomNav({
  active,
  onSelect,
  onAdd,
  showAdd,
}: {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  onAdd: () => void;
  showAdd: boolean;
}) {
  const t = useT();
  const [first, second, ...rest] = NAV_ITEMS;

  function renderItem(item: (typeof NAV_ITEMS)[number]) {
    const isActive = active === item.key;
    return (
      <button
        key={item.key}
        type="button"
        className={isActive ? 'nav-item active' : 'nav-item'}
        onClick={() => onSelect(item.key)}
        aria-current={isActive ? 'page' : undefined}
      >
        <item.Icon active={isActive} />
        <span>{t(item.labelKey)}</span>
      </button>
    );
  }

  return (
    <nav className="bottom-nav" aria-label={t('nav.label')}>
      {renderItem(first)}
      {renderItem(second)}
      <div className="nav-fab-slot">
        {showAdd && (
          <button type="button" className="fab" onClick={onAdd} aria-label={t('nav.add')} title={t('nav.add')}>
            <PlusIcon />
          </button>
        )}
      </div>
      {rest.map(renderItem)}
    </nav>
  );
}
