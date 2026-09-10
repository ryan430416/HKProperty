const LEGACY_KEYS = [
  'hkproperty_asset_overrides',
  'hkproperty_loan_records',
  'hkproperty_usage_records',
  'hkproperty_audit_records',
  'hkproperty_location_records',
  'hkproperty_images',
  'hkproperty_activity_records',
  'hkproperty.overrides',
  'hkproperty.usageLogs',
  'hkproperty.auditLogs',
  'hkproperty.locationLogs'
];

const UI_PREF_KEY = 'hkproperty_ui_prefs';

export function readUiPref(name, fallback) {
  try {
    const raw = localStorage.getItem(UI_PREF_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data[name] ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeUiPref(name, value) {
  try {
    const raw = localStorage.getItem(UI_PREF_KEY);
    const current = raw ? JSON.parse(raw) : {};
    current[name] = value;
    localStorage.setItem(UI_PREF_KEY, JSON.stringify(current));
  } catch {
    /* ignore quota */
  }
}

export function detectLegacyLocalData() {
  if (typeof localStorage === 'undefined') return { found: false, keys: [], bytes: 0 };
  const keys = LEGACY_KEYS.filter((key) => localStorage.getItem(key));
  let chars = 0;
  for (const key of keys) chars += (localStorage.getItem(key) || '').length;
  return { found: keys.length > 0, keys, bytes: chars * 2 };
}

export function clearLegacyLocalData() {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  return detectLegacyLocalData();
}
