import type { TrackGroup } from './audio';

/**
 * Режимы воспроизведения
 */
export type PlaybackMode = 'single' | 'linear' | 'loop' | 'random' | 'inherit';

/**
 * Library Item - звук в библиотеке
 */
export interface LibraryItem {
  id: string;                    // UUID v4
  url: string;                   // Путь к аудио файлу
  name: string;                  // Отображаемое имя
  tags: string[];                // Теги для фильтрации
  group: TrackGroup;             // Канал звука: music/ambience/sfx
  duration: number;              // Длительность в секундах
  favorite: boolean;             // Помечен как избранный
  playbackMode: PlaybackMode;    // Режим воспроизведения
  addedAt: number;               // Timestamp добавления
  updatedAt: number;             // Timestamp последнего изменения
  metadata?: LibraryItemMetadata; // Опциональные метаданные
}

/**
 * Метаданные аудио файла
 */
export interface LibraryItemMetadata {
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  description?: string;
  picture?: string;              // Base64 string or URL to cover art
  waveform?: number[];           // Для визуализации волны
}

/**
 * Playlist - плейлист
 */
export interface Playlist {
  id: string;                    // UUID v4
  name: string;                  // Название плейлиста
  description?: string;          // Описание
  items: PlaylistItem[];         // Элементы плейлиста
  createdAt: number;             // Timestamp создания
  updatedAt: number;             // Timestamp последнего изменения
  favorite: boolean;             // Помечен как избранный
  playbackMode: Exclude<PlaybackMode, 'single' | 'inherit'>; // Режим воспроизведения
}

/**
 * Элемент плейлиста - ссылка на LibraryItem с настройками воспроизведения
 */
export interface PlaylistItem {
  id: string;                    // UUID v4 элемента плейлиста
  libraryItemId: string;         // UUID ссылка на LibraryItem
  group: TrackGroup;             // music/ambience/sfx
  volume: number;                // Громкость трека (0-1)

  order: number;                 // Порядок в плейлисте (0-based)
  fadeIn?: number;               // Fade in время в секундах
  fadeOut?: number;              // Fade out время в секундах
}

/**
 * Состояние библиотеки для хранения
 */
export interface LibraryState {
  items: Record<string, LibraryItem>;      // Map ID -> LibraryItem
  playlists: Record<string, Playlist>;     // Map ID -> Playlist
  customTags?: string[];                   // Persistent list of custom tags (even if unused)
  favoritesOrder?: Array<{ id: string, type: 'track' | 'playlist', addedAt: number }>; // Sorted order
  version: number;                         // Версия схемы данных
  lastModified: number;                    // Timestamp последнего изменения
}

/**
 * Фильтры для поиска в библиотеке
 */
export interface LibraryFilter {
  query?: string;                // Текстовый поиск по имени
  tags?: string[];               // Фильтр по тегам (OR)
  favoriteOnly?: boolean;        // Только избранные
  group?: TrackGroup;            // Фильтр по группе
  sortBy?: LibrarySortField;     // Поле сортировки
  sortOrder?: 'asc' | 'desc';    // Порядок сортировки
}

/**
 * Поля для сортировки библиотеки
 */
export type LibrarySortField = 'name' | 'addedAt' | 'updatedAt' | 'duration';

/**
 * Результат поиска в библиотеке
 */
export interface LibrarySearchResult {
  items: LibraryItem[];
  total: number;
  hasMore: boolean;
}

/**
 * Статистика библиотеки
 */
export interface LibraryStats {
  totalItems: number;
  totalPlaylists: number;
  totalDuration: number;         // Суммарная длительность всех треков
  favoriteItems: number;
  tagCount: number;              // Count of unique tags
  itemsByGroup: Record<TrackGroup, number>;
  storageSize?: number;          // Примерный размер в байтах (если известен)
}
