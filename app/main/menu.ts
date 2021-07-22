import {BrowserWindow, Menu, app, shell} from "electron";

import AdmZip from "adm-zip";

import * as ConfigUtil from "../common/config-util";
import * as DNDUtil from "../common/dnd-util";
import * as t from "../common/translation-util";
import type {RendererMessage} from "../common/typed-ipc";
import type {MenuProps, TabData} from "../common/types";

import {appUpdater} from "./autoupdater";
import {send} from "./typed-ipc-main";

const appName = app.name;

function getHistorySubmenu(
  enableMenu: boolean,
): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: t.__("Back"),
      accelerator: process.platform === "darwin" ? "Command+Left" : "Alt+Left",
      enabled: enableMenu,
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("back");
        }
      },
    },
    {
      label: t.__("Forward"),
      accelerator:
        process.platform === "darwin" ? "Command+Right" : "Alt+Right",
      enabled: enableMenu,
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("forward");
        }
      },
    },
  ];
}

function getToolsSubmenu(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: t.__("Check for Updates"),
      async click() {
        await checkForUpdate();
      },
    },
    {
      label: t.__("Release Notes"),
      async click() {
        await shell.openExternal(
          `https://github.com/zulip/zulip-desktop/releases/tag/v${app.getVersion()}`,
        );
      },
    },
    {
      type: "separator",
    },
    {
      label: t.__("Download App Logs"),
      click() {
        const zip = new AdmZip();
        const date = new Date();
        const dateString = date.toLocaleDateString().replace(/\//g, "-");

        // Create a zip file of all the logs and config data
        zip.addLocalFolder(`${app.getPath("appData")}/${appName}/Logs`);
        zip.addLocalFolder(`${app.getPath("appData")}/${appName}/config`);

        // Put the log file in downloads folder
        const logFilePath = `${app.getPath(
          "downloads",
        )}/Zulip-logs-${dateString}.zip`;
        zip.writeZip(logFilePath);

        // Open and select the log file
        shell.showItemInFolder(logFilePath);
      },
    },
    {
      type: "separator",
    },
    {
      label: t.__("Toggle DevTools for Zulip App"),
      accelerator:
        process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          focusedWindow.webContents.openDevTools({mode: "undocked"});
        }
      },
    },
    {
      label: t.__("Toggle DevTools for Active Tab"),
      accelerator:
        process.platform === "darwin" ? "Alt+Command+U" : "Ctrl+Shift+U",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("tab-devtools");
        }
      },
    },
  ];
}

function getViewSubmenu(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: t.__("Reload"),
      accelerator: "CommandOrControl+R",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("reload-current-viewer");
        }
      },
    },
    {
      label: t.__("Hard Reload"),
      accelerator: "CommandOrControl+Shift+R",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("hard-reload");
        }
      },
    },
    {
      label: t.__("Hard Reload"),
      visible: false,
      accelerator: "F5",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("hard-reload");
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: t.__("Toggle Full Screen"),
      role: "togglefullscreen",
    },
    {
      label: t.__("Zoom In"),
      accelerator: "CommandOrControl+=",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomIn");
        }
      },
    },
    {
      label: t.__("Zoom In"),
      visible: false,
      accelerator: "CommandOrControl+Plus",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomIn");
        }
      },
    },
    {
      label: t.__("Zoom In"),
      visible: false,
      accelerator: "CommandOrControl+numadd",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomIn");
        }
      },
    },
    {
      label: t.__("Zoom Out"),
      accelerator: "CommandOrControl+-",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomOut");
        }
      },
    },
    {
      label: t.__("Zoom Out"),
      visible: false,
      accelerator: "CommandOrControl+numsub",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomOut");
        }
      },
    },
    {
      label: t.__("Actual Size"),
      accelerator: "CommandOrControl+0",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomActualSize");
        }
      },
    },
    {
      label: t.__("Actual Size"),
      visible: false,
      accelerator: "CommandOrControl+num0",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("zoomActualSize");
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: t.__("Toggle Tray Icon"),
      click(_item, focusedWindow) {
        if (focusedWindow) {
          send(focusedWindow.webContents, "toggletray");
        }
      },
    },
    {
      label: t.__("Toggle Organization Shortcuts"),
      click(_item, focusedWindow) {
        if (focusedWindow) {
          focusedWindow.webContents.send("toggleOrgShortcuts");
        }
      },
    },
    {
      label: t.__("Toggle Sidebar"),
      accelerator: "CommandOrControl+Shift+S",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          const newValue = !ConfigUtil.getConfigItem("showSidebar", true);
          send(focusedWindow.webContents, "toggle-sidebar", newValue);
          ConfigUtil.setConfigItem("showSidebar", newValue);
        }
      },
    },
    {
      label: t.__("Auto hide Menu bar"),
      checked: ConfigUtil.getConfigItem("autoHideMenubar", false),
      visible: process.platform !== "darwin",
      click(_item, focusedWindow) {
        if (focusedWindow) {
          const newValue = !ConfigUtil.getConfigItem("autoHideMenubar", false);
          focusedWindow.autoHideMenuBar = newValue;
          focusedWindow.setMenuBarVisibility(!newValue);
          send(
            focusedWindow.webContents,
            "toggle-autohide-menubar",
            newValue,
            false,
          );
          ConfigUtil.setConfigItem("autoHideMenubar", newValue);
        }
      },
      type: "checkbox",
    },
  ];
}

