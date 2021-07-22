import {clipboard, remote} from "electron";
import path from "path";

import type {Config} from "../../common/config-util";
import * as ConfigUtil from "../../common/config-util";
import * as DNDUtil from "../../common/dnd-util";
import type {DNDSettings} from "../../common/dnd-util";
import * as EnterpriseUtil from "../../common/enterprise-util";
import Logger from "../../common/logger-util";
import * as Messages from "../../common/messages";
import type {RendererMessage} from "../../common/typed-ipc";
import type {NavItem, ServerConf, TabData} from "../../common/types";

import FunctionalTab from "./components/functional-tab";
import ServerTab from "./components/server-tab";
import WebView from "./components/webview";
import {feedbackHolder} from "./feedback";
import {ipcRenderer} from "./typed-ipc-renderer";
import * as DomainUtil from "./utils/domain-util";
import * as LinkUtil from "./utils/link-util";
import ReconnectUtil from "./utils/reconnect-util";

// eslint-disable-next-line import/no-unassigned-import
import "./tray";

const {session, app, Menu, dialog} = remote;

interface FunctionalTabProps {
  name: string;
  materialIcon: string;
  url: string;
}

type WebviewListener =
  | "webview-reload"
  | "back"
  | "focus"
  | "forward"
  | "zoomIn"
  | "zoomOut"
  | "zoomActualSize"
  | "log-out"
  | "show-keyboard-shortcuts"
  | "tab-devtools";

const logger = new Logger({
  file: "errors.log",
});

const rendererDirectory = path.resolve(__dirname, "..");
type ServerOrFunctionalTab = ServerTab | FunctionalTab;

class ServerManagerView {
  $addServerButton: HTMLButtonElement;
  $tabsContainer: Element;
  $reloadButton: HTMLButtonElement;
  $loadingIndicator: HTMLButtonElement;
  $settingsButton: HTMLButtonElement;
  $webviewsContainer: Element;
  $backButton: HTMLButtonElement;
  $dndButton: HTMLButtonElement;
  $addServerTooltip: HTMLElement;
  $reloadTooltip: HTMLElement;
  $loadingTooltip: HTMLElement;
  $settingsTooltip: HTMLElement;
  $serverIconTooltip: HTMLCollectionOf<HTMLElement>;
  $backTooltip: HTMLElement;
  $dndTooltip: HTMLElement;
  $sidebar: Element;
  $fullscreenPopup: Element;
  $fullscreenEscapeKey: string;
  loading: Set<string>;
  activeTabIndex: number;
  tabs: ServerOrFunctionalTab[];
  functionalTabs: Map<string, number>;
  tabIndex: number;
  presetOrgs: string[];
  constructor() {
    this.$addServerButton = document.querySelector("#add-tab")!;
    this.$tabsContainer = document.querySelector("#tabs-container")!;

    const $actionsContainer = document.querySelector("#actions-container")!;
    this.$reloadButton = $actionsContainer.querySelector("#reload-action")!;
    this.$loadingIndicator =
      $actionsContainer.querySelector("#loading-action")!;
    this.$settingsButton = $actionsContainer.querySelector("#settings-action")!;
    this.$webviewsContainer = document.querySelector("#webviews-container")!;
    this.$backButton = $actionsContainer.querySelector("#back-action")!;
    this.$dndButton = $actionsContainer.querySelector("#dnd-action")!;

    this.$addServerTooltip = document.querySelector("#add-server-tooltip")!;
    this.$reloadTooltip = $actionsContainer.querySelector("#reload-tooltip")!;
    this.$loadingTooltip = $actionsContainer.querySelector("#loading-tooltip")!;
    this.$settingsTooltip =
      $actionsContainer.querySelector("#setting-tooltip")!;

    // TODO: This should have been querySelector but the problem is that
    // querySelector doesn't return elements not present in dom whereas somehow
    // getElementsByClassName does. To fix this we need to call this after this.initTabs
    // is called in this.init.
    // eslint-disable-next-line unicorn/prefer-query-selector
    this.$serverIconTooltip = document.getElementsByClassName(
      "server-tooltip",
    ) as HTMLCollectionOf<HTMLElement>;
    this.$backTooltip = $actionsContainer.querySelector("#back-tooltip")!;
    this.$dndTooltip = $actionsContainer.querySelector("#dnd-tooltip")!;

    this.$sidebar = document.querySelector("#sidebar")!;

    this.$fullscreenPopup = document.querySelector("#fullscreen-popup")!;
    this.$fullscreenEscapeKey = process.platform === "darwin" ? "^⌘F" : "F11";
    this.$fullscreenPopup.textContent = `Press ${this.$fullscreenEscapeKey} to exit full screen`;

    this.loading = new Set();
    this.activeTabIndex = -1;
    this.tabs = [];
    this.presetOrgs = [];
    this.functionalTabs = new Map();
    this.tabIndex = 0;
  }

