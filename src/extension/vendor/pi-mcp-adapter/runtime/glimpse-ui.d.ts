export declare function isGlimpseAvailable(): boolean;
export declare function openGlimpseWindow(html: string, options: {
    title: string;
    width?: number;
    height?: number;
    onClosed: () => void;
}): Promise<{
    close: () => void;
}>;
