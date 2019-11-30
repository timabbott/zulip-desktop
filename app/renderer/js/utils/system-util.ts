'use strict';
import electron = require('electron');
import os = require('os');
import ConfigUtil = require('./config-util');

let instance: null | SystemUtil = null;
let app: Electron.App = null;

/* To make the util runnable in both main and renderer process */
if (process.type === 'renderer') {
	const { remote } = electron;
	app = remote.app;
} else {
	app = electron.app;
}

class SystemUtil {
	connectivityERR: string[];

	userAgent: string | null;

	constructor() {
		if (instance) {
			return instance;
		} else {
			instance = this;
		}

		this.connectivityERR = [
			'ERR_INTERNET_DISCONNECTED',
			'ERR_PROXY_CONNECTION_FAILED',
			'ERR_CONNECTION_RESET',
			'ERR_NOT_CONNECTED',
			'ERR_NAME_NOT_RESOLVED',
			'ERR_NETWORK_CHANGED'
		];
		this.userAgent = null;

		return instance;
	}

	getOS(): string {
		const platform = os.platform();
		if (platform === 'darwin') {
			return 'Mac';
		} else if (platform === 'linux') {
			return 'Linux';
		} else if (platform === 'win32') {
			if (parseFloat(os.release()) < 6.2) {
				return 'Windows 7';
			} else {
				return 'Windows 10';
			}
		} else {
			return '';
		}
	}

	setUserAgent(viewUserAgent: string): void {
		const appVersion = app.getVersion();
		this.userAgent = 'ZulipElectron/' + appVersion + ' ' + viewUserAgent;
	}

	getUserAgent(): string | null {
		if (!this.userAgent) {
			this.setUserAgent(ConfigUtil.getConfigItem('userAgent', null));
		}
		return this.userAgent;
	}
}

export = new SystemUtil();