  async init(): Promise<void> {
    await this.loadProxy();
    this.initDefaultSettings();
    this.initSidebar();
    this.removeUAfromDisk();
    if (EnterpriseUtil.hasConfigFile()) {
      await this.initPresetOrgs();
    }

    await this.initTabs();
    this.initActions();
    this.registerIpcs();
    ipcRenderer.send("set-spellcheck-langs");
  }

  async loadProxy(): Promise<void> {
    // To change proxyEnable to useManualProxy in older versions
    const proxyEnabledOld = ConfigUtil.isConfigItemExists("useProxy");
    if (proxyEnabledOld) {
      const proxyEnableOldState = ConfigUtil.getConfigItem("useProxy", false);
      if (proxyEnableOldState) {
        ConfigUtil.setConfigItem("useManualProxy", true);
      }

      ConfigUtil.removeConfigItem("useProxy");
    }

    const proxyEnabled =
      ConfigUtil.getConfigItem("useManualProxy", false) ||
      ConfigUtil.getConfigItem("useSystemProxy", false);
    await session.fromPartition("persist:webviewsession").setProxy(
      proxyEnabled
        ? {
            pacScript: ConfigUtil.getConfigItem("proxyPAC", ""),
            proxyRules: ConfigUtil.getConfigItem("proxyRules", ""),
            proxyBypassRules: ConfigUtil.getConfigItem("proxyBypass", ""),
          }
        : {
            pacScript: "",
            proxyRules: "",
            proxyBypassRules: "",
          },
    );
  }

  // Settings are initialized only when user clicks on General/Server/Network section settings
  // In case, user doesn't visit these section, those values set to be null automatically
  // This will make sure the default settings are correctly set to either true or false
  initDefaultSettings(): void {
    // Default settings which should be respected
    const settingOptions: Partial<Config> = {
      autoHideMenubar: false,
      trayIcon: true,
      useManualProxy: false,
      useSystemProxy: false,
      showSidebar: true,
      badgeOption: true,
      startAtLogin: false,
      startMinimized: false,
      enableSpellchecker: true,
      showNotification: true,
      autoUpdate: true,
      betaUpdate: false,
      errorReporting: true,
      customCSS: false,
      silent: false,
      lastActiveTab: 0,
      dnd: false,
      dndPreviousSettings: {
        showNotification: true,
        silent: false,
      },
      downloadsPath: `${app.getPath("downloads")}`,
      quitOnClose: false,
      promptDownload: false,
    };

    // Platform specific settings

    if (process.platform === "win32") {
      // Only available on Windows
      settingOptions.flashTaskbarOnMessage = true;
      settingOptions.dndPreviousSettings!.flashTaskbarOnMessage = true;
    }

    if (process.platform === "darwin") {
      // Only available on macOS
      settingOptions.dockBouncing = true;
    }

    if (process.platform !== "darwin") {
      settingOptions.autoHideMenubar = false;
      settingOptions.spellcheckerLanguages = ["en-US"];
    }

    for (const [setting, value] of Object.entries(settingOptions) as Array<
      {[Key in keyof Config]: [Key, Config[Key]]}[keyof Config]
    >) {
      // Give preference to defaults defined in global_config.json
      if (EnterpriseUtil.configItemExists(setting)) {
        ConfigUtil.setConfigItem(
          setting,
          EnterpriseUtil.getConfigItem(setting, value),
          true,
        );
      } else if (!ConfigUtil.isConfigItemExists(setting)) {
        ConfigUtil.setConfigItem(setting, value);
      }
    }
  }

  initSidebar(): void {
    const showSidebar = ConfigUtil.getConfigItem("showSidebar", true);
    this.toggleSidebar(showSidebar);
  }

  // Remove the stale UA string from the disk if the app is not freshly
  // installed.  This should be removed in a further release.
  removeUAfromDisk(): void {
    ConfigUtil.removeConfigItem("userAgent");
  }

  async queueDomain(domain: string): Promise<boolean> {
    // Allows us to start adding multiple domains to the app simultaneously
    // promise of addition resolves in both cases, but we consider it rejected
    // if the resolved value is false
    try {
      const serverConf = await DomainUtil.checkDomain(domain);
      await DomainUtil.addDomain(serverConf);
      return true;
    } catch (error: unknown) {
      logger.error(error);
      logger.error(
        `Could not add ${domain}. Please contact your system administrator.`,
      );
      return false;
    }
  }

