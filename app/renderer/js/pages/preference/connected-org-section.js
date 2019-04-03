'use strict';

const BaseSection = require(__dirname + '/base-section.js');
const DomainUtil = require(__dirname + '/../../utils/domain-util.js');
const ServerInfoForm = require(__dirname + '/server-info-form.js');
const AddCertificate = require(__dirname + '/add-certificate.js');
const ConfigUtil = require(__dirname + '/../../utils/config-util.js');

class ConnectedOrgSection extends BaseSection {
	constructor(props) {
		super();
		this.props = props;
	}

	template() {
		return `
			<div class="settings-pane" id="server-settings-pane">
				<div class="page-title">Connected organizations</div>
				<div class="title" id="existing-servers">All the connected orgnizations will appear here.</div>
				<div id="server-info-container"></div>
				<div id="new-org-button"><button class="green sea w-250">Connect to another organization</button></div>
				<div class="page-title">Add Custom Certificates</div>
				<div id="add-certificate-container"></div>
			</div>
		`;
	}

	init() {
		this.initServers();
	}

	initServers() {
		this.props.$root.innerHTML = '';

		const servers = DomainUtil.getDomains();
		const mutedOrganizations = ConfigUtil.getConfigItem('mutedOrganizations');
		this.props.$root.innerHTML = this.template();

		this.$serverInfoContainer = document.getElementById('server-info-container');
		this.$existingServers = document.getElementById('existing-servers');
		this.$newOrgButton = document.getElementById('new-org-button');
		this.$addCertificateContainer = document.getElementById('add-certificate-container');

		const noServerText = 'All the connected orgnizations will appear here';
		// Show noServerText if no servers are there otherwise hide it
		this.$existingServers.innerHTML = servers.length === 0 ? noServerText : '';
		for (let i = 0; i < servers.length; i++) {
			new ServerInfoForm({
				$root: this.$serverInfoContainer,
				server: servers[i],
				index: i,
				muteText: mutedOrganizations[servers[i].url] ? 'Unmute' : 'Mute',
				onChange: this.reloadApp
			}).init();
		}

		this.$newOrgButton.addEventListener('click', () => {
			// We don't need to import this since it's already imported in other files
			// eslint-disable-next-line no-undef
			ipcRenderer.send('forward-message', 'open-org-tab');
		});

		this.initAddCertificate();
	}

	initAddCertificate() {
		new AddCertificate({
			$root: this.$addCertificateContainer
		}).init();
	}

}

module.exports = ConnectedOrgSection;
