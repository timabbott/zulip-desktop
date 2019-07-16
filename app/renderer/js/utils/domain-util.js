'use strict';

const { app, dialog } = require('electron').remote;
const fs = require('fs');
const path = require('path');
const JsonDB = require('node-json-db');
const request = require('request');
const escape = require('escape-html');

const Logger = require('./logger-util');

const RequestUtil = require(__dirname + '/../utils/request-util.js');
const Messages = require(__dirname + '/../../../resources/messages.js');

const logger = new Logger({
	file: `domain-util.log`,
	timestamp: true
});

let instance = null;

const defaultIconUrl = '../renderer/img/icon.png';

class DomainUtil {
	constructor() {
		if (instance) {
			return instance;
		} else {
			instance = this;
		}

		this.reloadDB();
		// Migrate from old schema
		if (this.db.getData('/').domain) {
			this.addDomain({
				alias: 'Zulip',
				url: this.db.getData('/domain')
			});
			this.db.delete('/domain');
		}

		return instance;
	}

	getDomains() {
		this.reloadDB();
		if (this.db.getData('/').domains === undefined) {
			return [];
		} else {
			return this.db.getData('/domains');
		}
	}

	getDomain(index) {
		this.reloadDB();
		return this.db.getData(`/domains[${index}]`);
	}

	updateDomain(index, server) {
		this.reloadDB();
		this.db.push(`/domains[${index}]`, server, true);
	}

	addDomain(server) {
		const ignoreCerts = server.ignoreCerts;
		return new Promise(resolve => {
			if (server.icon) {
				this.saveServerIcon(server, ignoreCerts).then(localIconUrl => {
					server.icon = localIconUrl;
					this.db.push('/domains[]', server, true);
					this.reloadDB();
					resolve();
				});
			} else {
				server.icon = defaultIconUrl;
				this.db.push('/domains[]', server, true);
				this.reloadDB();
				resolve();
			}
		});
	}

	removeDomains() {
		this.db.delete('/domains');
		this.reloadDB();
	}

	removeDomain(index) {
		this.db.delete(`/domains[${index}]`);
		this.reloadDB();
	}

	// Check if domain is already added
	duplicateDomain(domain) {
		domain = this.formatUrl(domain);
		const servers = this.getDomains();
		for (const i in servers) {
			if (servers[i].url === domain) {
				return true;
			}
		}
		return false;
	}

	async checkCertError(domain, serverConf, error, silent) {
		if (silent) {
			// since getting server settings has already failed
			return serverConf;
		} else {
			// Report error to sentry to get idea of possible certificate errors
			// users get when adding the servers
			logger.reportSentry(new Error(error));
			const certErrorMessage = Messages.certErrorMessage(domain, error);
			const certErrorDetail = Messages.certErrorDetail();

			const response = await dialog.showMessageBox({
				type: 'warning',
				buttons: ['Yes', 'No'],
				defaultId: 1,
				message: certErrorMessage,
				detail: certErrorDetail
			});
			if (response === 0) {
				// set ignoreCerts parameter to true in case user responds with yes
				serverConf.ignoreCerts = true;
				try {
					return await this.getServerSettings(domain, serverConf.ignoreCerts);
				} catch (err) {
					if (error === Messages.noOrgsError(domain)) {
						throw new Error(error);
					}
					return serverConf;
				}
			} else {
				throw new Error('Untrusted certificate.');
			}
		}
	}

	// ignoreCerts parameter helps in fetching server icon and
	// other server details when user chooses to ignore certificate warnings
	async checkDomain(domain, ignoreCerts = false, silent = false) {
		if (!silent && this.duplicateDomain(domain)) {
			// Do not check duplicate in silent mode
			throw new Error('This server has been added.');
		}

		domain = this.formatUrl(domain);

		const serverConf = {
			icon: defaultIconUrl,
			url: domain,
			alias: domain,
			ignoreCerts
		};

		try {
			return await this.getServerSettings(domain, serverConf.ignoreCerts);
		} catch (err) {
			// If the domain contains following strings we just bypass the server
			const whitelistDomains = [
				'zulipdev.org'
			];

			// make sure that error is an error or string not undefined
			// so validation does not throw error.
			const error = err || '';

			const certsError = error.toString().includes('certificate');
			if (domain.indexOf(whitelistDomains) >= 0 || certsError) {
				try {
					return await this.checkCertError(domain, serverConf, error, silent);
				} catch (err) {
					throw err;
				}
			} else {
				throw Messages.invalidZulipServerError(domain);
			}
		}
	}