  async initPresetOrgs(): Promise<void> {
    // Read preset organizations from global_config.json and queues them
    // for addition to the app's domains
    const preAddedDomains = DomainUtil.getDomains();
    this.presetOrgs = EnterpriseUtil.getConfigItem("presetOrganizations", []);
    // Set to true if at least one new domain is added
    const domainPromises = [];
    for (const url of this.presetOrgs) {
      if (DomainUtil.duplicateDomain(url)) {
        continue;
      }

      domainPromises.push(this.queueDomain(url));
    }

    const domainsAdded = await Promise.all(domainPromises);
    if (domainsAdded.includes(true)) {
      // At least one domain was resolved
      if (preAddedDomains.length > 0) {
        // User already has servers added
        // ask them before reloading the app
        const {response} = await dialog.showMessageBox({
          type: "question",
          buttons: ["Yes", "Later"],
          defaultId: 0,
          message:
            "New server" +
            (domainsAdded.length > 1 ? "s" : "") +
            " added. Reload app now?",
        });
        if (response === 0) {
          ipcRenderer.send("reload-full-app");
        }
      } else {
        ipcRenderer.send("reload-full-app");
      }
    } else if (domainsAdded.length > 0) {
      // Find all orgs that failed
      const failedDomains: string[] = [];
      for (const org of this.presetOrgs) {
        if (DomainUtil.duplicateDomain(org)) {
          continue;
        }

        failedDomains.push(org);
      }

      const {title, content} = Messages.enterpriseOrgError(
        domainsAdded.length,
        failedDomains,
      );
      dialog.showErrorBox(title, content);
      if (DomainUtil.getDomains().length === 0) {
        // No orgs present, stop showing loading gif
        await this.openSettings("AddServer");
      }
    }
  }

  async initTabs(): Promise<void> {
    const servers = DomainUtil.getDomains();
    if (servers.length > 0) {
      for (const [i, server] of servers.entries()) {
        this.initServer(server, i);
      }

      // Open last active tab
      let lastActiveTab = ConfigUtil.getConfigItem("lastActiveTab", 0);
      if (lastActiveTab >= servers.length) {
        lastActiveTab = 0;
      }

      // `checkDomain()` and `webview.load()` for lastActiveTab before the others
      await DomainUtil.updateSavedServer(
        servers[lastActiveTab].url,
        lastActiveTab,
      );
      this.activateTab(lastActiveTab);
      await Promise.all(
        servers.map(async (server, i) => {
          // After the lastActiveTab is activated, we load the others in the background
          // without activating them, to prevent flashing of server icons
          if (i === lastActiveTab) {
            return;
          }

          await DomainUtil.updateSavedServer(server.url, i);
          this.tabs[i].webview.load();
        }),
      );
      // Remove focus from the settings icon at sidebar bottom
      this.$settingsButton.classList.remove("active");
    } else if (this.presetOrgs.length === 0) {
      // Not attempting to add organisations in the background
      await this.openSettings("AddServer");
    } else {
      this.showLoading(true);
    }
  }

  initServer(server: ServerConf, index: number): void {
    const tabIndex = this.getTabIndex();
    this.tabs.push(
      new ServerTab({
        role: "server",
        icon: server.icon,
        name: server.alias,
        $root: this.$tabsContainer,
        onClick: this.activateLastTab.bind(this, index),
        index,
        tabIndex,
        onHover: this.onHover.bind(this, index),
        onHoverOut: this.onHoverOut.bind(this, index),
        webview: new WebView({
          $root: this.$webviewsContainer,
          index,
          tabIndex,
          url: server.url,
          role: "server",
          name: server.alias,
          hasPermission: (origin: string, permission: string) =>
            origin === server.url && permission === "notifications",
          isActive: () => index === this.activeTabIndex,
          switchLoading: (loading: boolean, url: string) => {
            if (loading) {
              this.loading.add(url);
            } else {
              this.loading.delete(url);
            }

            this.showLoading(
              this.loading.has(
                this.tabs[this.activeTabIndex].webview.props.url,
              ),
            );
          },
          onNetworkError: (index: number) => {
            this.openNetworkTroubleshooting(index);
          },
          onTitleChange: this.updateBadge.bind(this),
          nodeIntegration: false,
          preload: true,
        }),
      }),
    );
    this.loading.add(server.url);
  }

  initActions(): void {
    this.initDNDButton();
    this.initServerActions();
    this.initLeftSidebarEvents();
  }

  initServerActions(): void {
    const $serverImgs: NodeListOf<HTMLImageElement> =
      document.querySelectorAll(".server-icons");
    for (const [index, $serverImg] of $serverImgs.entries()) {
      this.addContextMenu($serverImg, index);
      if ($serverImg.src.includes("img/icon.png")) {
        this.displayInitialCharLogo($serverImg, index);
      }

      $serverImg.addEventListener("error", () => {
        this.displayInitialCharLogo($serverImg, index);
      });
    }
  }

