import {ipcRenderer, remote, clipboard} from 'electron';
import path from 'path';

import isDev from 'electron-is-dev';

import * as Messages from '../../resources/messages';

import FunctionalTab from './components/functional-tab';
import ServerTab from './components/server-tab';
import {feedbackHolder} from './feedback';
import * as ConfigUtil from './utils/config-util';
import * as DNDUtil from './utils/dnd-util';
import type {DNDSettings} from './utils/dnd-util';
import * as DomainUtil from './utils/domain-util';
import * as EnterpriseUtil from './utils/enterprise-util';
import * as LinkUtil from './utils/link-util';
import Logger from './utils/logger-util';
import ReconnectUtil from './utils/reconnect-util';

// eslint-disable-next-line import/no-unassigned-import
import './tray';

const {session, app, Menu, dialog} = remote;

interface FunctionalTabProps {
	name: string;
	materialIcon: string;
	url: string;
}

interface SettingsOptions extends DNDSettings {
	autoHideMenubar: boolean;
	trayIcon: boolean;
	useManualProxy: boolean;
	useSystemProxy: boolean;
	showSidebar: boolean;
	badgeOption: boolean;
	startAtLogin: boolean;
	startMinimized: boolean;
	enableSpellchecker: boolean;
	autoUpdate: boolean;
	betaUpdate: boolean;
	errorReporting: boolean;
	customCSS: boolean;
	lastActiveTab: number;
	dnd: boolean;
	dndPreviousSettings: DNDSettings;
	downloadsPath: string;
	quitOnClose: boolean;
	promptDownload: boolean;
	dockBouncing?: boolean;
	spellcheckerLanguages?: string[];
}

const logger = new Logger({
	file: 'errors.log',
	timestamp: true
});

const rendererDirectory = path.resolve(__dirname, '..');
type ServerOrFunctionalTab = ServerTab | FunctionalTab;

export interface TabData {
	role: string;
	name: string;
	index: number;
}

class ServerManagerView {
	$addServerButton: HTMLButtonElement;
	$tabsContainer: Element;
	$reloadButton: HTMLButtonElement;
	$loadingIndicator: HTMLButtonElement;
	$settingsButton: HTMLButtonElement;
	$viewsContainer: Element;
	$backButton: HTMLButtonElement;
	$dndButton: HTMLButtonElement;
	$sidebar: Element;
	$fullscreenPopup: Element;
	$fullscreenEscapeKey: string;
	loading: Set<string>;
	badgeCounts: {[key: string]: any};
	activeTabIndex: number;
	tabs: ServerOrFunctionalTab[];
	functionalTabs: Map<string, number>;
	tabIndex: number;
	presetOrgs: string[];
	constructor() {
		this.$addServerButton = document.querySelector('#add-tab');
		this.$tabsContainer = document.querySelector('#tabs-container');

		const $actionsContainer = document.querySelector('#actions-container');
		this.$reloadButton = $actionsContainer.querySelector('#reload-action');
		this.$loadingIndicator = $actionsContainer.querySelector('#loading-action');
		this.$settingsButton = $actionsContainer.querySelector('#settings-action');
		this.$viewsContainer = document.querySelector('#views-container');
		this.$backButton = $actionsContainer.querySelector('#back-action');
		this.$dndButton = $actionsContainer.querySelector('#dnd-action');

		this.$sidebar = document.querySelector('#sidebar');

		this.$fullscreenPopup = document.querySelector('#fullscreen-popup');
		this.$fullscreenEscapeKey = process.platform === 'darwin' ? '^⌘F' : 'F11';
		this.$fullscreenPopup.textContent = `Press ${this.$fullscreenEscapeKey} to exit full screen`;

		this.loading = new Set();
		this.badgeCounts = {};
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
		ipcRenderer.send('set-spellcheck-langs');
	}

