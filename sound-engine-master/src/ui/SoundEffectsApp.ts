import { AudioEngine } from '@core/AudioEngine';
import { SocketManager } from '@sync/SocketManager';
import { GlobalStorage } from '@storage/GlobalStorage';
import type { EffectType, EffectParam, EffectPreset } from '@t/effects';
import { BUILTIN_PRESETS } from '@core/effects/presets';

import type { TrackGroup } from '@t/audio';
import { Logger } from '@utils/logger';

const MODULE_ID = 'sound-engine-master';

// ─── Effect Metadata ──────────────────────────────────────────

const ALL_EFFECT_TYPES: EffectType[] = ['filter', 'compressor', 'distortion', 'delay', 'reverb'];

const EFFECT_META: Record<string, { label: string; icon: string }> = {
    filter: { label: 'ASE.UI.EffectType.filter', icon: 'fa-wave-square' },
    compressor: { label: 'ASE.UI.EffectType.compressor', icon: 'fa-compress' },
    distortion: { label: 'ASE.UI.EffectType.distortion', icon: 'fa-bolt' },
    delay: { label: 'ASE.UI.EffectType.delay', icon: 'fa-clock' },
    reverb: { label: 'ASE.UI.EffectType.reverb', icon: 'fa-water' },
    modulation: { label: 'ASE.UI.EffectType.modulation', icon: 'fa-wave-square' },
};

// ─── View Data Types ───────────────────────────────────────────

interface ParamViewData {
    id: string;
    name: string;
    type: 'float' | 'boolean' | 'select';
    value: number | boolean | string;
    displayValue: string;
    fillPercent: number;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    options?: { label: string; value: string }[];
}

interface PedalViewData {
    type: EffectType;
    enabled: boolean;
    mix: number;
    mixPercent: number;
    mixRotation: number;
    chainIndex: number;
    selected: boolean;
    params: ParamViewData[];
}

interface AvailableEffectData {
    type: EffectType;
    label: string;
    icon: string;
}

interface EffectsViewData {
    activeChannel: TrackGroup;
    pedals: PedalViewData[];
    selectedEffect: PedalViewData | null;
    musicActiveCount: number;
    ambienceActiveCount: number;
    sfxActiveCount: number;
    builtinPresets: EffectPreset[];
    customPresets: EffectPreset[];
    availableEffects: AvailableEffectData[];
    constructorOpen: boolean;
    chainBypassed: boolean;
}

// ─── Controller ────────────────────────────────────────────────

export class SoundEffectsApp {
    private engine: AudioEngine;
    private socket: SocketManager;
    private html: JQuery | null = null;
    private renderParent: (() => void) | null = null;
    private isPedalKnobDragging: boolean = false;

    private activeChannel: TrackGroup = 'music';
    private selectedEffectType: EffectType | null = null;
    private constructorOpen: boolean = false;

    constructor(engine: AudioEngine, socket: SocketManager) {
        this.engine = engine;
        this.socket = socket;
    }

    setRenderCallback(callback: () => void): void {
        this.renderParent = callback;
    }

    // ─────────────────────────────────────────────────────────────
    // Data Provider
    // ─────────────────────────────────────────────────────────────

