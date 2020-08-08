import ViewManager = require('./viewmanager');

import electron, {app, dialog, ipcMain, session} from 'electron';
import fs from 'fs';
import path from 'path';

import windowStateKeeper from 'electron-window-state';

import * as BadgeSettings from '../renderer/js/pages/preference/badge-settings';
import * as CertificateUtil from '../renderer/js/utils/certificate-util';
import * as ConfigUtil from '../renderer/js/utils/config-util';
import * as ProxyUtil from '../renderer/js/utils/proxy-util';
import {sentryInit} from '../renderer/js/utils/sentry-util';

import {appUpdater} from './autoupdater';
import * as AppMenu from './menu';
import {_getServerSettings, _saveServerIcon, _isOnline} from './request';
import {setAutoLaunch} from './startup';

let mainWindowState: windowStateKeeper.State;

// Prevent window being garbage collected
// eslint-disable-next-line import/no-mutable-exports
export let mainWindow: Electron.BrowserWindow;
let badgeCount: number;

let isQuitting = false;

// Load this url in main window
const mainURL = 'file://' + path.join(__dirname, '../renderer', 'main.html');

const singleInstanceLock = app.requestSingleInstanceLock();
if (singleInstanceLock) {
	app.on('second-instance', () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) {
				mainWindow.restore();
			}

			mainWindow.show();
		}
	});
} else {
	app.quit();
}

const rendererCallbacks = new Map();
let nextRendererCallbackId = 0;

ipcMain.on('renderer-callback', (event: Event, rendererCallbackId: number, ...args: any[]) => {
	rendererCallbacks.get(rendererCallbackId)(...args);
	rendererCallbacks.delete(rendererCallbackId);
});

function makeRendererCallback(callback: (...args: any[]) => void): number {
	rendererCallbacks.set(nextRendererCallbackId, callback);
	return nextRendererCallbackId++;
}

const APP_ICON = path.join(__dirname, '../resources', 'Icon');

const iconPath = (): string => APP_ICON + (process.platform === 'win32' ? '.ico' : '.png');

// Toggle the app window
const toggleApp = (): void => {
	if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
		mainWindow.show();
	} else {
		mainWindow.hide();
	}
};

function createMainWindow(): Electron.BrowserWindow {
	// Load the previous state with fallback to defaults
	const mainWindowState: windowStateKeeper.State = windowStateKeeper({
		defaultWidth: 1100,
		defaultHeight: 720,
		path: `${app.getPath('userData')}/config`
	});

	const win = new electron.BrowserWindow({
		// This settings needs to be saved in config
		title: 'Zulip',
		icon: iconPath(),
		x: mainWindowState.x,
		y: mainWindowState.y,
		width: mainWindowState.width,
		height: mainWindowState.height,
		minWidth: 500,
		minHeight: 400,
		webPreferences: {
			plugins: true,
			nodeIntegration: true,
			partition: 'persist:webviewsession',
			webviewTag: true
		},
		show: false
	});

	win.on('focus', () => {
		win.webContents.send('focus');
	});

	(async () => win.loadURL(mainURL))();

	// Keep the app running in background on close event
	win.on('close', event => {
		if (ConfigUtil.getConfigItem('quitOnClose')) {
			app.quit();
		}

		if (!isQuitting) {
			event.preventDefault();

			if (process.platform === 'darwin') {
				app.hide();
			} else {
				win.hide();
			}
		}
	});

	win.setTitle('Zulip');

	win.on('enter-full-screen', () => {
		ViewManager.fixBounds();
		win.webContents.send('enter-fullscreen');
	});

	win.on('leave-full-screen', () => {
		ViewManager.fixBounds();
		win.webContents.send('leave-fullscreen');
	});

	//  To destroy tray icon when navigate to a new URL
	win.webContents.on('will-navigate', event => {
		if (event) {
			win.webContents.send('destroytray');
		}
	});

	// Let us register listeners on the window, so we can update the state
	// automatically (the listeners will be removed when the window is closed)
	// and restore the maximized or full screen state
	mainWindowState.manage(win);

	return win;
}

// Decrease load on GPU (experimental)
app.disableHardwareAcceleration();

// Temporary fix for Electron render colors differently
// More info here - https://github.com/electron/electron/issues/10732
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// This event is only available on macOS. Triggers when you click on the dock icon.
app.on('activate', () => {
	if (mainWindow) {
		// If there is already a window show it
		mainWindow.show();
	} else {
		mainWindow = createMainWindow();
	}
});

