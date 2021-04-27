import {ipcRenderer} from "../typed-ipc-renderer";

export function init(
  $reconnectButton: Element,
  $settingsButton: Element,
): void {
  $reconnectButton.addEventListener("click", () => {
    ipcRenderer.send("forward-message", "reload-viewer");
  });
  $settingsButton.addEventListener("click", () => {
    ipcRenderer.send("forward-message", "open-settings");
  });
}