	async loadProxy(): Promise<void> {
		// To change proxyEnable to useManualProxy in older versions
		const proxyEnabledOld = ConfigUtil.isConfigItemExists('useProxy');
		if (proxyEnabledOld) {
			const proxyEnableOldState = ConfigUtil.getConfigItem('useProxy');
			if (proxyEnableOldState) {
				ConfigUtil.setConfigItem('useManualProxy', true);
			}

			ConfigUtil.removeConfigItem('useProxy');
		}

		const proxyEnabled = ConfigUtil.getConfigItem('useManualProxy') || ConfigUtil.getConfigItem('useSystemProxy');
		await session.fromPartition('persist:webviewsession').setProxy(proxyEnabled ? {
			pacScript: ConfigUtil.getConfigItem('proxyPAC', ''),
			proxyRules: ConfigUtil.getConfigItem('proxyRules', ''),
			proxyBypassRules: ConfigUtil.getConfigItem('proxyBypass', '')
		} : {
			pacScript: '',
			proxyRules: '',
			proxyBypassRules: ''
		});
	}

	// Settings are initialized only when user clicks on General/Server/Network section settings
	// In case, user doesn't visit these section, those values set to be null automatically
	// This will make sure the default settings are correctly set to either true or false
	initDefaultSettings(): void {
		// Default settings which should be respected
		const settingOptions: SettingsOptions = {
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
				silent: false
			},
			downloadsPath: `${app.getPath('downloads')}`,
			quitOnClose: false,
			promptDownload: false
		};

		// Platform specific settings

		if (process.platform === 'win32') {
			// Only available on Windows
			settingOptions.flashTaskbarOnMessage = true;
			settingOptions.dndPreviousSettings.flashTaskbarOnMessage = true;
		}

		if (process.platform === 'darwin') {
			// Only available on macOS
			settingOptions.dockBouncing = true;
		}

		if (process.platform !== 'darwin') {
			settingOptions.autoHideMenubar = false;
			settingOptions.spellcheckerLanguages = ['en-US'];
		}

