'use strict';

import { ipcRenderer, remote, clipboard, shell } from 'electron';
import { feedbackHolder } from './feedback';

import path = require('path');
import escape = require('escape-html');
import isDev = require('electron-is-dev');
const { session, app, Menu, dialog } = remote;

// eslint-disable-next-line import/no-unassigned-import
require('./tray');

import DomainUtil = require('./utils/domain-util');
import ServerTab = require('./components/server-tab');
import FunctionalTab = require('./components/functional-tab');
import ConfigUtil = require('./utils/config-util');
import DNDUtil = require('./utils/dnd-util');
import ReconnectUtil = require('./utils/reconnect-util');
import Logger = require('./utils/logger-util');
import CommonUtil = require('./utils/common-util');
import EnterpriseUtil = require('./utils/enterprise-util');
import Messages = require('./../../resources/messages');
import handleExternalLink = require('./components/handle-external-link');

interface FunctionalTabProps {
	name: string;
	materialIcon: string;
	url: string;
}

interface AnyObject {
	[key: string]: any;
}

interface SettingsOptions {
	autoHideMenubar: boolean;
	trayIcon: boolean;
	useManualProxy: boolean;
	useSystemProxy: boolean;
	showSidebar: boolean;
	badgeOption: boolean;
	startAtLogin: boolean;
	startMinimized: boolean;
	enableSpellchecker: boolean;
	showNotification: boolean;
	autoUpdate: boolean;
	betaUpdate: boolean;
	errorReporting: boolean;
	customCSS: boolean;
	silent: boolean;
	lastActiveTab: number;
	dnd: boolean;
	dndPreviousSettings: {
		showNotification: boolean;
		silent: boolean;
		flashTaskbarOnMessage?: boolean;
	};
	downloadsPath: string;
	showDownloadFolder: boolean;
	quitOnClose: boolean;
	flashTaskbarOnMessage?: boolean;
	dockBouncing?: boolean;
	loading?: AnyObject;
}

const logger = new Logger({
	file: 'errors.log',
	timestamp: true
});

