
/**
 * Foundry VTT V13 ApplicationV2 Type Shims
 * Provides strict typing for the new ApplicationV2 API
 */

declare global {
    namespace foundry {
        namespace applications {
            namespace api {
                interface ApplicationOptions {
                    id?: string;
                    classes?: string[];
                    tag?: string;
                    window?: {
                        title?: string;
                        icon?: string;
                        resizable?: boolean;
                        controls?: any[];
                    };
                    position?: {
                        width?: number;
                        height?: number;
                        top?: number;
                        left?: number;
                        scale?: number;
                    };
                }

                interface RenderOptions {
                    force?: boolean;
                    position?: ApplicationOptions['position'];
                    window?: {
                        title?: string;
                    };
                    parts?: string[];
                }

                class ApplicationV2 {
                    constructor(options?: ApplicationOptions);

                    static DEFAULT_OPTIONS: ApplicationOptions;

                    // Properties
                    id: string;
                    element: HTMLElement;
                    rendered: boolean;
                    position: ApplicationOptions['position'];

                    // Methods
                    render(options?: RenderOptions | boolean): Promise<this>;
                    close(options?: { animate?: boolean }): Promise<this>;
                    setPosition(position: ApplicationOptions['position']): void;
                    minimize(): Promise<void>;
                    maximize(): Promise<void>;
                    bringToTop(): void;

                    // Lifecycle (protected)
                    protected _prepareContext(options: RenderOptions): Promise<any>;
                    protected _onRender(context: any, options: RenderOptions): void;
                    protected _onClose(options: RenderOptions): void;

                    // Helper for handlebars
                    static PARTS: Record<string, { template: string, scrollable?: string[] }>;
                }

                function HandlebarsApplicationMixin<T extends Constructor<ApplicationV2>>(Base: T): T & Constructor<ApplicationV2>;
            }
        }
        namespace utils {
            function mergeObject(a: any, b: any, options?: any): any;
        }
    }

    type Constructor<T = {}> = new (...args: any[]) => T;
}

export { };