  initLeftSidebarEvents(): void {
    this.$dndButton.addEventListener("click", () => {
      const dndUtil = DNDUtil.toggle();
      ipcRenderer.send(
        "forward-message",
        "toggle-dnd",
        dndUtil.dnd,
        dndUtil.newSettings,
      );
    });
    this.$reloadButton.addEventListener("click", () => {
      this.tabs[this.activeTabIndex].webview.reload();
    });
    this.$addServerButton.addEventListener("click", async () => {
      await this.openSettings("AddServer");
    });
    this.$settingsButton.addEventListener("click", async () => {
      await this.openSettings("General");
    });
    this.$backButton.addEventListener("click", () => {
      this.tabs[this.activeTabIndex].webview.back();
    });

    this.sidebarHoverEvent(this.$addServerButton, this.$addServerTooltip, true);
    this.sidebarHoverEvent(this.$loadingIndicator, this.$loadingTooltip);
    this.sidebarHoverEvent(this.$settingsButton, this.$settingsTooltip);
    this.sidebarHoverEvent(this.$reloadButton, this.$reloadTooltip);
    this.sidebarHoverEvent(this.$backButton, this.$backTooltip);
    this.sidebarHoverEvent(this.$dndButton, this.$dndTooltip);
  }

  initDNDButton(): void {
    const dnd = ConfigUtil.getConfigItem("dnd", false);
    this.toggleDNDButton(dnd);
  }

  getTabIndex(): number {
    const currentIndex = this.tabIndex;
    this.tabIndex++;
    return currentIndex;
  }

  getCurrentActiveServer(): string {
    return this.tabs[this.activeTabIndex].webview.props.url;
  }

  displayInitialCharLogo($img: HTMLImageElement, index: number): void {
    // The index parameter is needed because webview[data-tab-id] can
    // increment beyond the size of the sidebar org array and throw an
    // error

    const $altIcon = document.createElement("div");
    const $parent = $img.parentElement!;
    const $container = $parent.parentElement!;
    const webviewId = $container.dataset.tabId!;
    const $webview = document.querySelector(
      `webview[data-tab-id="${CSS.escape(webviewId)}"]`,
    )!;
    const realmName = $webview.getAttribute("name");

    if (realmName === null) {
      $img.src = "/img/icon.png";
      return;
    }

    $altIcon.textContent = realmName.charAt(0) || "Z";
    $altIcon.classList.add("server-icon");
    $altIcon.classList.add("alt-icon");

    $img.remove();
    $parent.append($altIcon);

    this.addContextMenu($altIcon, index);
  }

  sidebarHoverEvent(
    SidebarButton: HTMLButtonElement,
    SidebarTooltip: HTMLElement,
    addServer = false,
  ): void {
    SidebarButton.addEventListener("mouseover", () => {
      SidebarTooltip.removeAttribute("style");
      // To handle position of add server tooltip due to scrolling of list of organizations
      // This could not be handled using CSS, hence the top of the tooltip is made same
      // as that of its parent element.
      // This needs to handled only for the add server tooltip and not others.
      if (addServer) {
        const {top} = SidebarButton.getBoundingClientRect();
        SidebarTooltip.style.top = `${top}px`;
      }
    });
    SidebarButton.addEventListener("mouseout", () => {
      SidebarTooltip.style.display = "none";
    });
  }

  onHover(index: number): void {
    // `this.$serverIconTooltip[index].textContent` already has realm name, so we are just
    // removing the style.
    this.$serverIconTooltip[index].removeAttribute("style");
    // To handle position of servers' tooltip due to scrolling of list of organizations
    // This could not be handled using CSS, hence the top of the tooltip is made same
    // as that of its parent element.
    const {top} =
      this.$serverIconTooltip[index].parentElement!.getBoundingClientRect();
    this.$serverIconTooltip[index].style.top = `${top}px`;
  }

  onHoverOut(index: number): void {
    this.$serverIconTooltip[index].style.display = "none";
  }