app.on('ready', () => {
	const ses = session.fromPartition('persist:webviewsession');
	ses.setUserAgent(`ZulipElectron/${app.getVersion()} ${ses.getUserAgent()}`);

	ipcMain.on('set-spellcheck-langs', () => {
		ses.setSpellCheckerLanguages(ConfigUtil.getConfigItem('spellcheckerLanguages'));
	});
	AppMenu.setMenu({
		tabs: []
	});
	mainWindow = createMainWindow();

	// Auto-hide menu bar on Windows + Linux
	if (process.platform !== 'darwin') {
		const shouldHideMenu = ConfigUtil.getConfigItem('autoHideMenubar') || false;
		mainWindow.autoHideMenuBar = shouldHideMenu;
		mainWindow.setMenuBarVisibility(!shouldHideMenu);
	}

	// Initialize sentry for main process
	const errorReporting = ConfigUtil.getConfigItem('errorReporting');
	if (errorReporting) {
		sentryInit();
	}

	const isSystemProxy = ConfigUtil.getConfigItem('useSystemProxy');

	if (isSystemProxy) {
		(async () => ProxyUtil.resolveSystemProxy(mainWindow))();
	}

	const page = mainWindow.webContents;

	page.on('dom-ready', () => {
		if (ConfigUtil.getConfigItem('startMinimized')) {
			mainWindow.hide();
		} else {
			mainWindow.show();
		}
	});

	ipcMain.on('fetch-user-agent', event => {
		event.returnValue = session.fromPartition('persist:webviewsession').getUserAgent();
	});

	ipcMain.handle('get-server-settings', async (event, domain: string) => _getServerSettings(domain, ses));

	ipcMain.handle('save-server-icon', async (event, url: string) => _saveServerIcon(url, ses));

	ipcMain.handle('is-online', async (event, url: string) => _isOnline(url, ses));

	page.once('did-frame-finish-load', async () => {
		// Initiate auto-updates on MacOS and Windows
		if (ConfigUtil.getConfigItem('autoUpdate')) {
			await appUpdater();
		}
	});

	app.on('certificate-error', (
		event: Event,
		webContents: Electron.WebContents,
		urlString: string,
		error: string,
		certificate: Electron.Certificate,
		callback: (isTrusted: boolean) => void
	) /* eslint-disable-line max-params */ => {
		// TODO: The entire concept of selectively ignoring certificate errors
		// is ill-conceived, and this handler needs to be deleted.

		const url = new URL(urlString);
		if (url.protocol === 'wss:') {
			url.protocol = 'https:';
		}

		const filename = CertificateUtil.getCertificate(encodeURIComponent(url.origin));
		if (filename !== undefined) {
			try {
				const savedCertificate = fs.readFileSync(
					path.join(`${app.getPath('userData')}/certificates`, filename),
					'utf8'
				);
				if (certificate.data.replace(/[\r\n]/g, '') ===
					savedCertificate.replace(/[\r\n]/g, '')) {
					event.preventDefault();
					callback(true);
					return;
				}
			} catch (error) {
				console.error(`Error reading certificate file ${filename}:`, error);
			}
		}

		dialog.showErrorBox(
			'Certificate error',
			`The server presented an invalid certificate for ${url.origin}:

${error}`
		);
	});

	page.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
		const {origin} = new URL(details.requestingUrl);
		page.send('permission-request', {
			webContentsId: webContents.id === mainWindow.webContents.id ?
				null :
				webContents.id,
			origin,
			permission
		}, makeRendererCallback(callback));
	});

	// Temporarily remove this event
	// electron.powerMonitor.on('resume', () => {
	// 	mainWindow.reload();
	// 	page.send('destroytray');
	// });

	ipcMain.on('focus-app', () => {
		mainWindow.show();
	});

	ipcMain.on('quit-app', () => {
		app.quit();
	});

	// Code to show pdf in a new BrowserWindow (currently commented out due to bug-upstream)
	// ipcMain.on('pdf-view', (event, url) => {
	// 	// Paddings for pdfWindow so that it fits into the main browserWindow
	// 	const paddingWidth = 55;
	// 	const paddingHeight = 22;

	// 	// Get the config of main browserWindow
	// 	const mainWindowState = global.mainWindowState;

	// 	// Window to view the pdf file
	// 	const pdfWindow = new electron.BrowserWindow({
	// 		x: mainWindowState.x + paddingWidth,
	// 		y: mainWindowState.y + paddingHeight,
	// 		width: mainWindowState.width - paddingWidth,
	// 		height: mainWindowState.height - paddingHeight,
	// 		webPreferences: {
	// 			plugins: true,
	// 			partition: 'persist:viewsession'
	// 		}
	// 	});
	// 	pdfWindow.loadURL(url);

	// 	// We don't want to have the menu bar in pdf window
	// 	pdfWindow.setMenu(null);
	// });

	// Reload full app not just view, useful in debugging
	ipcMain.on('reload-full-app', () => {
		ViewManager.destroyAll();
		mainWindow.reload();
		page.send('destroytray');
	});

	ipcMain.on('clear-app-settings', () => {
		mainWindowState.unmanage();
		app.relaunch();
		app.exit();
	});

	ipcMain.on('toggle-app', () => {
		toggleApp();
	});

	ipcMain.on('toggle-badge-option', () => {
		BadgeSettings.updateBadge(badgeCount, mainWindow);
	});

	ipcMain.on('toggle-menubar', (_event: Electron.IpcMainEvent, showMenubar: boolean) => {
		mainWindow.autoHideMenuBar = showMenubar;
		mainWindow.setMenuBarVisibility(!showMenubar);
		page.send('toggle-autohide-menubar', showMenubar, true);
	});

	ipcMain.on('fix-bounds', () => {
		ViewManager.fixBounds();
	});

	ipcMain.on('update-badge', (_event: Electron.IpcMainEvent, messageCount: number) => {
		badgeCount = messageCount;
		BadgeSettings.updateBadge(badgeCount, mainWindow);
		page.send('tray', messageCount);
	});

	ipcMain.on('update-taskbar-icon', (_event: Electron.IpcMainEvent, data: string, text: string) => {
		BadgeSettings.updateTaskbarIcon(data, text, mainWindow);
	});

	ipcMain.on('forward-message', (_event: Electron.IpcMainEvent, listener: string, ...parameters: unknown[]) => {
		page.send(listener, ...parameters);
	});

	ipcMain.on('update-menu', (_event: Electron.IpcMainEvent, props: AppMenu.MenuProps) => {
		AppMenu.setMenu(props);
		const activeTab = props.tabs[props.activeTabIndex];
		if (activeTab) {
			mainWindow.setTitle(`Zulip - ${activeTab.name}`);
		}
	});

	ipcMain.on('toggleAutoLauncher', async (_event: Electron.IpcMainEvent, AutoLaunchValue: boolean) => {
		await setAutoLaunch(AutoLaunchValue);
	});

	ipcMain.on('downloadFile', (_event: Electron.IpcMainEvent, url: string, downloadPath: string) => {
		page.downloadURL(url);
		page.session.once('will-download', async (_event: Event, item) => {
			if (ConfigUtil.getConfigItem('promptDownload', false)) {
				const showDialogOptions: electron.SaveDialogOptions = {
					defaultPath: path.join(downloadPath, item.getFilename())
				};
				item.setSaveDialogOptions(showDialogOptions);
			} else {
				const getTimeStamp = (): number => {
					const date = new Date();
					return date.getTime();
				};

				const formatFile = (filePath: string): string => {
					const fileExtension = path.extname(filePath);
					const baseName = path.basename(filePath, fileExtension);
					return `${baseName}-${getTimeStamp()}${fileExtension}`;
				};

				const filePath = path.join(downloadPath, item.getFilename());

				// Update the name and path of the file if it already exists
				const updatedFilePath = path.join(downloadPath, formatFile(filePath));
				const setFilePath: string = fs.existsSync(filePath) ? updatedFilePath : filePath;
				item.setSavePath(setFilePath);
			}

			const updatedListener = (_event: Event, state: string): void => {
				switch (state) {
					case 'interrupted': {
						// Can interrupted to due to network error, cancel download then
						console.log('Download interrupted, cancelling and fallback to dialog download.');
						item.cancel();
						break;
					}

					case 'progressing': {
						if (item.isPaused()) {
							item.cancel();
						}

						// This event can also be used to show progress in percentage in future.
						break;
					}

					default: {
						console.info('Unknown updated state of download item');
					}
				}
			};

			item.on('updated', updatedListener);
			item.once('done', (_event: Event, state) => {
				if (state === 'completed') {
					page.send('downloadFileCompleted', item.getSavePath(), path.basename(item.getSavePath()));
				} else {
					console.log('Download failed state:', state);
					page.send('downloadFileFailed', state);
				}

				// To stop item for listening to updated events of this file
				item.removeListener('updated', updatedListener);
			});
		});
	});

	ipcMain.on('realm-name-changed', (_event: Electron.IpcMainEvent, serverURL: string, realmName: string) => {
		page.send('update-realm-name', serverURL, realmName);
	});

	ipcMain.on('realm-icon-changed', (_event: Electron.IpcMainEvent, serverURL: string, iconURL: string) => {
		page.send('update-realm-icon', serverURL, iconURL);
	});

	// Using event.sender.send instead of page.send here to
	// make sure the value of errorReporting is sent only once on load.
	ipcMain.on('error-reporting', (event: Electron.IpcMainEvent) => {
		event.sender.send('error-reporting-val', errorReporting);
	});

	ipcMain.on('save-last-tab', (_event: Electron.IpcMainEvent, index: number) => {
		ConfigUtil.setConfigItem('lastActiveTab', index);
	});

	// Update user idle status for each realm after every 15s
	const idleCheckInterval = 15 * 1000; // 15 seconds
	setInterval(() => {
		// Set user idle if no activity in 1 second (idleThresholdSeconds)
		const idleThresholdSeconds = 1; // 1 second
		const idleState = electron.powerMonitor.getSystemIdleState(idleThresholdSeconds);
		if (idleState === 'active') {
			page.send('set-active');
		} else {
			page.send('set-idle');
		}
	}, idleCheckInterval);
});

app.on('before-quit', () => {
	isQuitting = true;
});

// Send crash reports
process.on('uncaughtException', err => {
	console.error(err);
	console.error(err.stack);
});
