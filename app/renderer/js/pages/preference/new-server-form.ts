'use strict';

import { shell, ipcRenderer } from 'electron';

import BaseComponent = require('../../components/base');
import DomainUtil = require('../../utils/domain-util');
import t = require('../../utils/translation-util');

class NewServerForm extends BaseComponent {
	// TODO: TypeScript - Here props should be object type
	props: any;
	$newServerForm: Element;
	$saveServerButton: HTMLButtonElement;
	$newServerUrl: HTMLInputElement;
	constructor(props: any) {
		super();
		this.props = props;
	}

	template(): string {
		return `
			<div class="server-input-container">
				<div class="title">${t.__('Organization URL')}</div>
				<div class="add-server-info-row">
					<input class="setting-input-value" autofocus placeholder="your-organization.zulipchat.com or zulip.your-organization.com"/>
				</div>
				<div class="server-center">
					<div class="server-save-action">
						<button id="connect">${t.__('Connect')}</button>
					</div>
				</div>
				<div class="server-center">
					<div class="divider">
						<hr class="left"/>${t.__('OR')}<hr class="right" />
					</div>
				</div>
				<div class="server-center">
					<div class="server-save-action">
						<button id="open-create-org-link">${t.__('Create a new organization')}</button>
					</div>
				</div>
				<div class="server-center">
					<div class="server-network-option">
						<span id="open-network-settings">${t.__('Network and Proxy Settings')}</span>
						<i class="material-icons open-network-button">open_in_new</i>
					</div>
				</div>
			</div>
		`;
	}

	init(): void {
		this.initForm();
		this.initActions();
	}

	initForm(): void {
		this.$newServerForm = this.generateNodeFromTemplate(this.template());
		this.$saveServerButton = this.$newServerForm.querySelectorAll('.server-save-action')[0] as HTMLButtonElement;
		this.props.$root.innerHTML = '';
		this.props.$root.append(this.$newServerForm);
		this.$newServerUrl = this.$newServerForm.querySelectorAll('input.setting-input-value')[0] as HTMLInputElement;
	}

	submitFormHandler(): void {
		this.$saveServerButton.children[0].innerHTML = 'Connecting...';
		DomainUtil.checkDomain(this.$newServerUrl.value).then(serverConf => {
			DomainUtil.addDomain(serverConf).then(() => {
				this.props.onChange(this.props.index);
			});
		}, errorMessage => {
			this.$saveServerButton.children[0].innerHTML = 'Connect';
			alert(errorMessage);
		});
	}

	openCreateNewOrgExternalLink(): void {
		const link = 'https://zulipchat.com/new/';
		const externalCreateNewOrgEl = document.querySelector('#open-create-org-link');
		externalCreateNewOrgEl.addEventListener('click', () => {
			shell.openExternal(link);
		});
	}

	networkSettingsLink(): void {
		const networkSettingsId = document.querySelectorAll('.server-network-option')[0];
		networkSettingsId.addEventListener('click', () => ipcRenderer.send('forward-message', 'open-network-settings'));
	}

	initActions(): void {
		this.$saveServerButton.addEventListener('click', () => {
			this.submitFormHandler();
		});
		this.$newServerUrl.addEventListener('keypress', event => {
			if (event.key === 'Enter') {
				this.submitFormHandler();
			}
		});
		// open create new org link in default browser
		this.openCreateNewOrgExternalLink();
		this.networkSettingsLink();
	}
}

export = NewServerForm;