    async getData(): Promise<EffectsViewData> {
        try {
            const chain = this.engine.getChain(this.activeChannel);
            const effects = chain.getEffects();

            const pedals: PedalViewData[] = effects.map((effect, index) => {
                const state = effect.getChainState();
                const mixPercent = Math.round(state.mix * 100);
                const mixRotation = (state.mix * 270) - 135;

                const params: ParamViewData[] = [];
                for (const [key, param] of effect.getAllParams()) {
                    if (key === 'level') continue;
                    const fillPercent = (param.type === 'float' && param.min !== undefined && param.max !== undefined)
                        ? ((Number(param.value) - param.min) / (param.max - param.min)) * 100
                        : 50;
                    params.push({
                        id: param.id,
                        name: param.name,
                        type: param.type,
                        value: param.value,
                        displayValue: this.formatParamValue(param),
                        fillPercent: Math.round(fillPercent),
                        min: param.min,
                        max: param.max,
                        step: param.step,
                        suffix: param.suffix,
                        options: param.options,
                    });
                }

                return {
                    type: state.type,
                    enabled: state.enabled,
                    mix: state.mix,
                    mixPercent,
                    mixRotation,
                    chainIndex: index,
                    selected: state.type === this.selectedEffectType,
                    params,
                };
            });

            // Determine which effect types are not in the current chain
            const usedTypes = new Set(effects.map(e => e.type));
            const availableEffects: AvailableEffectData[] = ALL_EFFECT_TYPES
                .filter(t => !usedTypes.has(t))
                .map(t => ({
                    type: t,
                    label: EFFECT_META[t]?.label || t,
                    icon: EFFECT_META[t]?.icon || 'fa-circle',
                }));

            // Load presets
            const allPresets = await GlobalStorage.loadPresets();
            const builtinPresets = allPresets.filter(p => p.builtIn);
            const customPresets = allPresets.filter(p => !p.builtIn);

            return {
                activeChannel: this.activeChannel,
                pedals,
                selectedEffect: pedals.find(p => p.selected) || null,
                musicActiveCount: this.engine.getChain('music').getActiveCount(),
                ambienceActiveCount: this.engine.getChain('ambience').getActiveCount(),
                sfxActiveCount: this.engine.getChain('sfx').getActiveCount(),
                builtinPresets,
                customPresets,
                availableEffects,
                constructorOpen: this.constructorOpen,
                chainBypassed: chain.isBypassed,
            };
        } catch (error) {
            Logger.error('SoundEffectsApp getData failed:', error);
            return {
                activeChannel: this.activeChannel,
                pedals: [],
                selectedEffect: null,
                musicActiveCount: 0,
                ambienceActiveCount: 0,
                sfxActiveCount: 0,
                builtinPresets: [...BUILTIN_PRESETS],
                customPresets: [],
                availableEffects: ALL_EFFECT_TYPES.map(t => ({
                    type: t,
                    label: EFFECT_META[t]?.label || t,
                    icon: EFFECT_META[t]?.icon || 'fa-circle',
                })),
                constructorOpen: this.constructorOpen,
                chainBypassed: false, // Fallback
            };
        }
    }

    private formatParamValue(param: EffectParam): string {
        if (param.type === 'select') return String(param.value);
        if (param.type === 'boolean') return param.value ? game.i18n!.localize('ASE.UI.Common.On') : game.i18n!.localize('ASE.UI.Common.Off');
        const num = Number(param.value);
        const formatted = Number.isInteger(num) ? num.toString() : num.toFixed(2);
        return param.suffix ? `${formatted}${param.suffix}` : formatted;
    }

    // ─────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────

    activateListeners(html: JQuery): void {
        this.html = html;

        // Channel tabs
        html.off('click', '.ase-channel-tab').on('click', '.ase-channel-tab', (e) => this.onChannelSwitch(e));

        // Master bypass
        html.off('click', '[data-action="toggle-chain-bypass"]').on('click', '[data-action="toggle-chain-bypass"]', (e) => this.onToggleChainBypass(e));

        // Pedal card click → select
        html.off('click', '.ase-pedal-card').on('click', '.ase-pedal-card', (e) => this.onPedalSelect(e));

        // Footswitch → toggle bypass (stop propagation to avoid select)
        html.off('click', '.ase-pedal-footswitch').on('click', '.ase-pedal-footswitch', (e) => {
            e.stopPropagation();
            this.onToggleBypass(e);
        });

        // Remove effect from chain
        html.off('click', '.ase-pedal-remove').on('click', '.ase-pedal-remove', (e) => {
            e.stopPropagation();
            this.onRemoveEffect(e);
        });

        // Constructor panel
        html.off('click', '[data-action="open-constructor"]').on('click', '[data-action="open-constructor"]', () => this.onOpenConstructor());
        html.off('click', '[data-action="close-constructor"]').on('click', '[data-action="close-constructor"]', () => this.onCloseConstructor());
        html.off('click', '[data-action="add-effect"]').on('click', '[data-action="add-effect"]', (e) => this.onAddEffect(e));

        // Pedal knob drag (mix on card)
        html.find('.ase-pedal-knob, .ase-pedal-knob *').prop('draggable', false);
        html.find('.ase-pedal-knob-area, .ase-pedal-knob-area *').on('dragstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        html.find('.ase-pedal-knob').on('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.onKnobDrag(e, 'pedal');
        });

