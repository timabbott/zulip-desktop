'use strict';

const {ipcRenderer} = require('electron');

const BaseComponent = require(__dirname + '/../../components/base.js');
const ConfigUtil = require(__dirname + '/../../utils/config-util.js');

class GeneralSection extends BaseComponent {
	constructor(props) {
		super();
		this.props = props;
	}

	template() {
		return `
            <div class="settings-pane" id="server-settings-pane">
                <div class="title">Tray Options</div>
                <div id="tray-option-settings" class="settings-card">
					<div class="setting-row">
						<div class="setting-description">Show app icon in system tray</div>
						<div class="setting-control"></div>
					</div>
				</div>
				<div class="title">App Updates</div>
                <div id="betaupdate-option-settings" class="settings-card">
					<div class="setting-row">
						<div class="setting-description">Get beta updates</div>
						<div class="setting-control"></div>
					</div>
				</div>
				<div class="title">Desktop Notification</div>
                <div id="silent-option-settings" class="settings-card">
					<div class="setting-row">
						<div class="setting-description">Mute all sounds from Zulip (requires reload)</div>
						<div class="setting-control"></div>
					</div>
				</div>
				<div class="title">Dock toggle</div>
                <div id="dock-unread-option-settings" class="settings-card">
					<div class="setting-row">
						<div class="setting-description">Toggle dock unread messages</div>
				<div class="title">User Interface</div>
                <div id="ui-option-settings" class="settings-card">
					<div class="setting-row" id="sidebar-option">
						<div class="setting-description">Show sidebar (<span class="code">CmdOrCtrl+S</span>)</div>
						<div class="setting-control"></div>
					</div>
				</div>
            </div>
		`;
	}

	settingsOptionTemplate(settingOption) {
		if (settingOption) {
			return `
				<div class="action green">
					<span>On</span>
				</div>
			`;
		} else {
			return `
				<div class="action red">
					<span>Off</span>
				</div>
			`;
		}
	}

	trayOptionTemplate(trayOption) {
		this.settingsOptionTemplate(trayOption);
	}

	updateOptionTemplate(updateOption) {
		this.settingsOptionTemplate(updateOption);
	}

	silentOptionTemplate(silentOption) {
		this.settingsOptionTemplate(silentOption);
	}


	dockUnreadOptionTemplate(dockToggleOption) {
		this.settingsOptionTemplate(dockToggleOption);
	sidebarToggleTemplate(toggleOption) {
		this.settingsOptionTemplate(toggleOption);
	}

	init() {
		this.props.$root.innerHTML = this.template();
		this.initTrayOption();
		this.initUpdateOption();
		this.initSilentOption();
		this.initDockToggleUnreadOption();
		this.initSidebarToggle();
	}

	initTrayOption() {
		this.$trayOptionSettings = document.querySelector('#tray-option-settings .setting-control');
		this.$trayOptionSettings.innerHTML = '';

		const trayOption = ConfigUtil.getConfigItem('trayIcon', true);
		const $trayOption = this.generateNodeFromTemplate(this.settingsOptionTemplate(trayOption));
		this.$trayOptionSettings.appendChild($trayOption);

		$trayOption.addEventListener('click', () => {
			const newValue = !ConfigUtil.getConfigItem('trayIcon');
			ConfigUtil.setConfigItem('trayIcon', newValue);
			this.initTrayOption();
		});
	}

	initUpdateOption() {
		this.$updateOptionSettings = document.querySelector('#betaupdate-option-settings .setting-control');
		this.$updateOptionSettings.innerHTML = '';

		const updateOption = ConfigUtil.getConfigItem('betaUpdate', false);
		const $updateOption = this.generateNodeFromTemplate(this.settingsOptionTemplate(updateOption));
		this.$updateOptionSettings.appendChild($updateOption);

		$updateOption.addEventListener('click', () => {
			const newValue = !ConfigUtil.getConfigItem('betaUpdate');
			ConfigUtil.setConfigItem('betaUpdate', newValue);
			this.initUpdateOption();
		});
	}

	initSilentOption() {
		this.$silentOptionSettings = document.querySelector('#silent-option-settings .setting-control');
		this.$silentOptionSettings.innerHTML = '';

		const silentOption = ConfigUtil.getConfigItem('silent', false);
		const $silentOption = this.generateNodeFromTemplate(this.settingsOptionTemplate(silentOption));
		this.$silentOptionSettings.appendChild($silentOption);

		$silentOption.addEventListener('click', () => {
			const newValue = !ConfigUtil.getConfigItem('silent', true);
			ConfigUtil.setConfigItem('silent', newValue);
			ipcRenderer.send('toggle-dock-unread', newValue);
			this.initSilentOption();
		});
	}

	initDockToggleUnreadOption() {
		this.$dockToggleUnreadoptionSettings = document.querySelector('#dock-unread-option-settings .setting-control');
		this.$dockToggleUnreadoptionSettings.innerHTML = '';

		const dockToggleOption = ConfigUtil.getConfigItem('dock-toggle-unread', false);
		const $dockToggleOption = this.generateNodeFromTemplate(this.settingsOptionTemplate(dockToggleOption));
		this.$dockToggleUnreadoptionSettings.appendChild($dockToggleOption);

		$dockToggleOption.addEventListener('click', () => {
			const newValue = !ConfigUtil.getConfigItem('dock-toggle-unread');
			ConfigUtil.setConfigItem('dock-toggle-unread', newValue);
			ipcRenderer.send('toggle-dock-unread-option', newValue);
			this.initDockToggleUnreadOption();
	initSidebarToggle() {
		this.$sidebarOptionSettings = document.querySelector('#ui-option-settings #sidebar-option .setting-control');
		this.$sidebarOptionSettings.innerHTML = '';

		const sidebarOption = ConfigUtil.getConfigItem('show-sidebar', true);
		const $sidebarOption = this.generateNodeFromTemplate(this.settingsOptionTemplate(sidebarOption));
		this.$sidebarOptionSettings.appendChild($sidebarOption);

		$sidebarOption.addEventListener('click', () => {
			const newValue = !ConfigUtil.getConfigItem('show-sidebar');
			ConfigUtil.setConfigItem('show-sidebar', newValue);
			ipcRenderer.send('forward-message', 'toggle-sidebar', newValue);
			this.initSidebarToggle();
		});
	}

	handleServerInfoChange() {
		ipcRenderer.send('forward-message', 'reload-viewer');
	}
}

module.exports = GeneralSection;
