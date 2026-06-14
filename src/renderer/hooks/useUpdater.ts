import { useState, useEffect, useCallback } from "react";
declare const window: any;
export type UpdateInfo = {
    version: string;
    releaseDate?: string;
};
export type DownloadProgress = {
    percent: number;
    transferred: number;
    total: number;
};
export type UpdateError = {
    message: string;
};
export interface UpdaterState {
    updateAvailable: UpdateInfo | null;
    updateDownloaded: UpdateInfo | null;
    downloadProgress: DownloadProgress | null;
    error: UpdateError | null;
    isDismissed: boolean;
}
export interface UseUpdaterReturn {
    state: UpdaterState;
    dismiss: () => void;
    checkForUpdates: () => void;
    setAutoUpdateEnabled: (enabled: boolean) => void;
}
function useUpdater(): UseUpdaterReturn {
    const [state, setState] = useState<UpdaterState>({
        updateAvailable: null,
        updateDownloaded: null,
        downloadProgress: null,
        error: null,
        isDismissed: false,
    });
    const dismiss = useCallback(() => {
        setState((prev) => ({ ...prev, isDismissed: true }));
    }, []);
    const checkForUpdates = useCallback(() => {
        if (window.electronAPI?.checkForUpdates) {
            window.electronAPI.checkForUpdates().catch(() => {
                // silently ignore errors from manual check
            });
        }
    }, []);
    const setAutoUpdateEnabled = useCallback((enabled: boolean) => {
        if (window.electronAPI?.setAutoUpdateEnabled) {
            window.electronAPI.setAutoUpdateEnabled(enabled);
        }
    }, []);
    useEffect(() => {
        if (!window.electronAPI) return;
        const unsubAvailable = window.electronAPI.onUpdateAvailable
            ? window.electronAPI.onUpdateAvailable((info: UpdateInfo) => {
                  setState((prev) => ({
                      ...prev,
                      updateAvailable: info,
                      isDismissed: false,
                  }));
              })
            : () => {};
        const unsubDownloaded = window.electronAPI.onUpdateDownloaded
            ? window.electronAPI.onUpdateDownloaded((info: UpdateInfo) => {
                  setState((prev) => ({
                      ...prev,
                      updateDownloaded: info,
                  }));
              })
            : () => {};
        const unsubProgress = window.electronAPI.onDownloadProgress
            ? window.electronAPI.onDownloadProgress((progress: DownloadProgress) => {
                  setState((prev) => ({
                      ...prev,
                      downloadProgress: progress,
                  }));
              })
            : () => {};
        const unsubError = window.electronAPI.onUpdateError
            ? window.electronAPI.onUpdateError((err: UpdateError) => {
                  setState((prev) => ({
                      ...prev,
                      error: err,
                  }));
              })
            : () => {};
        return () => {
            unsubAvailable();
            unsubDownloaded();
            unsubProgress();
            unsubError();
        };
    }, []);
    return { state, dismiss, checkForUpdates, setAutoUpdateEnabled };
}
export default useUpdater;