        // Detail panel mix knob drag
        html.find('.ase-detail-knob').on('mousedown', (e) => this.onKnobDrag(e, 'detail'));

        // Detail panel sliders
        html.find('.ase-detail-slider').on('input', (e) => this.onDetailParamSlider(e));

        // Detail panel segmented buttons
        html.off('click', '.ase-seg-btn').on('click', '.ase-seg-btn', (e) => this.onDetailParamSelect(e));

        // Presets
        html.find('#ase-preset-select').on('change', (e) => this.onLoadPreset(e));
        html.off('click', '[data-action="save-preset"]').on('click', '[data-action="save-preset"]', (e) => this.onSavePreset(e));
        html.off('click', '[data-action="reset-chain"]').on('click', '[data-action="reset-chain"]', (e) => this.onResetChain(e));

        // Drag-and-drop
        this.initDragAndDrop(html);

        // Apply bypassed state to layout
        if (this.engine.getChain(this.activeChannel).isBypassed) {
            html.find('.ase-effects-layout').addClass('chain-bypassed');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Channel Switch
    // ─────────────────────────────────────────────────────────────

    private onChannelSwitch(event: JQuery.ClickEvent): void {
        event.preventDefault();
        const channel = $(event.currentTarget).data('channel') as TrackGroup;
        if (channel === this.activeChannel) return;

        this.activeChannel = channel;
        this.selectedEffectType = null;
        this.constructorOpen = false;
        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Master Chain Bypass
    // ─────────────────────────────────────────────────────────────

    private onToggleChainBypass(event: JQuery.ClickEvent): void {
        event.preventDefault();

        const chain = this.engine.getChain(this.activeChannel);
        const newState = !chain.isBypassed;

        this.engine.toggleChainBypass(this.activeChannel, newState);

        this.socket.broadcastFullState();
        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Pedal Select
    // ─────────────────────────────────────────────────────────────

    private onPedalSelect(event: JQuery.ClickEvent): void {
        const effectType = $(event.currentTarget).data('effect-type') as EffectType;

        if (this.selectedEffectType === effectType) {
            this.selectedEffectType = null;
        } else {
            this.selectedEffectType = effectType;
        }

        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Footswitch (Bypass Toggle)
    // ─────────────────────────────────────────────────────────────

    private onToggleBypass(event: JQuery.ClickEvent): void {
        const $card = $(event.currentTarget).closest('.ase-pedal-card');
        const effectType = $card.data('effect-type') as EffectType;
        const wasActive = $card.hasClass('active');
        const newEnabled = !wasActive;

        this.engine.setChainEffectEnabled(this.activeChannel, effectType, newEnabled);
        this.socket.broadcastEffectEnabled(this.activeChannel, effectType, newEnabled);

        // Full re-render to update badges and cables
        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Remove Effect
    // ─────────────────────────────────────────────────────────────

    private onRemoveEffect(event: JQuery.ClickEvent): void {
        const $card = $(event.currentTarget).closest('.ase-pedal-card');
        const effectType = $card.data('effect-type') as EffectType;

        this.engine.removeChainEffect(this.activeChannel, effectType);

        // If the removed effect was selected, deselect
        if (this.selectedEffectType === effectType) {
            this.selectedEffectType = null;
        }

        const newOrder = this.engine.getChain(this.activeChannel).getOrder();
        this.socket.broadcastChainReorder(this.activeChannel, newOrder);
        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Constructor Panel (Add Effects)
    // ─────────────────────────────────────────────────────────────

    private onOpenConstructor(): void {
        this.constructorOpen = true;
        this.renderParent?.();
    }

    private onCloseConstructor(): void {
        this.constructorOpen = false;
        this.renderParent?.();
    }

    private onAddEffect(event: JQuery.ClickEvent): void {
        const effectType = $(event.currentTarget).data('effect-type') as EffectType;

        this.engine.addChainEffect(this.activeChannel, effectType);

        const newOrder = this.engine.getChain(this.activeChannel).getOrder();
        this.socket.broadcastChainReorder(this.activeChannel, newOrder);

        // Select the newly added effect
        this.selectedEffectType = effectType;

        // Close constructor if no more effects available
        const chain = this.engine.getChain(this.activeChannel);
        const usedTypes = new Set(chain.getEffects().map(e => e.type));
        const remaining = ALL_EFFECT_TYPES.filter(t => !usedTypes.has(t));
        if (remaining.length === 0) {
            this.constructorOpen = false;
        }

        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Knob Drag (shared for pedal & detail mix knobs)
    // ─────────────────────────────────────────────────────────────

    private onKnobDrag(event: JQuery.MouseDownEvent, source: 'pedal' | 'detail'): void {
        const $knob = $(event.currentTarget);
        const restorePedalDraggable = () => {
            if (this.html) {
                this.html.find('.ase-pedal-card').prop('draggable', true);
            }
        };

        if (source === 'pedal') {
            this.isPedalKnobDragging = true;
            if (this.html) {
                this.html.find('.ase-pedal-card').prop('draggable', false);
            }
        }

        let effectType: EffectType;

        if (source === 'pedal') {
            effectType = $knob.closest('.ase-pedal-card').data('effect-type') as EffectType;
        } else {
            if (!this.selectedEffectType) return;
            effectType = this.selectedEffectType;
        }

        const chain = this.engine.getChain(this.activeChannel);
        const effect = chain.getEffect(effectType);
        if (!effect) {
            if (source === 'pedal') {
                this.isPedalKnobDragging = false;
                restorePedalDraggable();
            }
            return;
        }

        const startY = event.pageY;
        let currentMix = effect.mix;

        const onMouseMove = (moveEvent: JQuery.TriggeredEvent) => {
            const pageY = (moveEvent as any).pageY || (moveEvent.originalEvent as MouseEvent).pageY;
            const deltaY = startY - pageY;
            const sensitivity = 0.005;
            const newMix = Math.max(0, Math.min(1, currentMix + (deltaY * sensitivity)));

            // Update UI on all matching knobs
            const rotation = (newMix * 270) - 135;
            if (this.html) {
                const $pedalCard = this.html.find(`.ase-pedal-card[data-effect-type="${effectType}"]`);
                $pedalCard.find('.ase-pedal-knob').css('--knob-rotation', `${rotation}deg`);
                $pedalCard.find('.ase-pedal-mix-value').text(`${Math.round(newMix * 100)}%`);

                this.html.find('.ase-detail-knob').css('--knob-rotation', `${rotation}deg`);
                this.html.find('.ase-detail-knob-label').text(`MIX ${Math.round(newMix * 100)}%`);
            }

            this.engine.setChainEffectMix(this.activeChannel, effectType, newMix);
            this.socket.broadcastChainEffectMix(this.activeChannel, effectType, newMix);
        };

        const onMouseUp = () => {
            $(document).off('mousemove', onMouseMove as any);
            $(document).off('mouseup', onMouseUp as any);
            if (source === 'pedal') {
                this.isPedalKnobDragging = false;
                restorePedalDraggable();
            }
        };

        $(document).on('mousemove', onMouseMove as any);
        $(document).on('mouseup', onMouseUp as any);
    }

    // ─────────────────────────────────────────────────────────────
    // Detail Panel: Param Slider
    // ─────────────────────────────────────────────────────────────

    private onDetailParamSlider(event: JQuery.TriggeredEvent): void {
        if (!this.selectedEffectType) return;

        const $input = $(event.currentTarget);
        const paramId = $input.data('param-id') as string;
        const value = parseFloat($input.val() as string);

        this.engine.setChainEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);
        this.socket.broadcastEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);

        // Update display value
        const suffix = $input.data('suffix') || '';
        const $row = $input.closest('.ase-detail-param-row');
        const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(2);
        $row.find('.ase-detail-param-value').text(`${formatted}${suffix}`);

        // Update slider fill
        const min = parseFloat($input.attr('min') || '0');
        const max = parseFloat($input.attr('max') || '1');
        const fill = ((value - min) / (max - min)) * 100;
        $input.css('--slider-fill', `${fill}%`);
    }

    // ─────────────────────────────────────────────────────────────
    // Detail Panel: Select Param (segmented buttons)
    // ─────────────────────────────────────────────────────────────

    private onDetailParamSelect(event: JQuery.ClickEvent): void {
        event.preventDefault();
        if (!this.selectedEffectType) return;

        const $btn = $(event.currentTarget);
        const paramId = $btn.data('param-id') as string;
        const value = $btn.data('value') as string;

        this.engine.setChainEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);
        this.socket.broadcastEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);

        // UI update
        $btn.siblings().removeClass('active');
        $btn.addClass('active');

        const $row = $btn.closest('.ase-detail-param-row');
        $row.find('.ase-detail-param-value').text(value);
    }

    // ─────────────────────────────────────────────────────────────
    // Drag and Drop Reorder
    // ─────────────────────────────────────────────────────────────

    private initDragAndDrop(html: JQuery): void {
        const $pedalboard = html.find('.ase-pedalboard');
        if (!$pedalboard.length) return;

        const rootEl = html.get(0) as HTMLElement | undefined;
        if (rootEl) {
            rootEl.addEventListener('dragstart', (e: DragEvent) => {
                const target = e.target as HTMLElement | null;
                if (this.isPedalKnobDragging || Boolean(target?.closest('.ase-pedal-knob-area'))) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, true);
        }

        let draggedType: string | null = null;
        let draggedIndex: number = -1;

        html.find('.ase-pedal-card').each((_, el) => {
            const cardEl = el as HTMLElement;
            let blockNextDragFromKnob = false;

            cardEl.addEventListener('mousedown', (e: MouseEvent) => {
                const target = e.target as HTMLElement | null;
                blockNextDragFromKnob = Boolean(target?.closest('.ase-pedal-knob-area'));

                if (blockNextDragFromKnob) {
                    cardEl.draggable = false;
                } else if (!this.isPedalKnobDragging) {
                    cardEl.draggable = true;
                }
            }, true);

            el.addEventListener('dragstart', (e: DragEvent) => {
                const dragTarget = e.target as HTMLElement | null;
                if (
                    this.isPedalKnobDragging ||
                    blockNextDragFromKnob ||
                    !cardEl.draggable ||
                    Boolean(dragTarget?.closest('.ase-pedal-knob-area'))
                ) {
                    e.preventDefault();
                    return;
                }

                if (!e.dataTransfer) return;

                draggedType = el.dataset.effectType || null;
                draggedIndex = parseInt(el.dataset.chainIndex || '-1', 10);

                e.dataTransfer.setData('text/plain', JSON.stringify({
                    effectType: draggedType,
                    chainIndex: draggedIndex,
                }));
                e.dataTransfer.effectAllowed = 'move';

                // Use a minimal drag image to avoid default ghost issues
                const ghost = el.cloneNode(true) as HTMLElement;
                ghost.style.position = 'absolute';
                ghost.style.top = '-9999px';
                ghost.classList.add('ase-drag-ghost');
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 80, 115);
                requestAnimationFrame(() => ghost.remove());

                $(el).addClass('dragging');

                // Expand all drop zones and mark no-op ones
                $pedalboard.addClass('drag-active');
                html.find('.ase-drop-zone').each((_, z) => {
                    const dropIdx = parseInt((z as HTMLElement).dataset.dropIndex || '0', 10);
                    if (draggedIndex >= 0 && (dropIdx === draggedIndex || dropIdx === draggedIndex + 1)) {
                        $(z).addClass('no-op');
                    }
                });
            });

            el.addEventListener('dragend', () => {
                blockNextDragFromKnob = false;
                cardEl.draggable = true;
                $(el).removeClass('dragging');
                $pedalboard.removeClass('drag-active');
                html.find('.ase-drop-zone').removeClass('drag-over no-op');
                draggedType = null;
                draggedIndex = -1;
            });
        });

        html.find('.ase-drop-zone').each((_, zone) => {
            zone.addEventListener('dragover', (e: DragEvent) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

                const dropIndex = parseInt((zone as HTMLElement).dataset.dropIndex || '0', 10);

                // Don't highlight zones adjacent to the dragged item (no-op positions)
                if (draggedIndex >= 0 && (dropIndex === draggedIndex || dropIndex === draggedIndex + 1)) {
                    return;
                }

                html.find('.ase-drop-zone').not(zone).removeClass('drag-over');
                $(zone).addClass('drag-over');
            });

            zone.addEventListener('dragleave', (e: DragEvent) => {
                const related = e.relatedTarget as HTMLElement;
                if (related && zone.contains(related)) return;
                $(zone).removeClass('drag-over');
            });

            zone.addEventListener('drop', (e: DragEvent) => {
                e.preventDefault();
                $pedalboard.removeClass('drag-active');
                html.find('.ase-drop-zone').removeClass('drag-over no-op');
                if (!e.dataTransfer) return;

                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                const fromIndex = parseInt(data.chainIndex, 10);
                const toIndex = parseInt((zone as HTMLElement).dataset.dropIndex || '0', 10);

                if (fromIndex === toIndex || fromIndex === toIndex - 1) return;

                const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
                this.engine.reorderChainEffect(this.activeChannel, fromIndex, adjustedTo);

                const newOrder = this.engine.getChain(this.activeChannel).getOrder();
                this.socket.broadcastChainReorder(this.activeChannel, newOrder);
                this.renderParent?.();
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Presets
    // ─────────────────────────────────────────────────────────────

    private async onLoadPreset(event: JQuery.ChangeEvent): Promise<void> {
        const presetId = $(event.currentTarget).val() as string;
        if (!presetId) return;

        const allPresets = await GlobalStorage.loadPresets();
        const preset = allPresets.find(p => p.id === presetId);
        if (!preset || !preset.chains) return;

        // Apply preset chains to all channels
        for (const chainState of preset.chains) {
            const chain = this.engine.getChain(chainState.channel as TrackGroup);
            if (chain) {
                chain.restoreState(chainState);
            }
        }

        this.socket.broadcastFullState();
        this.renderParent?.();

        // Reset select
        $(event.currentTarget).val('');
    }

    private async onSavePreset(event: JQuery.ClickEvent): Promise<void> {
        event.preventDefault();

        const content = `
            <div class="form-group">
                <label>${game.i18n!.localize('ASE.UI.Effects.PresetName')}</label>
                <input type="text" name="name" placeholder="${game.i18n!.localize('ASE.UI.Effects.MyCustomPreset')}"/>
            </div>
            <div class="form-group">
                <label>${game.i18n!.localize('ASE.UI.Effects.DescriptionOptional')}</label>
                <input type="text" name="description" placeholder="${game.i18n!.localize('ASE.UI.Effects.ShortDescription')}"/>
            </div>
        `;

        new Dialog({
            title: game.i18n!.localize('ASE.UI.Effects.SaveEffectPreset'),
            content,
            buttons: {
                save: {
                    label: game.i18n!.localize('ASE.UI.Actions.Save'),
                    callback: async (html: JQuery) => {
                        const name = html.find('input[name="name"]').val() as string;
                        if (!name) return;
                        const description = html.find('input[name="description"]').val() as string;

                        const newPreset: EffectPreset = {
                            id: `custom-${Date.now()}`,
                            name,
                            description: description || undefined,
                            builtIn: false,
                            chains: this.engine.getAllChainsState(),
                        };

                        const allPresets = await GlobalStorage.loadPresets();
                        allPresets.push(newPreset);
                        await GlobalStorage.savePresets(allPresets);

                        this.renderParent?.();
                    }
                }
            }
        }).render(true);
    }

    private onResetChain(event: JQuery.ClickEvent): void {
        event.preventDefault();

        const chain = this.engine.getChain(this.activeChannel);
        chain.buildDefault();
        this.selectedEffectType = null;
        this.constructorOpen = false;

        this.socket.broadcastFullState();
        this.renderParent?.();
    }

    // ─────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────

    destroy(): void {
        this.html = null;
    }
}