		for (const [setting, value] of Object.entries(settingOptions)) {
			// Give preference to defaults defined in global_config.json
			if (EnterpriseUtil.configItemExists(setting)) {
				ConfigUtil.setConfigItem(setting, EnterpriseUtil.getConfigItem(setting), true);
			} else if (ConfigUtil.getConfigItem(setting) === null) {
				ConfigUtil.setConfigItem(setting, value);
			}
		}
	}

	initSidebar(): void {
		const showSidebar = ConfigUtil.getConfigItem('showSidebar', true);
		this.toggleSidebar(showSidebar);
	}

	// Remove the stale UA string from the disk if the app is not freshly
	// installed.  This should be removed in a further release.
	removeUAfromDisk(): void {
		ConfigUtil.removeConfigItem('userAgent');
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
			logger.error(`Could not add ${domain}. Please contact your system administrator.`);
			return false;
		}
	}

	async initPresetOrgs(): Promise<void> {
		// Read preset organizations from global_config.json and queues them
		// for addition to the app's domains
		const preAddedDomains = DomainUtil.getDomains();
		this.presetOrgs = EnterpriseUtil.getConfigItem('presetOrganizations', []);
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
					type: 'question',
					buttons: ['Yes', 'Later'],
					defaultId: 0,
					message: 'New server' + (domainsAdded.length > 1 ? 's' : '') + ' added. Reload app now?'
				});
				if (response === 0) {
					ipcRenderer.send('reload-full-app');
				}
			} else {
				ipcRenderer.send('reload-full-app');
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

			const {title, content} = Messages.enterpriseOrgError(domainsAdded.length, failedDomains);
			dialog.showErrorBox(title, content);
			if (DomainUtil.getDomains().length === 0) {
				// No orgs present, stop showing loading gif
				await this.openSettings('AddServer');
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
			let lastActiveTab = ConfigUtil.getConfigItem('lastActiveTab');
			if (lastActiveTab >= servers.length) {
				lastActiveTab = 0;
			}

			// `checkDomain()` and `webview.load()` for lastActiveTab before the others
			await DomainUtil.updateSavedServer(servers[lastActiveTab].url, lastActiveTab);
			this.activateTab(lastActiveTab);
			await Promise.all(servers.map(async (server, i) => {
				// After the lastActiveTab is activated, we load the others in the background
				// without activating them, to prevent flashing of server icons
				if (i === lastActiveTab) {
					return;
				}

				await DomainUtil.updateSavedServer(server.url, i);
			}));
			// Remove focus from the settings icon at sidebar bottom
			this.$settingsButton.classList.remove('active');
		} else if (this.presetOrgs.length === 0) {
			// Not attempting to add organisations in the background
			await this.openSettings('AddServer');
		} else {
			this.showLoading(true);
		}
	}

	initServer(server: DomainUtil.ServerConf, index: number): void {
		const tabIndex = this.getTabIndex();
		this.tabs.push(new ServerTab({
			role: 'server',
			icon: server.icon,
			name: server.alias,
			$root: this.$tabsContainer,
			onClick: this.activateLastTab.bind(this, index),
			index,
			tabIndex,
			url: server.url
		}));
		const props = {
			index,
			url: server.url,
			role: 'server',
			name: CommonUtil.decodeString(server.alias),
			nodeIntegration: false,
			preload: true
		};
		ipcRenderer.send('create-view', props);
		this.loading.add(server.url);
	}

	initActions(): void {
		this.initDNDButton();
		this.initServerActions();
		this.initLeftSidebarEvents();
	}

	initServerActions(): void {
		const $serverImgs: NodeListOf<HTMLImageElement> = document.querySelectorAll('.server-icons');
		$serverImgs.forEach(($serverImg, index) => {
			this.addContextMenu($serverImg, index);
			if ($serverImg.src.includes('img/icon.png')) {
				this.displayInitialCharLogo($serverImg, index);
			}

			$serverImg.addEventListener('error', () => {
				this.displayInitialCharLogo($serverImg, index);
			});
		});
	}

	initLeftSidebarEvents(): void {
		this.$dndButton.addEventListener('click', () => {
			const dndUtil = DNDUtil.toggle();
			ipcRenderer.send('forward-message', 'toggle-dnd', dndUtil.dnd, dndUtil.newSettings);
		});
		this.$reloadButton.addEventListener('click', () => {
			ipcRenderer.send('call-view-function', 'reload');
		});
		this.$addServerButton.addEventListener('click', async () => {
			await this.openSettings('AddServer');
		});
		this.$settingsButton.addEventListener('click', async () => {
			await this.openSettings('General');
		});
		this.$backButton.addEventListener('click', () => {
			ipcRenderer.send('call-view-function', 'back');
		});
	}

	initDNDButton(): void {
		const dnd = ConfigUtil.getConfigItem('dnd', false);
		this.toggleDNDButton(dnd);
	}

	getTabIndex(): number {
		const currentIndex = this.tabIndex;
		this.tabIndex++;
		return currentIndex;
	}

	getCurrentActiveServer(): string {
		return this.tabs[this.activeTabIndex].props.url;
	}

	displayInitialCharLogo($img: HTMLImageElement, index: number): void {
		// The index parameter is needed because webview[data-tab-id] can
		// increment beyond the size of the sidebar org array and throw an
		// error

		const $altIcon = document.createElement('div');
		const $parent = $img.parentElement;
		const realmName = this.tabs[index].props.name;

		if (realmName === null) {
			$img.src = '/img/icon.png';
			return;
		}

		$altIcon.textContent = realmName.charAt(0) || 'Z';
		$altIcon.classList.add('server-icon');
		$altIcon.classList.add('alt-icon');

		$img.remove();
		$parent.append($altIcon);

		this.addContextMenu($altIcon as HTMLImageElement, index);
	}

	openFunctionalTab(tabProps: FunctionalTabProps): void {
		if (this.functionalTabs.has(tabProps.name)) {
			this.activateTab(this.functionalTabs.get(tabProps.name));
			return;
		}

		this.functionalTabs.set(tabProps.name, this.tabs.length);

		const tabIndex = this.getTabIndex();

		this.tabs.push(new FunctionalTab({
			role: 'function',
			materialIcon: tabProps.materialIcon,
			name: tabProps.name,
			$root: this.$tabsContainer,
			index: this.functionalTabs.get(tabProps.name),
			tabIndex,
			onClick: this.activateTab.bind(this, this.functionalTabs.get(tabProps.name)),
			onDestroy: this.destroyTab.bind(this, tabProps.name, this.functionalTabs.get(tabProps.name)),
			url: tabProps.url
		}));
		const props = {
			index: this.functionalTabs.get(tabProps.name),
			url: tabProps.url,
			role: 'function',
			name: tabProps.name,
			nodeIntegration: true,
			preload: false
		};
		ipcRenderer.send('create-view', props);
		// To show loading indicator the first time a functional tab is opened, indicator is
		// overlapped by the view when the functional tab DOM is ready
		this.$viewsContainer.classList.remove('loaded');

		this.activateTab(this.functionalTabs.get(tabProps.name));
	}

	async openSettings(nav = 'General'): Promise<void> {
		this.openFunctionalTab({
			name: 'Settings',
			materialIcon: 'settings',
			url: `file://${rendererDirectory}/preference.html#${nav}`
		});
		this.$settingsButton.classList.add('active');
		ipcRenderer.send('forward-view-message', 'switch-settings-nav', nav);
	}

	openAbout(): void {
		this.openFunctionalTab({
			name: 'About',
			materialIcon: 'sentiment_very_satisfied',
			url: `file://${rendererDirectory}/about.html`
		});
	}

	openNetworkTroubleshooting(index: number): void {
		const reconnectUtil = new ReconnectUtil(this.tabs[index].props.url);
		reconnectUtil.pollInternetAndReload();
		const errorUrl = `file://${rendererDirectory}/network.html`;
		ipcRenderer.send('switch-url', index, errorUrl);
	}

	activateLastTab(index: number): void {
		// Open all the tabs in background, also activate the tab based on the index
		this.activateTab(index);
		// Save last active tab via main process to avoid JSON DB errors
		ipcRenderer.send('save-last-tab', index);
	}

	// Returns this.tabs in an way that does
	// not crash app when this.tabs is passed into
	// ipcRenderer. Something about webview, and props.webview
	// properties in ServerTab causes the app to crash.
	get tabsForIpc(): TabData[] {
		return this.tabs.map(tab => ({
			role: tab.props.role,
			name: tab.props.name,
			index: tab.props.index,
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
				if (this.tabs[this.activeTabIndex].props.role === 'function' && this.tabs[this.activeTabIndex].props.name === 'Settings') {
					this.$settingsButton.classList.remove('active');
				}

				this.tabs[this.activeTabIndex].deactivate();
			}
		}

		this.activeTabIndex = index;
		this.tabs[index].activate();
		ipcRenderer.send('select-view', index);
		this.showLoading(this.loading.has(this.tabs[this.activeTabIndex].props.url));
		ipcRenderer.send('call-view-function', 'canGoBackButton');
		ipcRenderer.send('update-menu', {
			// JSON stringify this.tabs to avoid a crash
			// util.inspect is being used to handle circular references
			tabs: this.tabsForIpc,
			activeTabIndex: this.activeTabIndex,
			// Following flag controls whether a menu item should be enabled or not
			enableMenu: this.tabs[index].props.role === 'server'
		});
	}

	showLoading(loading: boolean): void {
		if (!loading) {
			this.$reloadButton.removeAttribute('style');
			this.$loadingIndicator.style.display = 'none';
		} else if (loading) {
			this.$reloadButton.style.display = 'none';
			this.$loadingIndicator.removeAttribute('style');
		}
	}

	destroyTab(name: string, index: number): void {
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
		this.$viewsContainer.classList.remove('loaded');

		ipcRenderer.send('destroy-all-views');

		// Clear global variables
		this.activeTabIndex = -1;
		this.tabs = [];
		this.functionalTabs.clear();

		// Clear DOM elements
		this.$tabsContainer.textContent = '';
		this.$viewsContainer.textContent = '';
	}

	async reloadView(): Promise<void> {
		// Save and remember the index of last active tab so that we can use it later
		const lastActiveTab = this.tabs[this.activeTabIndex].props.index;
		ConfigUtil.setConfigItem('lastActiveTab', lastActiveTab);

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
				const count = this.badgeCounts[tab.props.url];
				messageCountAll += count;
				tab.updateBadge(count);
			}
		}
		if (Number.isInteger(messageCountAll)) {
			ipcRenderer.send('update-badge', messageCountAll);
		}
	}

	updateGeneralSettings(setting: string, value: unknown): void {
		ipcRenderer.send('forward-view-message', setting, value);
	}

	toggleSidebar(show: boolean): void {
		if (show) {
			this.$sidebar.classList.remove('sidebar-hide');
		} else {
			this.$sidebar.classList.add('sidebar-hide');
		}
		this.fixBounds();
	}

	// Fixes bounds for view
	fixBounds(): void {
		ipcRenderer.send('fix-bounds');
	}

	// Toggles the dnd button icon.
	toggleDNDButton(alert: boolean): void {
		this.$dndButton.title = (alert ? 'Disable' : 'Enable') + ' Do Not Disturb';
		this.$dndButton.querySelector('i').textContent = alert ? 'notifications_off' : 'notifications';
	}

	isLoggedIn(tabIndex: number): boolean {
		const domains = DomainUtil.getDomains();
		for (const domain of domains) {
			if (domain.url === this.tabs[tabIndex].props.url) {
				if (domain.loggedIn && !this.loading.has(domain.url)) {
					return true;
				}
				// match returned false
				return false;
			}
		}
		return false;
	}

	addContextMenu($serverImg: HTMLImageElement, index: number): void {
		$serverImg.addEventListener('contextmenu', event => {
			event.preventDefault();
			const template = [
				{
					label: 'Disconnect organization',
					click: async () => {
						const {response} = await dialog.showMessageBox({
							type: 'warning',
							buttons: ['YES', 'NO'],
							defaultId: 0,
							message: 'Are you sure you want to disconnect this organization?'
						});
						if (response === 0) {
							// Set lastActiveTab to 0th index
							if (DomainUtil.removeDomain(index)) {
								ConfigUtil.setConfigItem('lastActiveTab', 0);
								ipcRenderer.send('reload-full-app');
							} else {
								const {title, content} = Messages.orgRemovalError(DomainUtil.getDomain(index).url);
								dialog.showErrorBox(title, content);
							}
						}
					}
				},
				{
					label: 'Notification settings',
					// enabled: this.isLoggedIn(index),
					click: () => {
						// Switch to tab whose icon was right-clicked
						this.activateTab(index);
						ipcRenderer.send('show-notification-settings', index);
					}
				},
				{
					label: 'Copy Zulip URL',
					click: () => {
						clipboard.writeText(DomainUtil.getDomain(index).url);
					}
				}
			];
			const contextMenu = Menu.buildFromTemplate(template);
			contextMenu.popup({window: remote.getCurrentWindow()});
		});
	}

	registerIpcs(): void {
		const viewListeners: any = {
			// 'webview-reload': 'reload',
			back: 'back',
			focus: 'focus',
			forward: 'forward',
			zoomIn: 'zoomIn',
			zoomOut: 'zoomOut',
			zoomActualSize: 'zoomActualSize',
			'log-out': 'logOut',
			shortcut: 'showShortcut',
			'tab-devtools': 'toggleDevTools'
		};

		for (const key in viewListeners) {
			ipcRenderer.on(key, () => {
				ipcRenderer.send('call-view-function', viewListeners[key]);
			});
		}

		// ipcRenderer.on('permission-request', ( // TODO: Get this ipc call running without webview parameter
		// 	event: Event,
		// 	{webContentsId, origin, permission}: {
		// 		webContentsId: number | null;
		// 		origin: string;
		// 		permission: string;
		// 	},
		// 	rendererCallbackId: number
		// ) => {
		// 	const grant = webContentsId === null ?
		// 		origin === 'null' && permission === 'notifications' :
		// 		this.tabs.some(
		// 			({webview}) =>
		// 				!webview.loading &&
		// 				webview.$el.getWebContentsId() === webContentsId &&
		// 				webview.props.hasPermission?.(origin, permission)
		// 		);
		// 	console.log(
		// 		grant ? 'Granted' : 'Denied', 'permissions request for',
		// 		permission, 'from', origin
		// 	);
		// 	ipcRenderer.send('renderer-callback', rendererCallbackId, grant);
		// });
		ipcRenderer.on('set-logged-in', (event: Event, loggedIn: boolean, index: number) => {
			const domain = DomainUtil.getDomain(index);
			domain.loggedIn = loggedIn;
			DomainUtil.updateDomain(index, domain);
		});

		ipcRenderer.on('show-network-error', (event: Event, index: number) => {
			this.openNetworkTroubleshooting(index);
		});

		ipcRenderer.on('open-settings', async (event: Event, settingNav: string) => {
			await this.openSettings(settingNav);
		});

		ipcRenderer.on('open-about', this.openAbout.bind(this));

		ipcRenderer.on('open-help', async () => {
			// Open help page of current active server
			await LinkUtil.openBrowser(new URL('https://zulip.com/help/'));
		});

		ipcRenderer.on('reload-viewer', this.reloadView.bind(this, this.tabs[this.activeTabIndex].props.index));

		ipcRenderer.on('reload-current-viewer', this.reloadCurrentView.bind(this));

		ipcRenderer.on('hard-reload', () => {
			ipcRenderer.send('reload-full-app');
		});

		ipcRenderer.on('switch-server-tab', (event: Event, index: number) => {
			this.activateLastTab(index);
		});

		ipcRenderer.on('open-org-tab', async () => {
			await this.openSettings('AddServer');
		});

		ipcRenderer.on('reload-proxy', async (event: Event, showAlert: boolean) => {
			await this.loadProxy();
			if (showAlert) {
				await dialog.showMessageBox({
					message: 'Proxy settings saved!',
					buttons: ['OK']
				});
				ipcRenderer.send('reload-full-app');
			}
		});

		ipcRenderer.on('toggle-sidebar', (event: Event, show: boolean) => {
			// Toggle the left sidebar
			this.toggleSidebar(show);

			// Toggle sidebar switch in the general settings
			this.updateGeneralSettings('toggle-sidebar-setting', show);
		});

		ipcRenderer.on('toggle-autohide-menubar', (event: Event, autoHideMenubar: boolean, updateMenu: boolean) => {
			if (updateMenu) {
				ipcRenderer.send('update-menu', {
					tabs: this.tabsForIpc,
					activeTabIndex: this.activeTabIndex
				});
				this.fixBounds();
				return;
			}

			this.updateGeneralSettings('toggle-menubar-setting', autoHideMenubar);
			this.fixBounds();
		});

		ipcRenderer.on('toggle-dnd', (event: Event, state: boolean, newSettings: DNDSettings) => {
			this.toggleDNDButton(state);
			ipcRenderer.send('toggle-silent', newSettings.silent);
			ipcRenderer.send('forward-view-message', 'toggle-dnd', state, newSettings);
		});

		ipcRenderer.on('update-realm-name', (event: Event, serverURL: string, realmName: string) => {
			DomainUtil.getDomains().forEach((domain: DomainUtil.ServerConf, index: number) => {
				if (domain.url.includes(serverURL)) {
					const serverTabSelector = `.server-tab`;
					const serverTabs = document.querySelectorAll(serverTabSelector);
					serverTabs[index].textContent = realmName;
					this.tabs[index].props.name = realmName;

					domain.alias = realmName;
					DomainUtil.updateDomain(index, domain);
					// Update the realm name also on the Window menu
					ipcRenderer.send('update-menu', {
						tabs: this.tabsForIpc,
						activeTabIndex: this.activeTabIndex
					});
				}
			});
		});

		ipcRenderer.on('update-realm-icon', (event: Event, serverURL: string, iconURL: string) => {
			DomainUtil.getDomains().forEach(async (domain, index) => {
				if (domain.url.includes(serverURL)) {
					const localIconUrl: string = await DomainUtil.saveServerIcon({
						url: serverURL,
						icon: iconURL
					});
					const serverImgsSelector = '.tab .server-icons';
					const serverImgs: NodeListOf<HTMLImageElement> = document.querySelectorAll(serverImgsSelector);
					serverImgs[index].src = localIconUrl;
					domain.icon = localIconUrl;
					DomainUtil.updateDomain(index, domain);
				}
			});
		});

		ipcRenderer.on('enter-fullscreen', () => {
			this.$fullscreenPopup.classList.add('show');
			this.$fullscreenPopup.classList.remove('hidden');
		});

		ipcRenderer.on('leave-fullscreen', () => {
			this.$fullscreenPopup.classList.remove('show');
		});

		ipcRenderer.on('focus-view-with-contents', (event: Event, contents: Electron.webContents) => {
			ipcRenderer.send('focus-view-with-contents', contents);
		});

		ipcRenderer.on('render-taskbar-icon', (event: Event, messageCount: number) => {
			// Create a canvas from unread messagecounts
			function createOverlayIcon(messageCount: number): HTMLCanvasElement {
				const canvas = document.createElement('canvas');
				canvas.height = 128;
				canvas.width = 128;
				canvas.style.letterSpacing = '-5px';
				const ctx = canvas.getContext('2d');
				ctx.fillStyle = '#f42020';
				ctx.beginPath();
				ctx.ellipse(64, 64, 64, 64, 0, 0, 2 * Math.PI);
				ctx.fill();
				ctx.textAlign = 'center';
				ctx.fillStyle = 'white';
				if (messageCount > 99) {
					ctx.font = '65px Helvetica';
					ctx.fillText('99+', 64, 85);
				} else if (messageCount < 10) {
					ctx.font = '90px Helvetica';
					ctx.fillText(String(Math.min(99, messageCount)), 64, 96);
				} else {
					ctx.font = '85px Helvetica';
					ctx.fillText(String(Math.min(99, messageCount)), 64, 90);
				}

				return canvas;
			}

			ipcRenderer.send('update-taskbar-icon', createOverlayIcon(messageCount).toDataURL(), String(messageCount));
		});

		ipcRenderer.on('open-feedback-modal', () => {
			feedbackHolder.classList.add('show');
		});

		ipcRenderer.on('copy-zulip-url', () => {
			clipboard.writeText(this.getCurrentActiveServer());
		});

		ipcRenderer.on('new-server', async () => {
			await this.openSettings('AddServer');
		});

		// Redo and undo functionality since the default API doesn't work on macOS - Find alternative
		// ipcRenderer.on('undo', () => this.getActiveWebview().undo());

		// ipcRenderer.on('redo', () => this.getActiveWebview().redo());

		ipcRenderer.on('set-active', async () => {
			const webviews: NodeListOf<Electron.WebviewTag> = document.querySelectorAll('webview');
			await Promise.all([...webviews].map(async webview => webview.send('set-active')));
		});

		ipcRenderer.on('set-idle', async () => {
			const webviews: NodeListOf<Electron.WebviewTag> = document.querySelectorAll('webview');
			await Promise.all([...webviews].map(async webview => webview.send('set-idle')));
		});

		ipcRenderer.on('open-network-settings', async () => {
			await this.openSettings('Network');
		});

		ipcRenderer.on('switch-back', (e: Event, state: boolean) => {
			if (state === true) {
				this.$backButton.classList.remove('disable');
			} else {
				this.$backButton.classList.add('disable');
			}
		});

		ipcRenderer.on('switch-loading', (e: Event, loading: boolean, url: string) => {
			if (loading) {
				this.loading.add(url);
			} else {
				this.loading.delete(url);
			}
			this.showLoading(this.loading.has(this.tabs[this.activeTabIndex].props.url));
		});

		ipcRenderer.on('update-badge-count', (e: Event, count: number, url: string) => {
			this.badgeCounts[url] = count;
			this.updateBadge();
		});

		ipcRenderer.on('handle-link', (e: Event, index: number, url: string) => {
			// handleExternalLink(index, url); // Find logic to handle-external-links
		});
	}
}

window.addEventListener('load', async () => {
	// Only start electron-connect (auto reload on change) when its ran
	// from `npm run dev` or `gulp dev` and not from `npm start`
	if (isDev && remote.getGlobal('process').argv.includes('--electron-connect')) {
		// eslint-disable-next-line node/no-unsupported-features/es-syntax
		(await import('electron-connect')).client.create();
	}

	const serverManagerView = new ServerManagerView();
	await serverManagerView.init();
});

export { };
