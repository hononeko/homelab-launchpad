// Material Symbols offered by the icon picker. Any other valid symbol name can
// still be typed into the search box; these are just the common homelab ones.
export const ICON_GROUPS = [
  {
    label: 'Media',
    icons: [
      'play_circle', 'tv', 'movie', 'smart_display', 'live_tv', 'cast', 'music_note', 'library_music',
      'headphones', 'podcasts', 'photo_camera', 'photo_library', 'image', 'videocam', 'subtitles',
      'download', 'cloud_download', 'visibility', 'menu_book', 'auto_stories', 'sports_esports',
    ],
  },
  {
    label: 'Home',
    icons: [
      'home', 'home_iot_device', 'lightbulb', 'thermostat', 'sensors', 'camera_indoor', 'doorbell',
      'restaurant_menu', 'local_bar', 'kitchen', 'shopping_cart', 'receipt_long', 'savings',
      'calendar_month', 'event', 'pets', 'yard', 'energy_savings_leaf', 'solar_power', 'bolt',
    ],
  },
  {
    label: 'Ops',
    icons: [
      'monitoring', 'speed', 'dns', 'hub', 'account_tree', 'health_and_safety', 'security', 'shield',
      'fingerprint', 'key', 'lock', 'vpn_key', 'notifications', 'published_with_changes', 'sync',
      'backup', 'hard_drive', 'storage', 'database', 'memory', 'developer_board', 'cloud',
    ],
  },
  {
    label: 'Dev',
    icons: [
      'terminal', 'code', 'data_object', 'build', 'construction', 'bug_report', 'integration_instructions',
      'api', 'webhook', 'auto_mode', 'smart_toy', 'psychology', 'draw', 'edit_note', 'description',
      'picture_as_pdf', 'task_alt', 'checklist', 'bookmark', 'rss_feed', 'chat', 'mail',
    ],
  },
  {
    label: 'Network',
    icons: [
      'router', 'lan', 'wifi', 'alt_route', 'public', 'language', 'travel_explore', 'settings_ethernet',
      'cell_tower', 'satellite_alt', 'vpn_lock', 'network_check', 'dns', 'cloud_sync',
    ],
  },
] as const;

export type IconGroupLabel = (typeof ICON_GROUPS)[number]['label'];

/** Every catalogued icon once, in group order. */
export const ALL_ICONS: readonly string[] = [...new Set(ICON_GROUPS.flatMap((group) => group.icons))];

// Same rule the server applies to stored icons
export const ICON_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;
