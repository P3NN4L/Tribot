/**
 * Dock stylesheet: aligns with the composer card exactly like the built-in
 * @file rail, and uses DSH alias tokens so it follows light/dark appearance.
 */
let installed = false

const CSS = `
.tribot-role-dock {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px));
  max-width: var(--dsh-composer-card-max-width, 760px);
  min-width: 0;
  margin: 0 auto;
  padding: 2px 0;
  position: relative;
}

.tribot-role-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: border-color .12s ease, color .12s ease, background .12s ease;
}

.tribot-role-trigger:hover,
.tribot-role-trigger[aria-expanded='true'] {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}

.tribot-role-caret {
  font-size: 9px;
  opacity: .55;
}

.tribot-role-switch {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.tribot-role-track {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  transition: background .12s ease, border-color .12s ease;
}

.tribot-role-switch:hover .tribot-role-track {
  border-color: var(--dsw-alias-brand-primary);
}

.tribot-role-switch[aria-checked='true'] .tribot-role-track {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
}

.tribot-role-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  transition: left .12s ease, background .12s ease;
}

.tribot-role-switch[aria-checked='true'] .tribot-role-knob {
  left: 15px;
  background: var(--dsw-alias-bg-layer-1);
}

.tribot-role-note {
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
  font-size: 11px;
  opacity: .6;
}

.tribot-role-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 60;
  box-sizing: border-box;
  width: 270px;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
}

.tribot-role-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tribot-role-item:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent);
}

.tribot-role-item[aria-checked='true'] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}

.tribot-role-emoji {
  flex: none;
  width: 18px;
  text-align: center;
}

.tribot-role-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.tribot-role-name {
  font-size: 13px;
}

.tribot-role-desc {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
  font-size: 11px;
  opacity: .62;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

export function adoptStyles(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const style = document.createElement('style')
  style.dataset.tribotRolePicker = ''
  style.textContent = CSS
  document.head.append(style)
}
