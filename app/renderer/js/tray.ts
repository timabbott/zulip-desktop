import type {NativeImage, WebviewTag} from "electron";
import {remote} from "electron";
import path from "path";

import * as ConfigUtil from "../../common/config-util";
import * as t from "../../common/translation-util";
import type {RendererMessage} from "../../common/typed-ipc";

import {ipcRenderer} from "./typed-ipc-renderer";

const {Tray, Menu, nativeImage, BrowserWindow} = remote;

let tray: Electron.Tray | null = null;

const ICON_DIR = "../../resources/tray";

const TRAY_SUFFIX = "tray";

const APP_ICON = path.join(__dirname, ICON_DIR, TRAY_SUFFIX);

const iconPath = (): string => {
  if (process.platform === "linux") {
    return APP_ICON + "linux.png";
  }

  return (
    APP_ICON + (process.platform === "win32" ? "win.ico" : "macOSTemplate.png")
  );
};

const winUnreadTrayIconPath = (): string => APP_ICON + "unread.ico";

let unread = 0;

const trayIconSize = (): number => {
  switch (process.platform) {
    case "darwin":
      return 20;
    case "win32":
      return 100;
    case "linux":
      return 100;
    default:
      return 80;
  }
};

//  Default config for Icon we might make it OS specific if needed like the size
const config = {
  pixelRatio: window.devicePixelRatio,
  unreadCount: 0,
  showUnreadCount: true,
  unreadColor: "#000000",
  readColor: "#000000",
  unreadBackgroundColor: "#B9FEEA",
  readBackgroundColor: "#B9FEEA",
  size: trayIconSize(),
  thick: process.platform === "win32",
};

const renderCanvas = function (arg: number): HTMLCanvasElement {
  config.unreadCount = arg;

  const SIZE = config.size * config.pixelRatio;
  const PADDING = SIZE * 0.05;
  const CENTER = SIZE / 2;
  const HAS_COUNT = config.showUnreadCount && config.unreadCount;
  const color = config.unreadCount ? config.unreadColor : config.readColor;
  const backgroundColor = config.unreadCount
    ? config.unreadBackgroundColor
    : config.readBackgroundColor;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Circle
  // If (!config.thick || config.thick && HAS_COUNT) {
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, SIZE / 2 - PADDING, 0, 2 * Math.PI, false);
  ctx.fillStyle = backgroundColor;
  ctx.fill();
  ctx.lineWidth = SIZE / (config.thick ? 10 : 20);
  ctx.strokeStyle = backgroundColor;
  ctx.stroke();
  // Count or Icon
  if (HAS_COUNT) {
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    if (config.unreadCount > 99) {
      ctx.font = `${config.thick ? "bold " : ""}${SIZE * 0.4}px Helvetica`;
      ctx.fillText("99+", CENTER, CENTER + SIZE * 0.15);
    } else if (config.unreadCount < 10) {
      ctx.font = `${config.thick ? "bold " : ""}${SIZE * 0.5}px Helvetica`;
      ctx.fillText(String(config.unreadCount), CENTER, CENTER + SIZE * 0.2);
    } else {
      ctx.font = `${config.thick ? "bold " : ""}${SIZE * 0.5}px Helvetica`;
      ctx.fillText(String(config.unreadCount), CENTER, CENTER + SIZE * 0.15);
    }
  }

  return canvas;
};

/**
 * Renders the tray icon as a native image
 * @param arg: Unread count
 * @return the native image
 */
const renderNativeImage = function (arg: number): NativeImage {
  if (process.platform === "win32") {
    return nativeImage.createFromPath(winUnreadTrayIconPath());
  }

  const canvas = renderCanvas(arg);
  const pngData = nativeImage
    .createFromDataURL(canvas.toDataURL("image/png"))
    .toPNG();
  return nativeImage.createFromBuffer(pngData, {
    scaleFactor: config.pixelRatio,
  });
};

function sendAction<Channel extends keyof RendererMessage>(
  channel: Channel,
  ...args: Parameters<RendererMessage[Channel]>
): void {
  const win = BrowserWindow.getAllWindows()[0];

  if (process.platform === "darwin") {
    win.restore();
  }

  ipcRenderer.sendTo(win.webContents.id, channel, ...args);
}

const createTray = function (): void {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Zulip",
      click() {
        ipcRenderer.send("focus-app");
      },
    },
    {
      label: "Settings",
      click() {
        ipcRenderer.send("focus-app");
        sendAction("open-settings");
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click() {
        ipcRenderer.send("quit-app");
      },
    },
  ]);
  tray = new Tray(iconPath());
  tray.setContextMenu(contextMenu);
  if (process.platform === "linux" || process.platform === "win32") {
    tray.on("click", () => {
      ipcRenderer.send("toggle-app");
    });
  }
};

ipcRenderer.on("destroytray", (_event: Event) => {
  if (!tray) {
    return;
  }

  tray.destroy();
  if (tray.isDestroyed()) {
    tray = null;
  } else {
    throw new Error("Tray icon not properly destroyed.");
  }
});

ipcRenderer.on("tray", (_event: Event, arg: number): void => {
  if (!tray) {
    return;
  }

  // We don't want to create tray from unread messages on macOS since it already has dock badges.
  if (process.platform === "linux" || process.platform === "win32") {
    if (arg === 0) {
      unread = arg;
      tray.setImage(iconPath());
      tray.setToolTip(t.__("No unread messages"));
    } else {
      unread = arg;
      const image = renderNativeImage(arg);
      tray.setImage(image);
      tray.setToolTip(
        t.__(`{{count}} unread messages`, {count: arg.toString()}),
      );
    }
  }
});

function toggleTray(): void {
  let state;
  if (tray) {
    state = false;
    tray.destroy();
    if (tray.isDestroyed()) {
      tray = null;
    }

    ConfigUtil.setConfigItem("trayIcon", false);
  } else {
    state = true;
    createTray();
    if (process.platform === "linux" || process.platform === "win32") {
      const image = renderNativeImage(unread);
      tray!.setImage(image);
      tray!.setToolTip(`${unread} unread messages`);
    }

    ConfigUtil.setConfigItem("trayIcon", true);
  }

  const selector = "webview:not([class*=disabled])";
  const webview: WebviewTag = document.querySelector(selector)!;
  ipcRenderer.sendTo(webview.getWebContentsId(), "toggle-tray", state);
}

ipcRenderer.on("toggletray", toggleTray);

if (ConfigUtil.getConfigItem("trayIcon", true)) {
  createTray();
}

export {};