function getHelpSubmenu(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: `${appName + " Desktop"} v${app.getVersion()}`,
      enabled: false,
    },
    {
      label: t.__("About Zulip"),
      click(_item, focusedWindow) {
        if (focusedWindow) {
          sendAction("open-about");
        }
      },
    },
    {
      label: t.__("Help Center"),
      click(focusedWindow) {
        if (focusedWindow) {
          sendAction("open-help");
        }
      },
    },
    {
      label: t.__("Report an Issue"),
      click() {
        // The goal is to notify the main.html BrowserWindow
        // which may not be the focused window.
        for (const window of BrowserWindow.getAllWindows()) {
          send(window.webContents, "open-feedback-modal");
        }
      },
    },
  ];
}

function getWindowSubmenu(
  tabs: TabData[],
  activeTabIndex?: number,
): Electron.MenuItemConstructorOptions[] {
  const initialSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: t.__("Minimize"),
      role: "minimize",
    },
    {
      label: t.__("Close"),
      role: "close",
    },
  ];

  if (tabs.length > 0) {
    const ShortcutKey = process.platform === "darwin" ? "Cmd" : "Ctrl";
    initialSubmenu.push({
      type: "separator",
    });
    for (const tab of tabs) {
      // Skip missing elements left by `delete this.tabs[index]` in
      // ServerManagerView.
      if (tab === undefined) continue;

      // Do not add functional tab settings to list of windows in menu bar
      if (tab.role === "function" && tab.name === "Settings") {
        continue;
      }

      initialSubmenu.push({
        label: tab.name,
        accelerator:
          tab.role === "function" ? "" : `${ShortcutKey} + ${tab.index + 1}`,
        checked: tab.index === activeTabIndex,
        click(_item, focusedWindow) {
          if (focusedWindow) {
            sendAction("switch-server-tab", tab.index);
          }
        },
        type: "checkbox",
      });
    }

    initialSubmenu.push(
      {
        type: "separator",
      },
      {
        label: t.__("Switch to Next Organization"),
        accelerator: "Ctrl+Tab",
        enabled: tabs.length > 1,
        click(_item, focusedWindow) {
          if (focusedWindow) {
            sendAction(
              "switch-server-tab",
              getNextServer(tabs, activeTabIndex!),
            );
          }
        },
      },
      {
        label: t.__("Switch to Previous Organization"),
        accelerator: "Ctrl+Shift+Tab",
        enabled: tabs.length > 1,
        click(_item, focusedWindow) {
          if (focusedWindow) {
            sendAction(
              "switch-server-tab",
              getPreviousServer(tabs, activeTabIndex!),
            );
          }
        },
      },
    );
  }

  return initialSubmenu;
}

function getDarwinTpl(props: MenuProps): Electron.MenuItemConstructorOptions[] {
  const {tabs, activeTabIndex, enableMenu = false} = props;

  return [
    {
      label: app.name,
      submenu: [
        {
          label: t.__("Add Organization"),
          accelerator: "Cmd+Shift+N",
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("new-server");
            }
          },
        },
        {
          label: t.__("Toggle Do Not Disturb"),
          accelerator: "Cmd+Shift+M",
          click() {
            const dndUtil = DNDUtil.toggle();
            sendAction("toggle-dnd", dndUtil.dnd, dndUtil.newSettings);
          },
        },
        {
          label: t.__("Desktop Settings"),
          accelerator: "Cmd+,",
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("open-settings");
            }
          },
        },
        {
          label: t.__("Keyboard Shortcuts"),
          accelerator: "Cmd+Shift+K",
          enabled: enableMenu,
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("show-keyboard-shortcuts");
            }
          },
        },
        {
          type: "separator",
        },
        {
          label: t.__("Copy Zulip URL"),
          accelerator: "Cmd+Shift+C",
          enabled: enableMenu,
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("copy-zulip-url");
            }
          },
        },
        {
          label: t.__("Log Out of Organization"),
          enabled: enableMenu,
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("log-out");
            }
          },
        },
        {
          type: "separator",
        },
        {
          label: t.__("Services"),
          role: "services",
          submenu: [],
        },
        {
          type: "separator",
        },
        {
          label: t.__("Hide"),
          role: "hide",
        },
        {
          label: t.__("Hide Others"),
          role: "hideOthers",
        },
        {
          label: t.__("Unhide"),
          role: "unhide",
        },
        {
          type: "separator",
        },
        {
          label: t.__("Minimize"),
          role: "minimize",
        },
        {
          label: t.__("Close"),
          role: "close",
        },
        {
          label: t.__("Quit"),
          role: "quit",
        },
      ],
    },
    {
      label: t.__("Edit"),
      submenu: [
        {
          label: t.__("Undo"),
          role: "undo",
        },
        {
          label: t.__("Redo"),
          role: "redo",
        },
        {
          type: "separator",
        },
        {
          label: t.__("Cut"),
          role: "cut",
        },
        {
          label: t.__("Copy"),
          role: "copy",
        },
        {
          label: t.__("Paste"),
          role: "paste",
        },
        {
          label: t.__("Paste and Match Style"),
          role: "pasteAndMatchStyle",
        },
        {
          label: t.__("Select All"),
          role: "selectAll",
        },
      ],
    },
    {
      label: t.__("View"),
      submenu: getViewSubmenu(),
    },
    {
      label: t.__("History"),
      submenu: getHistorySubmenu(enableMenu),
    },
    {
      label: t.__("Window"),
      submenu: getWindowSubmenu(tabs, activeTabIndex),
    },
    {
      label: t.__("Tools"),
      submenu: getToolsSubmenu(),
    },
    {
      label: t.__("Help"),
      role: "help",
      submenu: getHelpSubmenu(),
    },
  ];
}