  openFunctionalTab(tabProps: FunctionalTabProps): void {
    if (this.functionalTabs.has(tabProps.name)) {
      this.activateTab(this.functionalTabs.get(tabProps.name)!);
      return;
    }

    this.functionalTabs.set(tabProps.name, this.tabs.length);

    const tabIndex = this.getTabIndex();

    this.tabs.push(
      new FunctionalTab({
        role: "function",
        materialIcon: tabProps.materialIcon,
        name: tabProps.name,
        $root: this.$tabsContainer,
        index: this.functionalTabs.get(tabProps.name)!,
        tabIndex,
        onClick: this.activateTab.bind(
          this,
          this.functionalTabs.get(tabProps.name)!,
        ),
        onDestroy: this.destroyTab.bind(
          this,
          tabProps.name,
          this.functionalTabs.get(tabProps.name)!,
        ),
        webview: new WebView({
          $root: this.$webviewsContainer,
          index: this.functionalTabs.get(tabProps.name)!,
          tabIndex,
          url: tabProps.url,
          role: "function",
          name: tabProps.name,
          isActive: () =>
            this.functionalTabs.get(tabProps.name) === this.activeTabIndex,
          switchLoading: (loading: boolean, url: string) => {
            if (loading) {
              this.loading.add(url);
            } else {
              this.loading.delete(url);
            }

            this.showLoading(
              this.loading.has(
                this.tabs[this.activeTabIndex].webview.props.url,
              ),
            );
          },
          onNetworkError: (index: number) => {
            this.openNetworkTroubleshooting(index);
          },
          onTitleChange: this.updateBadge.bind(this),
          nodeIntegration: true,
          preload: false,
        }),
      }),
    );

    // To show loading indicator the first time a functional tab is opened, indicator is
    // closed when the functional tab DOM is ready, handled in webview.js
    this.$webviewsContainer.classList.remove("loaded");

    this.activateTab(this.functionalTabs.get(tabProps.name)!);
  }

  async openSettings(nav: NavItem = "General"): Promise<void> {
    this.openFunctionalTab({
      name: "Settings",
      materialIcon: "settings",
      url: `file://${rendererDirectory}/preference.html#${nav}`,
    });
    this.$settingsButton.classList.add("active");
    await this.tabs[this.functionalTabs.get("Settings")!].webview.send(
      "switch-settings-nav",
      nav,
    );
  }

  openAbout(): void {
    this.openFunctionalTab({
      name: "About",
      materialIcon: "sentiment_very_satisfied",
      url: `file://${rendererDirectory}/about.html`,
    });
  }

  openNetworkTroubleshooting(index: number): void {
    const reconnectUtil = new ReconnectUtil(this.tabs[index].webview);
    reconnectUtil.pollInternetAndReload();
    this.tabs[
      index
    ].webview.props.url = `file://${rendererDirectory}/network.html`;
    this.tabs[index].showNetworkError();
  }

  activateLastTab(index: number): void {
    // Open all the tabs in background, also activate the tab based on the index
    this.activateTab(index);
    // Save last active tab via main process to avoid JSON DB errors
    ipcRenderer.send("save-last-tab", index);
  }

  // Returns this.tabs in an way that does
  // not crash app when this.tabs is passed into
  // ipcRenderer. Something about webview, and props.webview
  // properties in ServerTab causes the app to crash.
  get tabsForIpc(): TabData[] {
    return this.tabs.map((tab) => ({
      role: tab.props.role,
      name: tab.props.name,
      index: tab.props.index,
      webviewName: tab.webview.props.name,
    }));
  }

  activateTab(index: number, hideOldTab = true): void {
    if (!this.tabs[index]) {
      return;
    }

    if (this.activeTabIndex !== -1) {
      if (this.activeTabIndex === index) {
        return;
      }

      if (hideOldTab) {
        // If old tab is functional tab Settings, remove focus from the settings icon at sidebar bottom
        if (
          this.tabs[this.activeTabIndex].props.role === "function" &&
          this.tabs[this.activeTabIndex].props.name === "Settings"
        ) {
          this.$settingsButton.classList.remove("active");
        }

        this.tabs[this.activeTabIndex].deactivate();
      }
    }

    try {
      this.tabs[index].webview.canGoBackButton();
    } catch {}

    this.activeTabIndex = index;
    this.tabs[index].activate();

    this.showLoading(
      this.loading.has(this.tabs[this.activeTabIndex].webview.props.url),
    );

    ipcRenderer.send("update-menu", {
      // JSON stringify this.tabs to avoid a crash
      // util.inspect is being used to handle circular references
      tabs: this.tabsForIpc,
      activeTabIndex: this.activeTabIndex,
      // Following flag controls whether a menu item should be enabled or not
      enableMenu: this.tabs[index].props.role === "server",
    });
  }

  showLoading(loading: boolean): void {
    if (!loading) {
      this.$reloadButton.removeAttribute("style");
      this.$loadingIndicator.style.display = "none";
    } else if (loading) {
      this.$reloadButton.style.display = "none";
      this.$loadingIndicator.removeAttribute("style");
    }
  }

  destroyTab(name: string, index: number): void {
    if (this.tabs[index].webview.loading) {
      return;
    }

    this.tabs[index].destroy();

    delete this.tabs[index];
    this.functionalTabs.delete(name);

    // Issue #188: If the functional tab was not focused, do not activate another tab.
    if (this.activeTabIndex === index) {
      this.activateTab(0, false);
    }
  }

