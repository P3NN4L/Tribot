export {};

declare global {
  interface Window {
    tribot?: {
      isElectron: boolean;
      platform: string;
      windowControls?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        getState: () => Promise<{ maximized: boolean }>;
        onStateChange: (cb: (s: { maximized: boolean }) => void) => () => void;
      };
      chooseFolder?: () => Promise<string | null>;
      readLocalFile?: () => Promise<
        { name: string; path: string; content: string } | { error: string } | null
      >;
    };
  }
}