function getOtherTpl(props: MenuProps): Electron.MenuItemConstructorOptions[] {
  const {tabs, activeTabIndex, enableMenu = false} = props;
  return [
    {
      label: t.__("File"),
      submenu: [
        {
          label: t.__("Add Organization"),
          accelerator: "Ctrl+Shift+N",
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("new-server");
            }
          },
        },
        {
          type: "separator",
        },
        {
          label: t.__("Toggle Do Not Disturb"),
          accelerator: "Ctrl+Shift+M",
          click() {
            const dndUtil = DNDUtil.toggle();
            sendAction("toggle-dnd", dndUtil.dnd, dndUtil.newSettings);
          },
        },
        {
          label: t.__("Desktop Settings"),
          accelerator: "Ctrl+,",
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("open-settings");
            }
          },
        },
        {
          label: t.__("Keyboard Shortcuts"),
          accelerator: "Ctrl+Shift+K",
          enabled: enableMenu,
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("show-keyboard-shortcuts");
            }
          },
        },
        {
          type: "separator",
        },
        {
          label: t.__("Copy Zulip URL"),
          accelerator: "Ctrl+Shift+C",
          enabled: enableMenu,
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("copy-zulip-url");
            }
          },
        },
        {
          label: t.__("Log Out of Organization"),
          enabled: enableMenu,
          click(_item, focusedWindow) {
            if (focusedWindow) {
              sendAction("log-out");
            }
          },
        },
        {
          type: "separator",
        },
        {
          label: t.__("Minimize"),
          role: "minimize",
        },
        {
          label: t.__("Close"),
          role: "close",
        },
        {
          label: t.__("Quit"),
          role: "quit",
          accelerator: "Ctrl+Q",
        },
      ],
    },
    {
      label: t.__("Edit"),
      submenu: [
        {
          label: t.__("Undo"),
          role: "undo",
        },
        {
          label: t.__("Redo"),
          role: "redo",
        },
        {
          type: "separator",
        },
        {
          label: t.__("Cut"),
          role: "cut",
        },
        {
          label: t.__("Copy"),
          role: "copy",
        },
        {
          label: t.__("Paste"),
          role: "paste",
        },
        {
          label: t.__("Paste and Match Style"),
          role: "pasteAndMatchStyle",
        },
        {
          type: "separator",
        },
        {
          label: t.__("Select All"),
          role: "selectAll",
        },
      ],
    },
    {
      label: t.__("View"),
      submenu: getViewSubmenu(),
    },
    {
      label: t.__("History"),
      submenu: getHistorySubmenu(enableMenu),
    },
    {
      label: t.__("Window"),
      submenu: getWindowSubmenu(tabs, activeTabIndex),
    },
    {
      label: t.__("Tools"),
      submenu: getToolsSubmenu(),
    },
    {
      label: t.__("Help"),
      role: "help",
      submenu: getHelpSubmenu(),
    },
  ];
}

function sendAction<Channel extends keyof RendererMessage>(
  channel: Channel,
  ...args: Parameters<RendererMessage[Channel]>
): void {
  const win = BrowserWindow.getAllWindows()[0];

  if (process.platform === "darwin") {
    win.restore();
  }

  send(win.webContents, channel, ...args);
}

async function checkForUpdate(): Promise<void> {
  await appUpdater(true);
}

function getNextServer(tabs: TabData[], activeTabIndex: number): number {
  do {
    activeTabIndex = (activeTabIndex + 1) % tabs.length;
  } while (tabs[activeTabIndex]?.role !== "server");

  return activeTabIndex;
}

function getPreviousServer(tabs: TabData[], activeTabIndex: number): number {
  do {
    activeTabIndex = (activeTabIndex - 1 + tabs.length) % tabs.length;
  } while (tabs[activeTabIndex]?.role !== "server");

  return activeTabIndex;
}

export function setMenu(props: MenuProps): void {
  const tpl =
    process.platform === "darwin" ? getDarwinTpl(props) : getOtherTpl(props);
  const menu = Menu.buildFromTemplate(tpl);
  Menu.setApplicationMenu(menu);
}