  destroyView(): void {
    // Show loading indicator
    this.$webviewsContainer.classList.remove("loaded");

    // Clear global variables
    this.activeTabIndex = -1;
    this.tabs = [];
    this.functionalTabs.clear();

    // Clear DOM elements
    this.$tabsContainer.textContent = "";
    this.$webviewsContainer.textContent = "";
  }

  async reloadView(): Promise<void> {
    // Save and remember the index of last active tab so that we can use it later
    const lastActiveTab = this.tabs[this.activeTabIndex].props.index;
    ConfigUtil.setConfigItem("lastActiveTab", lastActiveTab);

    // Destroy the current view and re-initiate it
    this.destroyView();
    await this.initTabs();
    this.initServerActions();
  }

  // This will trigger when pressed CTRL/CMD + R [WIP]
  // It won't reload the current view properly when you add/delete a server.
  reloadCurrentView(): void {
    this.$reloadButton.click();
  }

  updateBadge(): void {
    let messageCountAll = 0;
    for (const tab of this.tabs) {
      if (tab && tab instanceof ServerTab && tab.updateBadge) {
        const count = tab.webview.badgeCount;
        messageCountAll += count;
        tab.updateBadge(count);
      }
    }

    ipcRenderer.send("update-badge", messageCountAll);
  }

  updateGeneralSettings<Channel extends keyof RendererMessage>(
    channel: Channel,
    ...args: Parameters<RendererMessage[Channel]>
  ): void {
    if (this.getActiveWebview()) {
      const webContentsId = this.getActiveWebview().getWebContentsId();
      ipcRenderer.sendTo(webContentsId, channel, ...args);
    }
  }

  toggleSidebar(show: boolean): void {
    if (show) {
      this.$sidebar.classList.remove("sidebar-hide");
    } else {
      this.$sidebar.classList.add("sidebar-hide");
    }
  }

  // Toggles the dnd button icon.
  toggleDNDButton(alert: boolean): void {
    this.$dndTooltip.textContent =
      (alert ? "Disable" : "Enable") + " Do Not Disturb";
    this.$dndButton.querySelector("i")!.textContent = alert
      ? "notifications_off"
      : "notifications";
  }

  isLoggedIn(tabIndex: number): boolean {
    const url = this.tabs[tabIndex].webview.$el!.src;
    return !(url.endsWith("/login/") || this.tabs[tabIndex].webview.loading);
  }

  getActiveWebview(): Electron.WebviewTag {
    const selector = "webview:not(.disabled)";
    const webview: Electron.WebviewTag = document.querySelector(selector)!;
    return webview;
  }