	getServerSettings(domain, ignoreCerts = false) {
		const serverSettingsOptions = {
			url: domain + '/api/v1/server_settings',
			...RequestUtil.requestOptions(domain, ignoreCerts)
		};

		return new Promise((resolve, reject) => {
			request(serverSettingsOptions, (error, response) => {
				if (!error && response.statusCode === 200) {
					const data = JSON.parse(response.body);
					if (data.hasOwnProperty('realm_icon') && data.realm_icon) {
						resolve({
							// Some Zulip Servers use absolute URL for server icon whereas others use relative URL
							// Following check handles both the cases
							icon: data.realm_icon.startsWith('/') ? data.realm_uri + data.realm_icon : data.realm_icon,
							url: data.realm_uri,
							alias: escape(data.realm_name),
							ignoreCerts
						});
					} else {
						reject(Messages.noOrgsError(domain));
					}
				} else {
					reject(response);
				}
			});
		});
	}

	saveServerIcon(server, ignoreCerts = false) {
		const url = server.icon;
		const domain = server.url;

		const serverIconOptions = {
			url,
			...RequestUtil.requestOptions(domain, ignoreCerts)
		};

		// The save will always succeed. If url is invalid, downgrade to default icon.
		return new Promise(resolve => {
			const filePath = this.generateFilePath(url);
			const file = fs.createWriteStream(filePath);
			if (serverIconOptions.url === defaultIconUrl) {
				logger.log('Could not get server icon.');
				resolve(defaultIconUrl);
			} else {
				try {
					request(serverIconOptions).on('response', response => {
						response.on('error', err => {
							logger.log('Could not get server icon.');
							logger.log(err);
							logger.reportSentry(err);
							resolve(defaultIconUrl);
						});
						response.pipe(file).on('finish', () => {
							resolve(filePath);
						});
					}).on('error', err => {
						logger.log('Could not get server icon.');
						logger.log(err);
						logger.reportSentry(err);
						resolve(defaultIconUrl);
					});
				} catch (err) {
					logger.log('Could not get server icon.');
					logger.log(err);
					logger.reportSentry(err);
					resolve(defaultIconUrl);
				}
			}
		});
	}

	updateSavedServer(url, index) {
		// Does not promise successful update
		const ignoreCerts = this.getDomain(index).ignoreCerts;
		this.checkDomain(url, ignoreCerts, true).then(newServerConf => {
			this.saveServerIcon(newServerConf, ignoreCerts).then(localIconUrl => {
				newServerConf.icon = localIconUrl;
				this.updateDomain(index, newServerConf);
				this.reloadDB();
			});
		});
	}

	reloadDB() {
		const domainJsonPath = path.join(app.getPath('userData'), 'config/domain.json');
		try {
			const file = fs.readFileSync(domainJsonPath, 'utf8');
			JSON.parse(file);
		} catch (err) {
			if (fs.existsSync(domainJsonPath)) {
				fs.unlinkSync(domainJsonPath);
				dialog.showErrorBox(
					'Error saving new organization',
					'There seems to be error while saving new organization, ' +
					'you may have to re-add your previous organizations back.'
				);
				logger.error('Error while JSON parsing domain.json: ');
				logger.error(err);
				logger.reportSentry(err);
			}
		}
		this.db = new JsonDB(domainJsonPath, true, true);
	}

	generateFilePath(url) {
		const dir = `${app.getPath('userData')}/server-icons`;
		const extension = path.extname(url).split('?')[0];

		let hash = 5381;
		let len = url.length;

		while (len) {
			hash = (hash * 33) ^ url.charCodeAt(--len);
		}

		// Create 'server-icons' directory if not existed
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir);
		}

		return `${dir}/${hash >>> 0}${extension}`;
	}

	formatUrl(domain) {
		const hasPrefix = (domain.indexOf('http') === 0);
		if (hasPrefix) {
			return domain;
		} else {
			return (domain.indexOf('localhost:') >= 0) ? `http://${domain}` : `https://${domain}`;
		}
	}
}

module.exports = new DomainUtil();