const rendererDirectory = path.resolve(__dirname, '..');
type ServerOrFunctionalTab = ServerTab | FunctionalTab;

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
	loading: AnyObject;
	badgeCounts: AnyObject;
	activeTabIndex: number;
	tabs: ServerOrFunctionalTab[];
	functionalTabs: AnyObject;
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
		this.$fullscreenPopup.innerHTML = `Press ${this.$fullscreenEscapeKey} to exit full screen`;

		this.loading = {};
		this.badgeCounts = {};
		this.activeTabIndex = -1;
		this.tabs = [];
		this.presetOrgs = [];
		this.functionalTabs = {};
		this.tabIndex = 0;
	}

	init(): void {
		this.loadProxy().then(() => {
			this.initDefaultSettings();
			this.initSidebar();
			if (EnterpriseUtil.configFile) {
				this.initPresetOrgs();
			}
			this.initTabs();
			this.initActions();
			this.registerIpcs();
		});
	}

	loadProxy(): Promise<boolean> {
		return new Promise(resolve => {
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
			if (proxyEnabled) {
				session.fromPartition('persist:view').setProxy({
					pacScript: ConfigUtil.getConfigItem('proxyPAC', ''),
					proxyRules: ConfigUtil.getConfigItem('proxyRules', ''),
					proxyBypassRules: ConfigUtil.getConfigItem('proxyBypass', '')
				}, resolve);
			} else {
				session.fromPartition('persist:view').setProxy({
					pacScript: '',
					proxyRules: '',
					proxyBypassRules: ''
				}, resolve);
			}
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
			startAtLogin: true,
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
			showDownloadFolder: false,
			quitOnClose: false
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
		}

		for (const i in settingOptions) {
			const setting = i as keyof SettingsOptions;
			// give preference to defaults defined in global_config.json
			if (EnterpriseUtil.configItemExists(setting)) {
				ConfigUtil.setConfigItem(setting, EnterpriseUtil.getConfigItem(setting), true);
			} else if (ConfigUtil.getConfigItem(setting) === null) {
				ConfigUtil.setConfigItem(setting, settingOptions[setting]);
			}
		}
	}

	initSidebar(): void {
		const showSidebar = ConfigUtil.getConfigItem('showSidebar', true);
		this.toggleSidebar(showSidebar);
	}

	async queueDomain(domain: any): Promise<boolean> {
		// allows us to start adding multiple domains to the app simultaneously
		// promise of addition resolves in both cases, but we consider it rejected
		// if the resolved value is false
		try {
			const serverConf = await DomainUtil.checkDomain(domain);
			await DomainUtil.addDomain(serverConf);
			return true;
		} catch (err) {
			logger.error(err);
			logger.error('Could not add ' + domain + '. Please contact your system administrator.');
			return false;
		}
	}

	async initPresetOrgs(): Promise<void> {
		// read preset organizations from global_config.json and queues them
		// for addition to the app's domains
		const preAddedDomains = DomainUtil.getDomains();
		this.presetOrgs = EnterpriseUtil.getConfigItem('presetOrganizations', []);
		// set to true if at least one new domain is added
		const domainPromises = [];
		for (const url of this.presetOrgs) {
			if (DomainUtil.duplicateDomain(url)) {
				continue;
			}
			domainPromises.push(this.queueDomain(url));
		}
		const domainsAdded = await Promise.all(domainPromises);
		if (domainsAdded.includes(true)) {
			// at least one domain was resolved
			if (preAddedDomains.length > 0) {
				// user already has servers added
				// ask them before reloading the app
				dialog.showMessageBox({
					type: 'question',
					buttons: ['Yes', 'Later'],
					defaultId: 0,
					message: 'New server' + (domainsAdded.length > 1 ? 's' : '') + ' added. Reload app now?'
				}, response => {
					if (response === 0) {
						ipcRenderer.send('reload-full-app');
					}
				});
			} else {
				ipcRenderer.send('reload-full-app');
			}
		} else if (domainsAdded.length > 0) {
			// find all orgs that failed
			const failedDomains: string[] = [];
			for (const org of this.presetOrgs) {
				if (DomainUtil.duplicateDomain(org)) {
					continue;
				}
				failedDomains.push(org);
			}
			const { title, content } = Messages.enterpriseOrgError(domainsAdded.length, failedDomains);
			dialog.showErrorBox(title, content);
			if (DomainUtil.getDomains().length === 0) {
				// no orgs present, stop showing loading gif
				this.openSettings('AddServer');
			}
		}
	}

	initTabs(): void {
		const servers = DomainUtil.getDomains();
		if (servers.length > 0) {
			for (let i = 0; i < servers.length; i++) {
				this.initServer(servers[i], i);
			}
			// Open last active tab
			let lastActiveTab = ConfigUtil.getConfigItem('lastActiveTab');
			if (lastActiveTab >= servers.length) {
				lastActiveTab = 0;
			}
			// checkDomain() and webview.load() for lastActiveTab before the others
			DomainUtil.updateSavedServer(servers[lastActiveTab].url, lastActiveTab);
			this.activateTab(lastActiveTab);
			for (let i = 0; i < servers.length; i++) {
				// after the lastActiveTab is activated, we load the others in the background
				// without activating them, to prevent flashing of server icons
				if (i === lastActiveTab) {
					continue;
				}
				DomainUtil.updateSavedServer(servers[i].url, i);
			}
			// Remove focus from the settings icon at sidebar bottom
			this.$settingsButton.classList.remove('active');
		} else if (this.presetOrgs.length === 0) {
			// not attempting to add organisations in the background
			this.openSettings('AddServer');
		} else {
			this.showLoading(true);
		}
	}

	initServer(server: any, index: number): void {
		const tabIndex = this.getTabIndex();
		this.tabs.push(new ServerTab({
			role: 'server',
			icon: server.icon,
			name: CommonUtil.decodeString(server.alias),
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
		this.loading[server.url] = true;
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
		this.$addServerButton.addEventListener('click', () => {
			this.openSettings('AddServer');
		});
		this.$settingsButton.addEventListener('click', () => {
			this.openSettings('General');
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

		$parent.removeChild($img);
		$parent.append($altIcon);

		this.addContextMenu($altIcon as HTMLImageElement, index);
	}

	openFunctionalTab(tabProps: FunctionalTabProps): void {
		if (this.functionalTabs[tabProps.name] !== undefined) {
			this.activateTab(this.functionalTabs[tabProps.name]);
			return;
		}

		this.functionalTabs[tabProps.name] = this.tabs.length;

		const tabIndex = this.getTabIndex();

		this.tabs.push(new FunctionalTab({
			role: 'function',
			materialIcon: tabProps.materialIcon,
			name: tabProps.name,
			$root: this.$tabsContainer,
			index: this.functionalTabs[tabProps.name],
			tabIndex,
			onClick: this.activateTab.bind(this, this.functionalTabs[tabProps.name]),
			onDestroy: this.destroyTab.bind(this, tabProps.name, this.functionalTabs[tabProps.name]),
			url: tabProps.url
		}));
		const props = {
			index: this.functionalTabs[tabProps.name],
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

		this.activateTab(this.functionalTabs[tabProps.name]);
	}

	openSettings(nav = 'General'): void {
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

	// returns this.tabs in an way that does
	// not crash app when this.tabs is passed into
	// ipcRenderer.
	get tabsForIpc(): ServerOrFunctionalTab[] {
		const tabs: ServerOrFunctionalTab[] = [];
		this.tabs.forEach((tab: ServerOrFunctionalTab) => {
			const proto = Object.create(Object.getPrototypeOf(tab));
			const tabClone = Object.assign(proto, tab);
			tabs.push(tabClone);
		});

		return tabs;
	}

	activateTab(index: number, hideOldTab = true): void {
		if (!this.tabs[index]) {
			return;
		}

		if (this.activeTabIndex !== -1) {
			if (this.activeTabIndex === index) {
				return;
			} else if (hideOldTab) {
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
		this.showLoading(this.loading[this.tabs[this.activeTabIndex].props.url]);
		ipcRenderer.send('call-view-function', 'maybeEnableGoBackButton');
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
		delete this.functionalTabs[name];

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
		this.functionalTabs = {};

		// Clear DOM elements
		this.$tabsContainer.innerHTML = '';
		this.$viewsContainer.innerHTML = '';
	}

	reloadView(): void {
		// Save and remember the index of last active tab so that we can use it later
		const lastActiveTab = this.tabs[this.activeTabIndex].props.index;
		ConfigUtil.setConfigItem('lastActiveTab', lastActiveTab);

		// Destroy the current view and re-initiate it
		this.destroyView();
		this.initTabs();
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

	updateGeneralSettings(setting: string, value: any): void {
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
				if (domain.loggedIn && !this.loading[domain.url]) {
					return true;
				}
				// match returned false
				return false;
			}
		}
		return false;
	}

	addContextMenu($serverImg: HTMLImageElement, index: number): void {
		$serverImg.addEventListener('contextmenu', e => {
			e.preventDefault();
			const template = [
				{
					label: 'Disconnect organization',
					click: () => {
						dialog.showMessageBox({
							type: 'warning',
							buttons: ['YES', 'NO'],
							defaultId: 0,
							message: 'Are you sure you want to disconnect this organization?'
						}, response => {
							if (response === 0) {
								if (DomainUtil.removeDomain(index)) {
									// Set lastActiveTab to 0th index
									ConfigUtil.setConfigItem('lastActiveTab', 0);
									ipcRenderer.send('reload-full-app');
								} else {
									const { title, content } = Messages.orgRemovalError(DomainUtil.getDomain(index).url);
									dialog.showErrorBox(title, content);
								}
							}
						});
					}
				},
				{
					label: 'Notification settings',
					enabled: this.isLoggedIn(index),
					click: () => {
						// switch to tab whose icon was right-clicked
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
			contextMenu.popup({ window: remote.getCurrentWindow() });
		});
	}

	registerIpcs(): void {
		const viewListeners: AnyObject = {
			'view-reload': 'reload',
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

		ipcRenderer.on('set-logged-in', (event: Event, loggedIn: boolean, index: number) => {
			const domain = DomainUtil.getDomain(index);
			domain.loggedIn = loggedIn;
			DomainUtil.updateDomain(index, domain);
		});

		ipcRenderer.on('show-network-error', (event: Event, index: number) => {
			this.openNetworkTroubleshooting(index);
		});

		ipcRenderer.on('open-settings', (event: Event, settingNav: string) => {
			this.openSettings(settingNav);
		});

		ipcRenderer.on('open-about', this.openAbout.bind(this));

		ipcRenderer.on('open-help', () => {
			// Open help page of current active server
			const helpPage = this.getCurrentActiveServer() + '/help';
			shell.openExternal(helpPage);
		});

		ipcRenderer.on('reload-viewer', this.reloadView.bind(this, this.tabs[this.activeTabIndex].props.index));

		ipcRenderer.on('reload-current-viewer', this.reloadCurrentView.bind(this));

		ipcRenderer.on('hard-reload', () => {
			ipcRenderer.send('reload-full-app');
		});

		ipcRenderer.on('clear-app-data', () => {
			ipcRenderer.send('clear-app-settings');
		});

		ipcRenderer.on('switch-server-tab', (event: Event, index: number) => {
			this.activateLastTab(index);
		});

		ipcRenderer.on('open-org-tab', () => {
			this.openSettings('AddServer');
		});

		ipcRenderer.on('reload-proxy', (event: Event, showAlert: boolean) => {
			this.loadProxy().then(() => {
				if (showAlert) {
					alert('Proxy settings saved!');
					ipcRenderer.send('reload-full-app');
				}
			});
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

		ipcRenderer.on('toggle-dnd', (event: Event, state: boolean, newSettings: SettingsOptions) => {
			this.toggleDNDButton(state);
			ipcRenderer.send('toggle-silent', newSettings.silent);
			ipcRenderer.send('forward-view-message', 'toggle-dnd', state, newSettings);
		});

		ipcRenderer.on('update-realm-name', (event: Event, serverURL: string, realmName: string) => {
			// TODO: TypeScript - Type annotate getDomains() or this domain paramter.
			DomainUtil.getDomains().forEach((domain: any, index: number) => {
				if (domain.url.includes(serverURL)) {
					const serverTabSelector = `.server-tab`;
					const serverTabs = document.querySelectorAll(serverTabSelector);
					(serverTabs[index] as HTMLElement).title = escape(realmName);
					this.tabs[index].props.name = escape(realmName);

					domain.alias = escape(realmName);
					DomainUtil.db.push(`/domains[${index}]`, domain, true);
					DomainUtil.reloadDB();
					// Update the realm name also on the Window menu
					ipcRenderer.send('update-menu', {
						tabs: this.tabsForIpc,
						activeTabIndex: this.activeTabIndex
					});
				}
			});
		});

		ipcRenderer.on('update-realm-icon', (event: Event, serverURL: string, iconURL: string) => {
			// TODO: TypeScript - Type annotate getDomains() or this domain paramter.
			DomainUtil.getDomains().forEach((domain: any, index: number) => {
				if (domain.url.includes(serverURL)) {
					DomainUtil.saveServerIcon(iconURL).then((localIconUrl: string) => {
						const serverImgsSelector = `.tab .server-icons`;
						const serverImgs: NodeListOf<HTMLImageElement> = document.querySelectorAll(serverImgsSelector);
						serverImgs[index].src = localIconUrl;

						domain.icon = localIconUrl;
						DomainUtil.db.push(`/domains[${index}]`, domain, true);
						DomainUtil.reloadDB();
					});
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

		ipcRenderer.on('new-server', () => {
			this.openSettings('AddServer');
		});

		ipcRenderer.on('set-active', () => {
			const webviews: NodeListOf<Electron.WebviewTag> = document.querySelectorAll('webview');
			webviews.forEach(webview => {
				webview.send('set-active');
			});
		});

		ipcRenderer.on('set-idle', () => {
			const webviews: NodeListOf<Electron.WebviewTag> = document.querySelectorAll('webview');
			webviews.forEach(webview => {
				webview.send('set-idle');
			});
		});

		ipcRenderer.on('open-network-settings', () => {
			this.openSettings('Network');
		});

		ipcRenderer.on('switch-back', (e: Event, state: boolean) => {
			if (state === true) {
				this.$backButton.classList.remove('disable');
			} else {
				this.$backButton.classList.add('disable');
			}
		});

		ipcRenderer.on('switch-loading', (e: Event, loading: boolean, url: string) => {
			if (!loading && this.loading[url]) {
				this.loading[url] = false;
			} else if (loading && !this.loading[url]) {
				this.loading[url] = true;
			}
			this.showLoading(this.loading[this.tabs[this.activeTabIndex].props.url]);
		});

		ipcRenderer.on('update-badge-count', (e: Event, count: number, url: string) => {
			this.badgeCounts[url] = count;
			this.updateBadge();
		});

		ipcRenderer.on('handle-link', (e: Event, index: number, url: string) => {
			handleExternalLink(index, url);
		});
	}
}

window.addEventListener('load', () => {
	const serverManagerView = new ServerManagerView();
	serverManagerView.init();
	// only start electron-connect (auto reload on change) when its ran
	// from `npm run dev` or `gulp dev` and not from `npm start` when
	// app is started `npm start` main process's proces.argv will have
	// `--no-electron-connect`
	const mainProcessArgv = remote.getGlobal('process').argv;
	if (isDev && !mainProcessArgv.includes('--no-electron-connect')) {
		require('electron-connect').client.create();
	}
});

export = new ServerManagerView();