  addContextMenu($serverImg: HTMLElement, index: number): void {
    $serverImg.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const template = [
        {
          label: "Disconnect organization",
          click: async () => {
            const {response} = await dialog.showMessageBox({
              type: "warning",
              buttons: ["YES", "NO"],
              defaultId: 0,
              message: "Are you sure you want to disconnect this organization?",
            });
            if (response === 0) {
              if (DomainUtil.removeDomain(index)) {
                ipcRenderer.send("reload-full-app");
              } else {
                const {title, content} = Messages.orgRemovalError(
                  DomainUtil.getDomain(index).url,
                );
                dialog.showErrorBox(title, content);
              }
            }
          },
        },
        {
          label: "Notification settings",
          enabled: this.isLoggedIn(index),
          click: async () => {
            // Switch to tab whose icon was right-clicked
            this.activateTab(index);
            await this.tabs[index].webview.showNotificationSettings();
          },
        },
        {
          label: "Copy Zulip URL",
          click: () => {
            clipboard.writeText(DomainUtil.getDomain(index).url);
          },
        },
      ];
      const contextMenu = Menu.buildFromTemplate(template);
      contextMenu.popup({window: remote.getCurrentWindow()});
    });
  }

  registerIpcs(): void {
    const webviewListeners: Array<
      [WebviewListener, (webview: WebView) => void | Promise<void>]
    > = [
      [
        "webview-reload",
        (webview) => {
          webview.reload();
        },
      ],
      [
        "back",
        (webview) => {
          webview.back();
        },
      ],
      [
        "focus",
        (webview) => {
          webview.focus();
        },
      ],
      [
        "forward",
        (webview) => {
          webview.forward();
        },
      ],
      [
        "zoomIn",
        (webview) => {
          webview.zoomIn();
        },
      ],
      [
        "zoomOut",
        (webview) => {
          webview.zoomOut();
        },
      ],
      [
        "zoomActualSize",
        (webview) => {
          webview.zoomActualSize();
        },
      ],
      [
        "log-out",
        async (webview) => {
          await webview.logOut();
        },
      ],
      [
        "show-keyboard-shortcuts",
        async (webview) => {
          await webview.showKeyboardShortcuts();
        },
      ],
      [
        "tab-devtools",
        (webview) => {
          webview.openDevTools();
        },
      ],
    ];

    for (const [channel, listener] of webviewListeners) {
      ipcRenderer.on(channel, async () => {
        const activeWebview = this.tabs[this.activeTabIndex].webview;
        if (activeWebview) {
          await listener(activeWebview);
        }
      });
    }

    ipcRenderer.on(
      "permission-request",
      (
        event: Event,
        {
          webContentsId,
          origin,
          permission,
        }: {
          webContentsId: number | null;
          origin: string;
          permission: string;
        },
        permissionCallbackId: number,
      ) => {
        const grant =
          webContentsId === null
            ? origin === "null" && permission === "notifications"
            : this.tabs.some(
                ({webview}) =>
                  !webview.loading &&
                  webview.$el!.getWebContentsId() === webContentsId &&
                  webview.props.hasPermission?.(origin, permission),
              );
        console.log(
          grant ? "Granted" : "Denied",
          "permissions request for",
          permission,
          "from",
          origin,
        );
        ipcRenderer.send("permission-callback", permissionCallbackId, grant);
      },
    );

    ipcRenderer.on("show-network-error", (event: Event, index: number) => {
      this.openNetworkTroubleshooting(index);
    });

    ipcRenderer.on("open-settings", async () => {
      let numberServers = 0;
      for (const tab of this.tabs) {
        if (tab.props.role === "server") {
          numberServers++;
        }
      }

      if (numberServers === 1) {
        const value = ConfigUtil.getConfigItem("showSidebar");
        if (!value) {
          const newValue = !value;
          this.toggleSidebar(newValue);
          this.updateGeneralSettings("toggle-sidebar-setting", newValue);
          ConfigUtil.setConfigItem("showSidebar", newValue);
        }
      }

      await this.openSettings();
    });

    ipcRenderer.on("open-about", this.openAbout.bind(this));

    ipcRenderer.on("open-help", async () => {
      // Open help page of current active server
      await LinkUtil.openBrowser(new URL("https://zulip.com/help/"));
    });

    ipcRenderer.on(
      "reload-viewer",
      this.reloadView.bind(this, this.tabs[this.activeTabIndex].props.index),
    );

    ipcRenderer.on("reload-current-viewer", this.reloadCurrentView.bind(this));

    ipcRenderer.on("hard-reload", () => {
      ipcRenderer.send("reload-full-app");
    });

    ipcRenderer.on("switch-server-tab", (event: Event, index: number) => {
      this.activateLastTab(index);
    });

    ipcRenderer.on("open-org-tab", async () => {
      await this.openSettings("AddServer");
    });

    ipcRenderer.on("reload-proxy", async (event: Event, showAlert: boolean) => {
      await this.loadProxy();
      if (showAlert) {
        await dialog.showMessageBox({
          message: "Proxy settings saved!",
          buttons: ["OK"],
        });
        ipcRenderer.send("reload-full-app");
      }
    });

    ipcRenderer.on("toggle-sidebar", (event: Event, show: boolean) => {
      // Toggle the left sidebar
      this.toggleSidebar(show);

      // Toggle sidebar switch in the general settings
      this.updateGeneralSettings("toggle-sidebar-setting", show);
    });

    ipcRenderer.on("toggle-silent", (event: Event, state: boolean) => {
      const webviews: NodeListOf<Electron.WebviewTag> =
        document.querySelectorAll("webview");
      for (const webview of webviews) {
        try {
          webview.setAudioMuted(state);
        } catch {
          // Webview is not ready yet
          webview.addEventListener("dom-ready", () => {
            webview.setAudioMuted(state);
          });
        }
      }
    });

    ipcRenderer.on(
      "toggle-autohide-menubar",
      (event: Event, autoHideMenubar: boolean, updateMenu: boolean) => {
        if (updateMenu) {
          ipcRenderer.send("update-menu", {
            tabs: this.tabsForIpc,
            activeTabIndex: this.activeTabIndex,
          });
          return;
        }

        this.updateGeneralSettings("toggle-menubar-setting", autoHideMenubar);
      },
    );

    ipcRenderer.on(
      "toggle-dnd",
      (event: Event, state: boolean, newSettings: Partial<DNDSettings>) => {
        this.toggleDNDButton(state);
        ipcRenderer.send(
          "forward-message",
          "toggle-silent",
          newSettings.silent ?? false,
        );
        const webContentsId = this.getActiveWebview().getWebContentsId();
        ipcRenderer.sendTo(webContentsId, "toggle-dnd", state, newSettings);
      },
    );

    ipcRenderer.on(
      "update-realm-name",
      (event: Event, serverURL: string, realmName: string) => {
        for (const [index, domain] of DomainUtil.getDomains().entries()) {
          if (domain.url.includes(serverURL)) {
            const serverTooltipSelector = ".tab .server-tooltip";
            const serverTooltips = document.querySelectorAll(
              serverTooltipSelector,
            );
            serverTooltips[index].textContent = realmName;
            this.tabs[index].props.name = realmName;
            this.tabs[index].webview.props.name = realmName;

            domain.alias = realmName;
            DomainUtil.updateDomain(index, domain);
            // Update the realm name also on the Window menu
            ipcRenderer.send("update-menu", {
              tabs: this.tabsForIpc,
              activeTabIndex: this.activeTabIndex,
            });
          }
        }
      },
    );

    ipcRenderer.on(
      "update-realm-icon",
      async (event: Event, serverURL: string, iconURL: string) => {
        await Promise.all(
          DomainUtil.getDomains().map(async (domain, index) => {
            if (domain.url.includes(serverURL)) {
              const localIconUrl: string = await DomainUtil.saveServerIcon(
                iconURL,
              );
              const serverImgsSelector = ".tab .server-icons";
              const serverImgs: NodeListOf<HTMLImageElement> =
                document.querySelectorAll(serverImgsSelector);
              serverImgs[index].src = localIconUrl;
              domain.icon = localIconUrl;
              DomainUtil.updateDomain(index, domain);
            }
          }),
        );
      },
    );

    ipcRenderer.on("enter-fullscreen", () => {
      this.$fullscreenPopup.classList.add("show");
      this.$fullscreenPopup.classList.remove("hidden");
    });

    ipcRenderer.on("leave-fullscreen", () => {
      this.$fullscreenPopup.classList.remove("show");
    });

    ipcRenderer.on(
      "focus-webview-with-id",
      (event: Event, webviewId: number) => {
        const webviews: NodeListOf<Electron.WebviewTag> =
          document.querySelectorAll("webview");
        for (const webview of webviews) {
          const currentId = webview.getWebContentsId();
          const tabId = webview.getAttribute("data-tab-id")!;
          const concurrentTab: HTMLButtonElement = document.querySelector(
            `div[data-tab-id="${CSS.escape(tabId)}"]`,
          )!;
          if (currentId === webviewId) {
            concurrentTab.click();
          }
        }
      },
    );

    ipcRenderer.on(
      "render-taskbar-icon",
      (event: Event, messageCount: number) => {
        // Create a canvas from unread messagecounts
        function createOverlayIcon(messageCount: number): HTMLCanvasElement {
          const canvas = document.createElement("canvas");
          canvas.height = 128;
          canvas.width = 128;
          canvas.style.letterSpacing = "-5px";
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#f42020";
          ctx.beginPath();
          ctx.ellipse(64, 64, 64, 64, 0, 0, 2 * Math.PI);
          ctx.fill();
          ctx.textAlign = "center";
          ctx.fillStyle = "white";
          if (messageCount > 99) {
            ctx.font = "65px Helvetica";
            ctx.fillText("99+", 64, 85);
          } else if (messageCount < 10) {
            ctx.font = "90px Helvetica";
            ctx.fillText(String(Math.min(99, messageCount)), 64, 96);
          } else {
            ctx.font = "85px Helvetica";
            ctx.fillText(String(Math.min(99, messageCount)), 64, 90);
          }

          return canvas;
        }

        ipcRenderer.send(
          "update-taskbar-icon",
          createOverlayIcon(messageCount).toDataURL(),
          String(messageCount),
        );
      },
    );

    ipcRenderer.on("open-feedback-modal", () => {
      feedbackHolder.classList.add("show");
    });

    ipcRenderer.on("copy-zulip-url", () => {
      clipboard.writeText(this.getCurrentActiveServer());
    });

    ipcRenderer.on("new-server", async () => {
      await this.openSettings("AddServer");
    });

    ipcRenderer.on("set-active", () => {
      const webviews: NodeListOf<Electron.WebviewTag> =
        document.querySelectorAll("webview");
      for (const webview of webviews) {
        ipcRenderer.sendTo(webview.getWebContentsId(), "set-active");
      }
    });

    ipcRenderer.on("set-idle", () => {
      const webviews: NodeListOf<Electron.WebviewTag> =
        document.querySelectorAll("webview");
      for (const webview of webviews) {
        ipcRenderer.sendTo(webview.getWebContentsId(), "set-idle");
      }
    });

    ipcRenderer.on("open-network-settings", async () => {
      await this.openSettings("Network");
    });
  }
}

window.addEventListener("load", async () => {
  const serverManagerView = new ServerManagerView();
  await serverManagerView.init();
});

export {};
