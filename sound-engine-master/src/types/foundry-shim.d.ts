
/**
 * Foundry VTT Type Shims for Advanced Sound Engine
 * Provides strict typing for Hooks, UI controls, and generic Foundry objects
 */

declare global {
    // ─── Scene Controls ───
    interface SceneControlTool {
        name: string;
        title: string;
        icon: string;
        visible?: boolean;
        button?: boolean;
        toggle?: boolean;
        active?: boolean;
        onClick?: () => void;
    }

    interface SceneControl {
        name: string;
        title: string;
        icon: string;
        visible: boolean;
        tools: SceneControlTool[];
        activeTool?: string;
    }

    // ─── Hooks ───
    namespace Hooks {
        function on(hook: 'getSceneControlButtons', fn: (controls: SceneControl[]) => void): number;
        function on(hook: 'renderSceneControls', fn: (controls: any, html: JQuery) => void): number;
        function on(hook: 'init', fn: () => void): number;
        function on(hook: 'ready', fn: () => void): number;
        function on(hook: 'canvasReady', fn: () => void): number;
        function on(hook: 'closeGame', fn: () => void): number;
        function once(hook: string, fn: Function): number;
        function once(hook: string, fn: Function): number;
    }

    interface HookConfig {
        "ase.favoritesChanged": (data: { id: string; isFavorite: boolean }) => void;
    }

    // ─── Settings ───
    interface SettingConfig {
        name: string;
        hint?: string;
        scope?: 'world' | 'client';
        config?: boolean;
        type?: any;
        default?: any;
        range?: {
            min: number;
            max: number;
            step: number;
        };
        onChange?: (value: any) => void;
        filePicker?: boolean;
    }

    interface ClientSettings {
        register(module: string, key: string, data: SettingConfig): void;
    }

    // ─── Game ───
    interface Game {
        settings: ClientSettings;
    }
}

export { };
