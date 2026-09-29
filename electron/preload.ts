import { contextBridge, ipcRenderer } from 'electron';

/**
 * 렌더러에 노출하는 것은 이 하나뿐이다.
 *
 * 페이지는 우리가 띄운 서버에서 오지만, 노출 면적은 최소로 둔다 —
 * 폴더 하나를 고르는 데 더 필요한 것이 없다.
 */
contextBridge.exposeInMainWorld('ulsDesktop', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('uls:pick-folder')
});
