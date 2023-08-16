export enum InvidiousApiResources {
  PLAYLISTS = 'auth/playlists',
  PLAYLIST_ITEMS = 'playlists/{playlist_id}',
  VIDEO_DETAILS = 'videos/{video_id}',
  TRENDING = 'trending',
  SEARCH = 'search',
  STATS = 'stats',
  CHANNELS = 'channels/{channel_id}',
  CHANNEL_VIDEOS = 'channels/{channel_id}/videos',
}

export enum HotkeyEvents {
  PLAY = 0,
  PAUSE = 1,
  PLAY_TOGGLE = 2,
  MUTE_ACTIVE = 3,
  MUTE_INACTIVE = 4,
  MUTE_TOGGLE = 5,
  VOLUME_INC = 6,
  VOLUME_DEC = 7,
  REPEAT_ACTIVE = 8,
  REPEAT_INACTIVE = 9,
  REPEAT_TOGGLE = 10,
  QUEUE_OPEN = 11,
  QUEUE_CLOSE = 12,
  QUEUE_TOGGLE = 13,
  RELOAD_PAGE = 14,
  DEVTOOLS_TOGGLE = 15,
  HELP = 16,
  FULLSCREEN = 17,
}

export const HotKeyEventsExtras: Record<HotkeyEvents, { title: string }> = {
  [HotkeyEvents.PLAY]: {
    title: 'Play song',
  },
  [HotkeyEvents.PAUSE]: {
    title: 'Pause song',
  },
  [HotkeyEvents.PLAY_TOGGLE]: {
    title: 'Toggle play',
  },
  [HotkeyEvents.MUTE_ACTIVE]: {
    title: 'Mute',
  },
  [HotkeyEvents.MUTE_INACTIVE]: {
    title: 'Unmute',
  },
  [HotkeyEvents.MUTE_TOGGLE]: {
    title: 'Toggle mute',
  },
  [HotkeyEvents.VOLUME_INC]: {
    title: 'Increase volume',
  },
  [HotkeyEvents.VOLUME_DEC]: {
    title: 'Decrease volume',
  },
  [HotkeyEvents.REPEAT_ACTIVE]: {
    title: 'Repeat song',
  },
  [HotkeyEvents.REPEAT_INACTIVE]: {
    title: 'Disable repeat',
  },
  [HotkeyEvents.REPEAT_TOGGLE]: {
    title: 'Toggle repeat',
  },
  [HotkeyEvents.QUEUE_OPEN]: {
    title: 'Open song queue',
  },
  [HotkeyEvents.QUEUE_CLOSE]: {
    title: 'Close song queue',
  },
  [HotkeyEvents.QUEUE_TOGGLE]: {
    title: 'Toggle song queue',
  },
  [HotkeyEvents.RELOAD_PAGE]: {
    title: 'Reload page',
  },
  [HotkeyEvents.DEVTOOLS_TOGGLE]: {
    title: 'Toggle dev-tools',
  },
  [HotkeyEvents.HELP]: {
    title: 'Open help',
  },
  [HotkeyEvents.FULLSCREEN]: {
    title: 'Fullscreen',
  },
}

export const defaultKeybinds: HotkeyPair[] = [
  {
    key: [['Space']],
    value: HotkeyEvents.PLAY_TOGGLE,
  },
  {
    key: [['ShiftLeft', 'Equal'], ['NumpadAdd']],
    value: HotkeyEvents.VOLUME_INC,
  },
  {
    key: [['NumpadSubtract'], ['Minus']],
    value: HotkeyEvents.VOLUME_DEC,
  },
  {
    key: [['KeyM']],
    value: HotkeyEvents.MUTE_TOGGLE,
  },
  {
    key: [['KeyR']],
    value: HotkeyEvents.REPEAT_TOGGLE,
  },
  {
    key: [['F5']],
    value: HotkeyEvents.RELOAD_PAGE,
  },
  {
    key: [['ControlLeft', 'ShiftLeft', 'KeyI']],
    value: HotkeyEvents.DEVTOOLS_TOGGLE,
  },
  {
    key: [['F11']],
    value: HotkeyEvents.FULLSCREEN,
  },
  {
    key: [['F1']],
    value: HotkeyEvents.HELP,
  },
  {
    key: [['Escape']],
    value: HotkeyEvents.QUEUE_CLOSE,
  },
]

export enum ProviderScopes {
  SEARCH = 0,
  PLAYLISTS = 1,
  PLAYLIST_SONGS = 2,
  ARTIST_SONGS = 3,
  ALBUM_SONGS = 4,
  RECOMMENDATIONS = 5,
  SCROBBLES = 6,
  PLAYLIST_FROM_URL = 7,
  SONG_FROM_URL = 8,
  SEARCH_ALBUM = 9,
  SEARCH_ARTIST = 10,
}

export const FAVORITES_PLAYLIST_ID = 'favorites_playlist'

export enum VolumePersistMode {
  SINGLE = 'SINGLE',
  SEPARATE_VOLUME_MAP = 'SEPARATE_VOLUME_MAP',
  CLAMP_MAP = 'CLAMP_MAP',
}

export enum ScanStatus {
  UNDEFINED = 0,
  SCANNING = 1,
  QUEUED = 2,
}
