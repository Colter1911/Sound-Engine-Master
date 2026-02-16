import { PlayerAudioEngine } from '@core/PlayerAudioEngine';
import { Logger } from '@utils/logger';

const MODULE_ID = 'sound-engine-master';

export class PlayerVolumePanel extends Application {
  private engine: PlayerAudioEngine;

  static override get defaultOptions() {
    const localizedTitle = game.i18n?.localize?.('ASE.UI.Panel.SoundVolume') ?? 'Sound Volume';

    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'ase-player-volume',
      title: localizedTitle,
      template: `modules/${MODULE_ID}/templates/player-volume.hbs`,
      classes: ['ase-player-panel'],
      width: 200,
      height: 'auto',
      resizable: false,
      minimizable: true,
      popOut: true
    }) as any;
  }

  constructor(engine: PlayerAudioEngine, options?: any) {
    super(options);
    this.engine = engine;
  }

  override getData() {
    return {
      volume: Math.round(this.engine.localVolume * 100)
    };
  }

  override activateListeners(html: JQuery): void {
    super.activateListeners(html);

    html.find('.ase-volume-slider').on('input', (event) => {
      const value = parseFloat((event.target as HTMLInputElement).value) / 100;
      this.engine.setLocalVolume(value);
      html.find('.ase-volume-value').text(`${Math.round(value * 100)}%`);

      // Save preference
      this.saveVolume(value);
    });
  }

  private saveVolume(value: number): void {
    localStorage.setItem(`${MODULE_ID}-player-volume`, String(value));
  }

  static loadSavedVolume(): number {
    const saved = localStorage.getItem(`${MODULE_ID}-player-volume`);
    return saved ? parseFloat(saved) : 1;
  }
}
