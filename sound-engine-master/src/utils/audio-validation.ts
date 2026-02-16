/**
 * Поддерживаемые аудио форматы
 */
export const SUPPORTED_AUDIO_FORMATS = [
  '.mp3',
  '.ogg',
  '.wav',
  '.webm',
  '.m4a',
  '.aac',
  '.flac',
  '.opus'
] as const;

export type SupportedAudioFormat = typeof SUPPORTED_AUDIO_FORMATS[number];

/**
 * MIME типы для поддерживаемых форматов
 */
export const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus'
};

/**
 * Проверка, является ли файл поддерживаемым аудио форматом
 */
export function isValidAudioFormat(url: string): boolean {
  const extension = getFileExtension(url);
  return SUPPORTED_AUDIO_FORMATS.includes(extension as SupportedAudioFormat);
}

/**
 * Получить расширение файла из URL
 */
export function getFileExtension(url: string): string {
  try {
    // Decode URL first
    const decoded = decodeURIComponent(url);

    // Remove query parameters and hash
    const cleanUrl = decoded.split('?')[0].split('#')[0];

    // Extract extension
    const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
    return match ? `.${match[1].toLowerCase()}` : '';
  } catch {
    return '';
  }
}

/**
 * Получить MIME тип для аудио файла
 */
export function getAudioMimeType(url: string): string | null {
  const extension = getFileExtension(url);
  return AUDIO_MIME_TYPES[extension] || null;
}

/**
 * Валидация результата с деталями ошибки
 */
export interface AudioValidationResult {
  valid: boolean;
  error?: string;
  extension?: string;
  mimeType?: string;
}

/**
 * Полная валидация аудио файла
 */
export function validateAudioFile(url: string): AudioValidationResult {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'URL is required and must be a string'
    };
  }

  const extension = getFileExtension(url);

  if (!extension) {
    return {
      valid: false,
      error: 'Could not extract file extension from URL'
    };
  }

  if (!isValidAudioFormat(url)) {
    return {
      valid: false,
      error: `Unsupported audio format: ${extension}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
      extension
    };
  }

  const mimeType = getAudioMimeType(url);

  return {
    valid: true,
    extension,
    mimeType: mimeType || undefined
  };
}

/**
 * Проверка поддержки формата браузером
 */
export function isBrowserAudioSupported(extension: string): boolean {
  if (typeof Audio === 'undefined') {
    return false;
  }

  const mimeType = AUDIO_MIME_TYPES[extension];
  if (!mimeType) {
    return false;
  }

  const audio = new Audio();
  const canPlay = audio.canPlayType(mimeType);

  // Returns: '' (no support), 'maybe', 'probably'
  return canPlay === 'probably' || canPlay === 'maybe';
}
